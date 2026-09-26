/**
 * The structural admission/serving check (lib/exercises/format-fit.ts): an
 * exercise's FORMAT must be one its topic's allowed-format table lists
 * (lib/map/topic-formats.ts), and a number line in an operations topic must
 * come from an operation (owner G5). Wording is never read to decide the
 * format — which is why this catches the costume leaks the vocabulary check
 * (topic-fit.ts) let through.
 *
 * Covered: the rule itself for every topic × format; admission (generation
 * retries, saveExercise refuses); serving (findReusableExercise drops, and no
 * flag lifts it); unserved topics hidden from map and picker.
 *
 * Run: npx tsx tests/format-fit.test.mts
 */
import assert from "node:assert/strict";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { formatFit, effectiveFormat, FormatFitError } from "../lib/exercises/format-fit";
import { allowedFormats, isServedTopic, hasCondition } from "../lib/map/topic-formats";
import { TOPICS, getTopics, SERVED_TOPICS } from "../lib/map/topics";
import { findReusableExercise, saveExercise } from "../lib/exercises/store";
import { generateExercise, NoCurriculumContentError, FormatNotAllowedError } from "../lib/exercises/generate";
import { resolveFreePracticeIntent } from "../lib/voice/freePracticeIntent";
import { VETTED_TEMPLATES } from "../lib/authoring/vetted-templates";
import { getAnthropicClient } from "../lib/llm/anthropic";
import type { Exercise, ExerciseSubtype, Grade } from "../lib/exercises/types";

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

const ALL_FORMATS: ExerciseSubtype[] = [
  "fill_in_blank", "pick_operation", "explain_thinking", "number_line_placement", "pattern_completion", "visual_grouping", "equation_balance", "shape_match",
  "comprehension", "spelling_correction_mc", "root_pattern_mc", "word_build", "sentence_order", "vowel_select_mc", "phonemic_visual_mc",
];
let n = 0;
const ex = (topicId: string, p: Partial<Exercise> & { question?: string } = {}): Exercise => {
  const topic = TOPICS.find((x) => x.id === topicId)!;
  return { id: `ff${++n}`, subject: topic.subject, grade: topic.grade, type: "open", topic: "t", topicId, question: "שאלה", correctAnswer: "1", difficulty: 2, ...p } as Exercise;
};

console.log("the rule, for every topic × format");
t("a format passes exactly when the topic's table lists it (number-line condition aside)", () => {
  for (const x of TOPICS) {
    for (const f of ALL_FORMATS) {
      // an operation in the text so the number-line condition never decides here
      const r = formatFit(ex(x.id, { subtype: f, question: "רועי עמד על 3 וקפץ עוד 4. כמה?" }), x.id);
      assert.equal(r.ok, isServedTopic(x.id) && allowedFormats(x.id).includes(f), `${x.id} × ${f}: ${r.reason}`);
    }
  }
});
t("an unserved topic accepts nothing; a row with no format is refused; no topic = unchecked", () => {
  assert.equal(formatFit(ex("math-g-volume", { subtype: "fill_in_blank" }), "math-g-volume").ok, false);
  assert.equal(formatFit(ex("hebrew-g-oral-expression", { subtype: "comprehension" }), "hebrew-g-oral-expression").ok, false);
  assert.equal(formatFit(ex("math-b-arithmetic"), "math-b-arithmetic").ok, false);
  assert.deepEqual(formatFit(ex("math-b-arithmetic", { subtype: "fill_in_blank" }), undefined), { ok: true, checked: false });
});
t("an untyped row with a computation is a computation (how the vetted templates are stored)", () => {
  assert.equal(effectiveFormat({ computation: { operands: [9, 3], operators: ["/"] } }), "fill_in_blank");
  assert.equal(effectiveFormat({}), undefined);
  for (const tpl of VETTED_TEMPLATES) assert.equal(formatFit({ id: "tpl", ...tpl.exercise }, tpl.topicId).ok, true, tpl.provenance.id);
});

