/**
 * The trivial clock question (QA 2026-09-26, grade ב השעון, bank f55c6c4b):
 * "השיעור התחיל בשעה 8:00 והסתיים בשעה 11:00. היכן נמצא זמן סיום השיעור
 * (11:00) על ציר הזמן?" with buttons 8–12 — no clock, no skill; the answer
 * is printed in the question.
 *
 * Run: npx tsx tests/clock-question.test.mts
 */
import assert from "node:assert/strict";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { checkQuestionQuality } from "../lib/authoring/quality-gate";
import { formatFit } from "../lib/exercises/format-fit";
import { findReusableExercise } from "../lib/exercises/store";
import { formatPool } from "../lib/exercises/generate";
import { TOPICS } from "../lib/map/topics";
import type { Exercise } from "../lib/exercises/types";

let passed = 0;
const failures: string[] = [];
async function at(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}
const nl = (id: string, topicId: string, grade: Exercise["grade"], question: string, correctAnswer: string, min: number, max: number, step = 1): Exercise =>
  ({ id, subject: "math", grade, type: "number_line", subtype: "number_line_placement", topic: "t", topicId, question, correctAnswer, numberLine: { min, max, step } }) as Exercise;
const printed = (e: Exercise) => checkQuestionQuality(e).violations.some((v) => /printed in the question/.test(v.detail));

const QA = nl("f55c6c4b-5db0-4b8d-8c09-bd86aa90f76b", "math-b-time", "ב", "השיעור התחיל בשעה 8:00 והסתיים בשעה 11:00. היכן נמצא זמן סיום השיעור (11:00) על ציר הזמן?", "11", 8, 12);
/** Every bank row of this shape (read-only query, 2026-09-27). */
const BANK: Exercise[] = [
  QA,
  nl("6e09b0fa", "math-a-time", "א", "רועי הגיע לגן בשעה 8:00 בבוקר. איפה נמצאת השעה 8 על הציר?", "8", 6, 12),
  nl("7e349d67", "math-b-time", "ב", "מאיה התחילה לשחק בשעה 2:00 וסיימה בשעה 5:00. היכן נמצא הזמן שבו היא סיימה לשחק על הציר?", "5", 1, 6),
  nl("59346614", "math-g-time", "ג", "דני התחיל לצפות בסרט בשעה 14:00 והסרט נמשך 45 דקות. באיזו דקה הסתיים הסרט? (מקם את מספר הדקות על הציר)", "45", 30, 55, 5),
  nl("e01de77d", "math-g-time", "ג", "מיכל התחילה לצייר בשעה 14:00 וסיימה בשעה 16:30. היא ציירה במשך 150 דקות. היכן נמצא המספר 150 על ציר הדקות?", "150", 0, 200, 25),
  nl("a49f8c04", "math-g-time", "ג", "שירה התחילה לצייר בשעה 14:20 וסיימה בשעה 15:35. היא ציירה 75 דקות. היכן נמצא המספר 75 על ציר הדקות?", "75", 60, 100, 5),
];

console.log("the gate: a clock answer printed in the question");
await at("REAL f55c6c4b (the QA row) is rejected: its answer, 11, is printed as 11:00", () => {
  assert.ok(printed(QA));
});
for (const e of BANK.slice(1)) {
  await at(`REAL ${e.id} (${e.topicId}) is rejected too`, () => assert.ok(printed(e)));
}
await at("an end time the child must work out is not rejected (8:00 + 3 hours → 11)", () => {
  assert.equal(printed(nl("x", "math-b-time", "ב", "השיעור התחיל בשעה 8:00 ונמשך 3 שעות. באיזו שעה הוא נגמר? סמנו על הציר.", "11", 8, 12)), false);
  assert.equal(printed(nl("x", "math-g-time", "ג", "הסרט התחיל ב-14:00 ונגמר ב-14:45. כמה דקות הוא נמשך?", "45", 30, 55, 5)), false);
});
await at("a clock time in a non-number-line question is not this rule's business", () => {
  const open = { ...QA, type: "open", subtype: "fill_in_blank", numberLine: undefined } as Exercise;
  assert.equal(printed(open), false);
});

console.log("\nthe QA row is never served on this branch, and cannot be generated again");
await at("the allowed-format table refuses it: no time topic has a number-line format", () => {
  assert.equal(formatFit(QA, QA.topicId).ok, false);
  for (const t of TOPICS.filter((x) => /-time$/.test(x.id))) assert.ok(!formatPool("math", t.grade, t.id).includes("number_line_placement"), t.id);
});
await at("findReusableExercise drops it, requested under its topic or with none", async () => {
  const row = {
    id: QA.id, subject: "math", grade: "ב", type: "number_line", subtype: "number_line_placement", topic: "t", topic_id: "math-b-time",
    passage: null, question: QA.question, choices: null, number_line: QA.numberLine, tiles: null, grouping: null, correct_answer: "11", computation: null, difficulty: 2,
  };
  const client = { rpc: async () => ({ data: [row], error: null }) } as never;
  assert.equal(await findReusableExercise(client, "math", "ב", "kid", "math-b-time", 2), null);
  assert.equal(await findReusableExercise(client, "math", "ב", "kid", undefined, 2), null);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
