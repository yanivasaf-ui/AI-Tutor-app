/**
 * The question-quality regression bank. CI fails when:
 *
 *  1. ACCEPTANCE — any of the three failures found on 2026-09-25 gets
 *     through again. These expectations are written here, by hand, and no
 *     rebuild can change them:
 *     (a) a growing series presented as a static count — the brief's quote,
 *         verbatim ("הנה כמה צדפים יש לה: 3, 6, 9, 12");
 *     (b) division with no fair-sharing/grouping scaffold — the exact
 *         question was not persisted (no exercise row was written after
 *         2026-09-15), so the fixtures are production bank rows of the same
 *         failure, verbatim;
 *     (c) the picker saying division does not exist while the generator
 *         serves it — the picker utterances, and a production grade-א
 *         division row, verbatim.
 *  2. SERVED CONTENT — anything the product serves or shows the model as
 *     "this is what a good question looks like" (vetted templates, corpus
 *     exemplars) violates the rubric.
 *  3. CORPUS FIXTURES — the gate's verdict changes on any of the 273
 *     Ministry questions in tests/fixtures/regression-bank.json (3 per
 *     grade × topic × type, grades א–ג, each with its source URL + page).
 *     A deliberate gate change rebuilds the bank with
 *     `npx tsx scripts/build-regression-bank.ts` and the diff is reviewed.
 *
 * Run: npx tsx tests/regression-bank.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { checkQuestionQuality } from "../lib/authoring/quality-gate";
import { TOPIC_SLOTS, CROSS_CUTTING_SLOTS } from "../lib/authoring/rubric";
import { VETTED_TEMPLATES } from "../lib/authoring/vetted-templates";
import { operationScope } from "../lib/exercises/operation-scope";
import { resolveFreePracticeIntent } from "../lib/voice/freePracticeIntent";
import { verdict, fixtureExercise, type BankFixture } from "../scripts/build-regression-bank";
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

const rules = (e: Exercise) => [...new Set(checkQuestionQuality(e).violations.map((v) => v.rule))];
const ex = (p: Partial<Exercise> & { question: string }): Exercise =>
  ({ id: "acc", subject: "math", grade: "ב", type: "open", topic: "t", correctAnswer: "0", ...p }) as Exercise;

// ---------------------------------------------------------------- 1. acceptance
console.log("acceptance (a): a growing series presented as a static count");
t("VERBATIM 'הנה כמה צדפים יש לה: 3, 6, 9, 12' is rejected — no-series-as-count", () => {
  assert.deepEqual(rules(ex({ question: "הנה כמה צדפים יש לה: 3, 6, 9, 12" })), ["no-series-as-count"]);
});
t("...whatever subtype it arrives as, and with a follow-up question after it", () => {
  for (const q of ["הנה כמה צדפים יש לה: 3, 6, 9, 12", "הנה כמה צדפים יש לה: 3, 6, 9, 12. כמה יהיו לה בפעם הבאה?"]) {
    for (const subtype of ["pattern_completion", "fill_in_blank", undefined] as const) {
      assert.ok(rules(ex({ question: q, subtype, correctAnswer: "15" })).includes("no-series-as-count"), `${subtype}: ${q}`);
    }
  }
});

console.log("\nacceptance (b): division without a fair-sharing/grouping scaffold");
const REAL_BARE_DIVISION: Exercise[] = [
  ex({ id: "b8d63c15-ba80-4906-a6d3-a152f41da230", grade: "ג", topicId: "math-g-multiplication-division", subtype: "fill_in_blank", question: "כמה זה 60 ÷ 10?", computation: { operands: [60, 10], operators: ["/"] }, correctAnswer: "6" }),
  ex({ id: "492c7f3b-4c93-42a7-8983-45fb210bc4f9", grade: "ג", topicId: "math-g-multiplication-division", subtype: "fill_in_blank", question: "כמה זה 8,400 ÷ 100?", computation: { operands: [8400, 100], operators: ["/"] }, correctAnswer: "84" }),
  ex({ id: "e21cb386-5130-447e-a926-513f3bf8f6d3", grade: "ג", topicId: "math-g-multiplication-division", subtype: "equation_balance", question: "השלימו את המשוואה: 4,500 ÷ ___ = 45", correctAnswer: "100" }),
];
for (const e of REAL_BARE_DIVISION) {
  t(`REAL ${e.id.slice(0, 8)} "${e.question}" is rejected — division-sharing-frame`, () => {
    assert.ok(rules(e).includes("division-sharing-frame"));
  });
}
t("the same division WITH the scaffold passes (the rule rejects the missing frame, not division)", () => {
  assert.deepEqual(rules(ex({ grade: "ג", question: "בכיתה יש 60 עפרונות, והמורה מחלקת אותם שווה בשווה ל-10 ילדים. כמה זה 60 ÷ 10?", computation: { operands: [60, 10], operators: ["/"] }, correctAnswer: "6" })), []);
});

console.log("\nacceptance (c): the picker and the generator agree on whether division exists");
t("grade א: 'חילוק' → the picker finds no topic ...", () => {
  assert.equal(resolveFreePracticeIntent("חילוק", "math", "א").kind, "not-found");
});
t("... and a REAL grade-א division row (math-a-geometry 42dcc946) is out of scope, so it can't be generated or served", () => {
  const row = ex({
    id: "42dcc946-8f68-4da0-a6a0-82ba1d68657a", grade: "א", topicId: "math-a-geometry", type: "grouping", subtype: "visual_grouping",
    question: "חלקו את המשולשים ל-3 קבוצות שוות. כמה משולשים יהיו בכל קבוצה?",
    grouping: { items: Array(9).fill("🔺"), groupCount: 3 }, correctAnswer: "3",
  });
  const scope = operationScope(row, "math-a-geometry");
  assert.equal(scope.ok, false);
  assert.deepEqual(scope.outOfScope, ["div"]);
});
t("grades ב/ג: 'חלוקה' and 'חילוק' → a topic that teaches division", () => {
  for (const g of ["ב", "ג"] as Grade[]) {
    for (const said of ["חילוק", "חלוקה"]) {
      const r = resolveFreePracticeIntent(said, "math", g);
      assert.equal(r.kind, "topic", `${g} ${said}`);
    }
  }
});

// ---------------------------------------------------------------- 2. served content
console.log("\nserved content never violates the rubric");
t("every vetted template passes", () => {
  assert.ok(VETTED_TEMPLATES.length > 0);
  for (const tpl of VETTED_TEMPLATES) assert.deepEqual(rules({ id: "tpl", ...tpl.exercise }), [], tpl.provenance.id);
});
t("every corpus exemplar shown to the model as the standard passes", () => {
  const all = [
    ...Object.values(TOPIC_SLOTS),
    ...Object.values(CROSS_CUTTING_SLOTS).flatMap((g) => Object.values(g)),
  ].flatMap((s) => s.exemplars.exemplars ?? []);
  assert.ok(all.length > 0);
  for (const e of all) {
    // Exemplar ids are textbook ids: psahot-<a|b|g><volume>-p<page>-<n>.
    const grade = ({ a: "א", b: "ב", g: "ג" } as const)[e.source.id.match(/^psahot-([abg])\d/)![1] as "a" | "b" | "g"];
    assert.deepEqual(rules(fixtureExercise({ id: e.source.id, grade, text: e.text })), [], e.source.id);
  }
});

// ---------------------------------------------------------------- 3. corpus fixtures
console.log("\ncorpus fixtures (tests/fixtures/regression-bank.json)");
const bank: BankFixture[] = JSON.parse(readFileSync(new URL("./fixtures/regression-bank.json", import.meta.url), "utf8"));
t("273 fixtures over all 104 grade × topic × type slices at grades א–ג", () => {
  assert.equal(bank.length, 273);
  assert.equal(new Set(bank.map((f) => `${f.grade}|${f.topic}|${f.type}`)).size, 104);
  assert.ok(bank.every((f) => ["א", "ב", "ג"].includes(f.grade)));
});
t("every fixture keeps its provenance: a Ministry URL, plus page (textbook) or document (worksheet)", () => {
  for (const f of bank) {
    assert.match(f.source.url, /^https:\/\/(meyda|pop)\.education\.gov\.il\//, f.id);
    assert.ok(Number.isInteger(f.source.page) || typeof f.source.document === "string", f.id);
  }
});
t("drills are marked low fidelity (in the bank to test the gate, never served)", () => {
  for (const f of bank) assert.equal(f.fidelity === "low", f.type === "drill", f.id);
  const served = new Set(VETTED_TEMPLATES.map((x) => x.provenance.id));
  for (const f of bank.filter((x) => x.fidelity === "low")) assert.ok(!served.has(f.id), f.id);
});
let changed = 0;
for (const f of bank) {
  const got = verdict(f);
  if (got.ok !== f.expected.ok || got.rules.join() !== f.expected.rules.join()) {
    changed++;
    failures.push(`verdict changed: ${f.id}`);
    console.error(`  FAIL ${f.id} (${f.grade}/${f.topic}/${f.type}) was ${JSON.stringify(f.expected)}, now ${JSON.stringify(got)}\n        ${f.text.slice(0, 90)}`);
  }
}
if (changed === 0) {
  passed++;
  console.log(`  ok  the gate's verdict is unchanged on all ${bank.length} Ministry fixtures`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  console.error("If a gate change was intended: npx tsx scripts/build-regression-bank.ts, then review the fixture diff.");
  process.exit(1);
}