console.log("\nG5: a number line in an operations topic must come from an operation");
t("QA (a) verbatim — placing 15 under לחבר ולחסר — is refused", () => {
  const r = formatFit(ex("math-a-addition-subtraction", { subtype: "number_line_placement", type: "number_line", question: "רותם אספה 15 צדפים בחוף הים. איפה נמצא המספר 15 על ציר המספרים?" }), "math-a-addition-subtraction");
  assert.equal(r.ok, false);
  assert.match(r.reason!, /operation/);
});
t("a placement that comes from an operation passes there", () => {
  assert.equal(formatFit(ex("math-a-addition-subtraction", { subtype: "number_line_placement", question: "רועי קופץ קפיצות של 5. הוא כבר קפץ 6 קפיצות. איפה הוא עומד עכשיו על הציר?" }), "math-a-addition-subtraction").ok, true);
});
t("the condition is only where the table sets it: a bare placement under a numbers topic passes", () => {
  assert.equal(hasCondition("math-a-numbers-0-100", "number-line-needs-operation"), false);
  assert.equal(formatFit(ex("math-a-numbers-0-100", { subtype: "number_line_placement", question: "רותם קפצה על ישר המספרים והגיעה למספר 85. היכן נמצא המספר 85 על הציר?" }), "math-a-numbers-0-100").ok, true);
});

console.log("\nserving: findReusableExercise drops every misfit, and nothing lifts it");
function row(e: Exercise) {
  return {
    id: e.id, subject: e.subject, grade: e.grade, type: e.type, subtype: e.subtype ?? null, topic: "t", topic_id: e.topicId ?? null,
    passage: null, question: e.question, choices: e.choices ?? null, number_line: null, tiles: e.tiles ?? null,
    grouping: e.grouping ?? null, correct_answer: e.correctAnswer, computation: e.computation ?? null, difficulty: 2,
  };
}
const client = (rows: ReturnType<typeof row>[]) => ({ rpc: async () => ({ data: rows, error: null }) }) as never;
// REAL (grade-ב sweep): a +5 sequence under length, costumed in length words.
const costumed = ex("math-b-length", {
  subtype: "pattern_completion", type: "tile_order",
  question: "אלון מדד קווים ישרים. האורכים שמדד הם: 15 ס״מ, 20 ס״מ, 25 ס״מ, 30 ס״מ. איזה אורך יהיה הקו הבא בסדרה?",
  correctAnswer: "35", tiles: { items: ["35", "32", "40", "33"], slotCount: 1, joinWith: " " },
});
const onFormat = ex("math-b-length", { subtype: "fill_in_blank", question: "דני מדד קו שבור: קטע של 8 ס״מ וקטע של 5 ס״מ. כמה זה 8 + 5?", computation: { operands: [8, 5], operators: ["+"] }, correctAnswer: "13" });
await at("the costumed sequence is never served; the on-format length row is", async () => {
  for (let i = 0; i < 100; i++) {
    const got = await findReusableExercise(client([row(costumed), row(onFormat)]), "math", "ב", "kid", "math-b-length", 2);
    assert.equal(got?.id, onFormat.id);
  }
});
await at("the topic-fit escape hatch does not lift it", async () => {
  assert.equal(await findReusableExercise(client([row(costumed)]), "math", "ב", "kid", "math-b-length", 2, undefined, { ignoreTopicFit: true }), null);
});
await at("an unscoped request checks each row against its own topic's table", async () => {
  assert.equal(await findReusableExercise(client([row(costumed)]), "math", "ב", "kid", undefined, 2), null);
});

