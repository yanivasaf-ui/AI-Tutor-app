/**
 * One source of truth for what exists: lib/map/topics.ts. The picker, the
 * session planner (the journey map), the generator and the bank all read
 * it, so "does division exist here" has one answer.
 *
 * ACCEPTANCE (c), 2026-09-25: the topic picker said there is no division
 * while the generator produced a division question. Traced: the picker
 * matched topic NAMES (grade א has no division topic, and "חלוקה" matched
 * nothing at any grade), while the generator chose its exercise shape at
 * random, blind to the topic — visual_grouping (division) for any topic,
 * any grade. The production bank shows the result: division rows in every
 * one of grade א's six topics (28 rows; REAL fixtures below are verbatim).
 *
 * Run: npx tsx tests/topic-source-of-truth.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { TOPICS, getTopics, allowedOperations, gradeOperations, type Operation } from "../lib/map/topics";
import { curriculumSeed } from "../lib/rag/curriculum-seed";
import { resolveFreePracticeIntent } from "../lib/voice/freePracticeIntent";
import { buildJourney } from "../lib/practice/journey";
import { generateExercise, subtypeFitsOperations } from "../lib/exercises/generate";
import { operationScope, operationsUsed, OperationScopeError } from "../lib/exercises/operation-scope";
import { findReusableExercise } from "../lib/exercises/store";
import { getAnthropicClient } from "../lib/llm/anthropic";
import type { Exercise, Grade } from "../lib/exercises/types";

let passed = 0;
const failures: string[] = [];
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}
async function at(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}
const GRADES: Grade[] = ["א", "ב", "ג"];
const MATH = TOPICS.filter((x) => x.subject === "math");

// ---------------------------------------------------------------- the declaration
console.log("the declaration (lib/map/topics.ts)");
t("every math topic declares its operations; no Hebrew topic does", () => {
  for (const x of TOPICS) {
    if (x.subject === "math") assert.ok(x.operations && x.operations.length > 0, x.id);
    else assert.equal(x.operations, undefined, x.id);
  }
});
t("derived from the Ministry names: grade א add/sub only; ב all four; ג all four except 'חיבור, חיסור, אומדן'", () => {
  for (const x of MATH) {
    const want: Operation[] = x.grade === "א" || x.id === "math-g-arithmetic" ? ["add", "sub"] : ["add", "sub", "mul", "div"];
    assert.deepEqual([...x.operations!], want, x.id);
  }
  assert.match(MATH.find((x) => x.id === "math-a-addition-subtraction")!.topic, /\(חיבור וחיסור\)/);
  assert.match(MATH.find((x) => x.id === "math-b-arithmetic")!.topic, /כפל וחילוק/);
  assert.match(MATH.find((x) => x.id === "math-g-arithmetic")!.topic, /חיבור, חיסור, אומדן/);
});
t("gradeOperations is the union over the grade; a topic-less or unknown id falls back to it", () => {
  assert.deepEqual(gradeOperations("א"), ["add", "sub"]);
  assert.deepEqual(gradeOperations("ג"), ["add", "sub", "mul", "div"]);
  assert.deepEqual(allowedOperations(undefined, "א"), ["add", "sub"]);
  assert.deepEqual(allowedOperations("no-such", "ב"), ["add", "sub", "mul", "div"]);
  assert.deepEqual(allowedOperations("math-g-arithmetic", "ג"), ["add", "sub"]);
  // a grade-mismatched id is not trusted for its own ops
  assert.deepEqual(allowedOperations("math-g-multiplication-division", "א"), ["add", "sub"]);
});
t("the RAG curriculum seed lists exactly the same topics (id, subject, grade, name)", () => {
  const key = (x: { id: string; subject: string; grade: string; topic: string }) => `${x.id}|${x.subject}|${x.grade}|${x.topic}`;
  assert.deepEqual(curriculumSeed.map(key).sort(), TOPICS.map(key).sort());
});

// ---------------------------------------------------------------- acceptance (c): picker
console.log("\nacceptance (c): the picker finds division exactly where the declaration says it exists");
for (const g of GRADES) {
  const hasDiv = gradeOperations(g).includes("div");
  const hasMul = gradeOperations(g).includes("mul");
  for (const [said, op, has] of [
    ["חילוק", "div", hasDiv], ["חלוקה", "div", hasDiv], ["לחלק לקבוצות", "div", hasDiv],
    ["כפל", "mul", hasMul], ["כפולות", "mul", hasMul], ["לוח הכפל", "mul", hasMul],
  ] as [string, Operation, boolean][]) {
    t(`grade ${g}: "${said}" → ${has ? "a topic that teaches it" : "not found (the grade has none)"}`, () => {
      const r = resolveFreePracticeIntent(said, "math", g);
      if (has) {
        assert.equal(r.kind, "topic", JSON.stringify(r));
        if (r.kind === "topic") assert.ok(allowedOperations(r.topic.id, g).includes(op), r.topic.id);
      } else {
        assert.equal(r.kind, "not-found", JSON.stringify(r));
      }
    });
  }
}

// ---------------------------------------------------------------- planner
console.log("\nthe session planner reads the same list");
t("the journey map for each grade is exactly that grade's declared math topics, in order", () => {
  for (const g of GRADES) {
    const ids = buildJourney(getTopics("math", g)).flatMap((s) => (s.kind === "topic" ? [s.topic.id] : []));
    assert.deepEqual(ids, MATH.filter((x) => x.grade === g).map((x) => x.id));
  }
});

// ---------------------------------------------------------------- generator
console.log("\nthe generator: shape and prompt follow the declaration");
t("visual_grouping (division) only fits where division is allowed", () => {
  assert.equal(subtypeFitsOperations("visual_grouping", ["add", "sub"]), false);
  assert.equal(subtypeFitsOperations("visual_grouping", ["add", "sub", "mul", "div"]), true);
  assert.equal(subtypeFitsOperations("fill_in_blank", ["add", "sub"]), true);
});
type Call = { messages: { content: string }[] };
function fakeModel(replies: object[]) {
  const calls: Call[] = [];
  const messages = getAnthropicClient().messages as unknown as { create: (req: Call) => Promise<unknown> };
  messages.create = async (req: Call) => {
    calls.push(req);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { content: [{ type: "text", text: JSON.stringify(reply) }] };
  };
  return calls;
}
const GROUPING_GUIDANCE_MARK = "שמתחלקים בדיוק ל-groupCount";
const quiet = console.warn;
console.warn = () => {};

await at("across 120 grade-א requests (every topic), the division shape is never asked for, and the prompt names only חיבור/חיסור", async () => {
  const calls = fakeModel([{ type: "open", question: "x", correctAnswer: "1" }]);
  for (let i = 0; i < 20; i++) {
    for (const x of MATH.filter((m) => m.grade === "א")) {
      await generateExercise({ subject: "math", grade: "א", profile: null, topicId: x.id, level: 2 }).catch(() => {});
    }
  }
  assert.ok(calls.length >= 120);
  for (const c of calls) {
    const p = c.messages[0].content;
    assert.ok(!p.includes(GROUPING_GUIDANCE_MARK), "grade א was asked for a grouping (division) exercise");
    assert.ok(p.includes("פעולות החשבון שנלמדות כאן: חיבור, חיסור."));
    assert.ok(!/חיבור\/חיסור\/כפל\/חילוק/.test(p), "the all-four operation list leaked into a grade-א prompt");
  }
});
await at("grade ג multiplication-division still gets the division shape (the filter does not over-reach)", async () => {
  const calls = fakeModel([{ type: "open", question: "x", correctAnswer: "1" }]);
  for (let i = 0; i < 80; i++) {
    await generateExercise({ subject: "math", grade: "ג", profile: null, topicId: "math-g-multiplication-division", level: 2 }).catch(() => {});
  }
  assert.ok(calls.some((c) => c.messages[0].content.includes(GROUPING_GUIDANCE_MARK)));
});
await at("pick_operation in grade א offers two operations, not four", async () => {
  const calls = fakeModel([{ type: "open", question: "x", correctAnswer: "1" }]);
  await generateExercise({ subject: "math", grade: "א", profile: null, topicId: "math-a-addition-subtraction", level: 2, forceSubtype: "pick_operation" }).catch(() => {});
  assert.match(calls[0].messages[0].content, /2 אפשרויות מתוך פעולות חשבון \(חיבור\/חיסור, הרלוונטיות בלבד\)/);
});

// A fill_in_blank draft that divides: fine by the rubric (a sharing frame,
// named groups) and on topic (triangles) — out of scope only because grade
// א does not teach division.
const divisionDraftA = {
  type: "open",
  topic: "צורות",
  question: "לילך גזרה 12 משולשים וחילקה אותם שווה בשווה ל-3 חברות. כמה זה 12 ÷ 3?",
  computation: { operands: [12, 3], operators: ["/"] },
  correctAnswer: "4",
};
const shapesDraftA = {
  type: "open",
  topic: "צורות",
  question: "לילך גזרה 5 משולשים ו-3 ריבועים מנייר צבעוני. כמה זה 5 + 3?",
  computation: { operands: [5, 3], operators: ["+"] },
  correctAnswer: "8",
};
await at("admission: a grade-א division draft is re-requested, and the retry names what is allowed", async () => {
  const calls = fakeModel([divisionDraftA, shapesDraftA]);
  const out = await generateExercise({ subject: "math", grade: "א", profile: null, topicId: "math-a-geometry", level: 2, forceSubtype: "fill_in_blank" });
  assert.equal(out.question, shapesDraftA.question);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].messages[0].content.includes("מותר להשתמש רק ב: חיבור, חיסור"));
});
await at("admission: if every draft is out of scope it throws OperationScopeError", async () => {
  fakeModel([divisionDraftA]);
  await assert.rejects(
    generateExercise({ subject: "math", grade: "א", profile: null, topicId: "math-a-geometry", level: 2, forceSubtype: "fill_in_blank" }),
    (e: unknown) => e instanceof OperationScopeError && e.outOfScope.includes("div")
  );
});
console.warn = quiet;

// ---------------------------------------------------------------- what counts as using an operation
console.log("\nwhat counts as using an operation");
const ex = (p: Partial<Exercise> & { question: string }): Exercise =>
  ({ id: "x", subject: "math", grade: "א", type: "open", topic: "t", correctAnswer: "1", ...p }) as Exercise;
t("computation operators, ÷ and ×, division and multiplication words", () => {
  assert.deepEqual([...operationsUsed(ex({ question: "q", computation: { operands: [6, 3], operators: ["/"] } }))], ["div"]);
  assert.deepEqual([...operationsUsed(ex({ question: "כמה זה 6 ÷ 3?" }))], ["div"]);
  assert.deepEqual([...operationsUsed(ex({ question: "כמה זה 6 × 3?" }))], ["mul"]);
  assert.deepEqual([...operationsUsed(ex({ question: "חלקו 10 בלונים שווה בשווה ל-5 ילדים." }))], ["div"]);
  assert.deepEqual([...operationsUsed(ex({ question: "הגדילו את הגורם פי 2." }))], ["mul"]);
});
t("a pick_operation that merely OFFERS חילוק uses it", () => {
  const e = ex({ question: "q", subtype: "pick_operation", type: "multiple_choice", choices: ["חיבור", "חיסור", "כפל", "חילוק"], correctAnswer: "חיבור" });
  assert.deepEqual([...operationsUsed(e)].sort(), ["add", "div", "mul", "sub"]);
  assert.equal(operationScope(e, "math-a-addition-subtraction").ok, false);
});
t("a plain addition story uses no mul/div", () => {
  assert.deepEqual([...operationsUsed(ex({ question: "לדנה 3 כדורים וקיבלה עוד 2. כמה יש לה עכשיו?" }))], []);
});

// ---------------------------------------------------------------- serving
console.log("\nserving: the grade-א division rows already in the bank are never served");
function row(e: Exercise) {
  return {
    id: e.id, subject: e.subject, grade: e.grade, type: e.type, subtype: e.subtype ?? null, topic: "t", topic_id: e.topicId ?? null,
    passage: null, question: e.question, choices: e.choices ?? null, number_line: null, tiles: e.tiles ?? null,
    grouping: e.grouping ?? null, correct_answer: e.correctAnswer, computation: e.computation ?? null, difficulty: 2,
  };
}
const client = (rows: ReturnType<typeof row>[]) => ({ rpc: async () => ({ data: rows, error: null }) }) as never;
const REAL_A_DIVISION: Exercise[] = [
  ex({
    id: "42dcc946-8f68-4da0-a6a0-82ba1d68657a", topicId: "math-a-geometry", type: "grouping", subtype: "visual_grouping",
    question: "חלקו את המשולשים ל-3 קבוצות שוות. כמה משולשים יהיו בכל קבוצה?",
    grouping: { items: Array(9).fill("🔺"), groupCount: 3 }, correctAnswer: "3",
  }),
  ex({
    id: "8144236b-21f6-4763-9818-7f0e660d8176", topicId: "math-a-numbers-0-100", type: "grouping", subtype: "visual_grouping",
    question: "לימור קיבלה 10 בלונים 🎈. היא רוצה לחלק אותם שווה בשווה ל-5 ילדים. כמה בלונים כל ילד יקבל?",
    grouping: { items: Array(10).fill("🎈"), groupCount: 5 }, correctAnswer: "2",
  }),
];
for (const bad of REAL_A_DIVISION) {
  await at(`REAL ${bad.topicId}: "${bad.question.slice(0, 40)}…" is dropped — escape hatch or not`, async () => {
    assert.equal(await findReusableExercise(client([row(bad)]), "math", "א", "kid", bad.topicId, 2), null);
    assert.equal(await findReusableExercise(client([row(bad)]), "math", "א", "kid", bad.topicId, 2, undefined, { ignoreTopicFit: true }), null);
  });
}
await at("the same kind of row under grade ב is served (division exists there)", async () => {
  const b = { ...REAL_A_DIVISION[1], id: "b1", grade: "ב" as Grade, topicId: "math-b-arithmetic" };
  const got = await findReusableExercise(client([row(b)]), "math", "ב", "kid", "math-b-arithmetic", 2);
  assert.equal(got?.id, "b1");
});

// ---------------------------------------------------------------- tripwires
console.log("\nconsumers that can't be run here read the declaration");
{
  const seed = readFileSync(new URL("../scripts/seed-exercise-bank.ts", import.meta.url), "utf8");
  t("the bank seed script filters its forced subtypes by the topic's operations", () => {
    assert.match(seed, /MATH_BANKABLE\.filter\(\(s\) => subtypeFitsOperations\(s, allowedOperations\(topic\.id, topic\.grade\)\)\)/);
  });
  const route = readFileSync(new URL("../app/api/tutor/route.ts", import.meta.url), "utf8");
  t("the route treats an out-of-scope exhaustion like a rubric one (vetted template or fail — never the unchecked bank)", () => {
    assert.match(route, /genErr instanceof QualityGateError \|\| genErr instanceof OperationScopeError/);
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
