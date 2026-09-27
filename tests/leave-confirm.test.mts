/**
 * The exercise screen's exit confirm (lib/practice/leave.ts): "התרגיל
 * הנוכחי לא יישמר" only when something would be lost. QA 2026-09-26: it
 * appeared after an exercise was already finished.
 *
 * Run: npx tsx tests/leave-confirm.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exerciseFinished, leaveNeedsConfirm, type LeaveState } from "../lib/practice/leave";

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
const state = (p: Partial<LeaveState>): LeaveState => ({ hasExercise: true, loading: false, evaluation: null, attempt: 1, ...p });

console.log("when the confirm step appears");
t("QA repro: a finished exercise — answered correctly — leaves without the 'won't be saved' warning", () => {
  assert.equal(leaveNeedsConfirm(state({ evaluation: { correct: true } })), false);
  assert.equal(leaveNeedsConfirm(state({ evaluation: { correct: true }, attempt: 2 })), false, "correct on the second try");
});
t("the final miss (wrong on the second try) is finished too: no warning", () => {
  assert.equal(leaveNeedsConfirm(state({ evaluation: { correct: false }, attempt: 2 })), false);
});
t("an unanswered exercise still asks (the stray-tap guard it was built for)", () => {
  assert.equal(leaveNeedsConfirm(state({})), true);
});
t("a first wrong try, with the second still open, still asks", () => {
  assert.equal(leaveNeedsConfirm(state({ evaluation: { correct: false }, attempt: 1 })), true);
});
t("no exercise on screen (loading, failed load, empty topic): nothing to lose, no warning", () => {
  assert.equal(leaveNeedsConfirm(state({ hasExercise: false })), false);
  assert.equal(leaveNeedsConfirm(state({ loading: true })), false);
});
t("exerciseFinished agrees: correct, or wrong on the second try", () => {
  assert.equal(exerciseFinished({ evaluation: { correct: true }, attempt: 1 }), true);
  assert.equal(exerciseFinished({ evaluation: { correct: false }, attempt: 2 }), true);
  assert.equal(exerciseFinished({ evaluation: { correct: false }, attempt: 1 }), false);
  assert.equal(exerciseFinished({ evaluation: null, attempt: 2 }), false);
});

console.log("\nthe screen");
const screen = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");
t("the back arrow asks leaveNeedsConfirm with the screen's real state, and otherwise leaves directly", () => {
  assert.match(
    screen,
    /leaveNeedsConfirm\(\{ hasExercise: !!exercise, loading: loadingExercise, evaluation, attempt \}\)\s*\? setConfirmingLeave\(true\)\s*: onBackToMap\(\)/
  );
  assert.equal((screen.match(/setConfirmingLeave\(true\)/g) ?? []).length, 1, "no other path opens the dialog unconditionally");
});
t("the dialog itself is unchanged (no new copy)", () => {
  assert.match(screen, /<p className="text-sm text-\[var\(--color-ink-soft\)\]">התרגיל הנוכחי לא יישמר\.<\/p>/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