console.log("\nadmission");
await at("saveExercise refuses a row whose format does not fit its topic (nothing is written)", async () => {
  let wrote = false;
  const db = { from: () => ({ insert: () => { wrote = true; return { select: () => ({ single: async () => ({ data: null, error: null }) }) }; } }) } as never;
  const { id: _omit, ...draft } = costumed;
  await assert.rejects(saveExercise(db, draft), /format does not fit/);
  assert.equal(wrote, false);
});
type Call = { messages: { content: string }[] };
function fakeModel(replies: object[]) {
  const calls: Call[] = [];
  const messages = getAnthropicClient().messages as unknown as { create: (req: Call) => Promise<unknown> };
  messages.create = async (req: Call) => {
    calls.push(req);
    return { content: [{ type: "text", text: JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]) }] };
  };
  return calls;
}
const quiet = console.warn;
console.warn = () => {};
const barePlacement = { type: "number_line", topic: "t", question: "איפה נמצא המספר 15 על ציר המספרים?", numberLine: { min: 10, max: 18, step: 1 }, correctAnswer: "15" };
const opPlacement = { type: "number_line", topic: "t", question: "רותם אספה 12 צדפים וקיבלה עוד 3. איפה נמצא מספר הצדפים שלה עכשיו על הציר?", numberLine: { min: 10, max: 18, step: 1 }, correctAnswer: "15" };
const gen = (topicId: string, grade: Grade, forceSubtype?: ExerciseSubtype) =>
  generateExercise({ subject: "math", grade, profile: null, topicId, level: 2, forceSubtype });
await at("generation: a bare placement under לחבר ולחסר is re-requested with the G5 hint, and the operation version is returned", async () => {
  const calls = fakeModel([barePlacement, opPlacement]);
  const out = await gen("math-a-addition-subtraction", "א", "number_line_placement");
  assert.equal(out.question, opPlacement.question);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].messages[0].content.includes("המיקום על הציר חייב לנבוע מפעולת חשבון"), "the first ask states the condition");
  assert.ok(calls[1].messages[0].content.includes("התרגיל הקודם נדחה: בנושא הזה מיקום על ציר המספרים"), "the retry names it");
});
await at("generation: if every draft misses it throws FormatFitError", async () => {
  fakeModel([barePlacement]);
  await assert.rejects(gen("math-a-addition-subtraction", "א", "number_line_placement"), (e: unknown) => e instanceof FormatFitError);
});
await at("generation: forcing a format the topic does not allow is refused before any model call", async () => {
  const calls = fakeModel([opPlacement]);
  await assert.rejects(gen("math-b-length", "ב", "pattern_completion"), (e: unknown) => e instanceof FormatNotAllowedError);
  assert.equal(calls.length, 0);
});
await at("generation: an unserved topic is 'no content', with no model call", async () => {
  const calls = fakeModel([opPlacement]);
  await assert.rejects(gen("math-g-volume", "ג"), (e: unknown) => e instanceof NoCurriculumContentError);
  assert.equal(calls.length, 0);
});
console.warn = quiet;

console.log("\nunserved topics are hidden (owner G2)");
t("the map lists only served topics: grade-ג math has 8 (volume hidden), grade-ג Hebrew 5 (oral expression hidden)", () => {
  assert.ok(!getTopics("math", "ג").some((x) => x.id === "math-g-volume"));
  assert.ok(!getTopics("hebrew", "ג").some((x) => x.id === "hebrew-g-oral-expression"));
  assert.equal(getTopics("math", "ג").length, 8);
  assert.equal(getTopics("hebrew", "ג").length, 5);
  assert.equal(SERVED_TOPICS.length, TOPICS.length - 2);
});
t("the picker (voice) can no longer land on a hidden topic", () => {
  for (const said of ["הבעה בעל פה", "גופים", "נפח", "תיבות"]) {
    for (const subject of ["math", "hebrew"] as const) {
      const r = resolveFreePracticeIntent(said, subject, "ג");
      if (r.kind === "topic") assert.ok(isServedTopic(r.topic.id), `${said} → ${r.topic.id}`);
    }
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
