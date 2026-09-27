/**
 * feat: verdict-first evaluation — the two invariants that made this
 * restructure worth stopping over.
 *
 * 1. The arithmetic gate stays WHOLE-TEXT. Splitting the prose into
 *    sentences and gating each one was measured to miss both a false
 *    claim split across a sentence boundary and a wrong stated answer.
 *    The tests below build a deliberately weakened, per-sentence gate and
 *    prove the real one catches what it misses — so if anyone ever makes
 *    lineIsArithmeticallySafe sentence-local, these fail loudly.
 *
 * 2. A child never hears praise for an answer the code marked wrong. The
 *    opener is chosen from the locked verdict by a pure function, and the
 *    bare-number override discards the model's words entirely.
 *
 * All offline: no network, no model. The override path short-circuits
 * before the client is even constructed, which is itself part of the
 * guarantee.
 *
 * Run: npx tsx tests/verdict-first-eval.test.mts
 */
import assert from "node:assert/strict";
import { lineIsArithmeticallySafe } from "../lib/exercises/arithmetic";
import {
  safeFeedbackAfterOpener,
  generateFeedbackProse,
  isWrongBareNumberAgainstRubric,
  type LockedVerdict,
} from "../lib/exercises/evaluate";
import { OPENERS, openerKindFor } from "../lib/exercises/openers";
import { neutralInvitation, violatesConstitution } from "../lib/feedback/constitution";
import type { Exercise } from "../lib/exercises/types";

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

/**
 * The gate this codebase must NEVER have: one that judges each sentence
 * on its own. Defined here, in the test, purely so the real gate can be
 * shown catching cases this one waves through.
 */
function weakenedPerSentenceGate(text: string, answer: number | null): boolean {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim())
    .every((sentence) => lineIsArithmeticallySafe(sentence, answer));
}

console.log("the arithmetic gate is whole-text, and must stay that way");

t("a wrong stated answer split across two sentences: real gate catches it, per-sentence gate does not", () => {
  const text = "התשובה הנכונה שונה ממה שכתבת. היא 14.";
  assert.equal(lineIsArithmeticallySafe(text, 40), false, "the real gate must reject this");
  assert.equal(weakenedPerSentenceGate(text, 40), true, "a per-sentence gate would wave it through — that is the point");
});

t("a false claim split across two sentences: real gate catches it, per-sentence gate does not", () => {
  const text = "בוא נבדוק יחד: 7 + 5. זה 13, נכון?";
  assert.equal(lineIsArithmeticallySafe(text, null), false, "the real gate must reject this");
  assert.equal(weakenedPerSentenceGate(text, null), true, "a per-sentence gate would wave it through — that is the point");
});

t("the place-value case the gate was built for (עשיריות where עשרות was meant) is still caught", () => {
  const computation = { operands: [24, 33], operators: ["+"] } as never;
  assert.equal(lineIsArithmeticallySafe("קודם מחברים את העשיריות.", null, computation), false);
  assert.equal(lineIsArithmeticallySafe("קודם מחברים את העשרות.", null, computation), true);
});

t("a clean line still passes — the gate is not simply rejecting everything", () => {
  assert.equal(lineIsArithmeticallySafe("קודם מחברים את העשרות, ואז את היחידות.", 57), true);
});

console.log("\na wrong verdict can never be spoken as praise");

t("the opener is a pure function of the verdict, and never the praise line when wrong", () => {
  for (const secondAttempt of [false, true]) {
    for (const verifiedAnswer of [null, 12]) {
      const kind = openerKindFor({ correct: false, secondAttempt, verifiedAnswer });
      assert.notEqual(kind, "correct", `wrong verdict produced the praise opener (${secondAttempt}/${verifiedAnswer})`);
      assert.notEqual(OPENERS[kind], OPENERS.correct);
    }
  }
  assert.equal(openerKindFor({ correct: true, secondAttempt: false, verifiedAnswer: 12 }), "correct");
});

t("the bare-number override still fires on the case it was written for", () => {
  // FIX 4's production bug: answered "45 ממתקים" to a rubric whose implied
  // answer is 20, and the feedback affirmed 20 as correct.
  assert.equal(isWrongBareNumberAgainstRubric("45", "התלמיד/ה מסביר/ה שנשארו 20 ממתקים"), true);
  assert.equal(isWrongBareNumberAgainstRubric("20", "התלמיד/ה מסביר/ה שנשארו 20 ממתקים"), false);
  // Real reasoning is never second-guessed by this rule.
  assert.equal(isWrongBareNumberAgainstRubric("חילקתי ל-4 קבוצות של 5", "נשארו 20"), false);
});

await at("an overridden verdict produces corrective prose with NO model call at all", async () => {
  const exercise = {
    id: "t1",
    subject: "math",
    grade: "ב",
    subtype: "explain_thinking",
    question: "כמה ממתקים נשארו?",
    correctAnswer: "התלמיד/ה מסביר/ה שנשארו 20 ממתקים",
  } as unknown as Exercise;

  const verdict: LockedVerdict = {
    correct: false,
    verifiedAnswer: null,
    codeGraded: false,
    secondAttempt: false,
    overridden: true,
    openerKind: openerKindFor({ correct: false, secondAttempt: false, verifiedAnswer: null }),
  };

  // No ANTHROPIC_API_KEY is set in this test process. If this path tried
  // to reach the model at all, it would throw — passing is the proof that
  // the model's words are not merely discarded but never requested.
  const prose = await generateFeedbackProse(exercise, "45", verdict, { childGender: "girl" });

  const spoken = `${OPENERS[verdict.openerKind]} ${prose.feedback}`;
  assert.ok(!spoken.includes("כל הכבוד"), `praise reached a wrong verdict: ${spoken}`);
  assert.ok(!spoken.includes("נכון!"), `affirmation reached a wrong verdict: ${spoken}`);
  // Asserted against the constitution's own strings rather than a literal
  // phrase: the wording of the warm wrong-answer line is owned by
  // lib/feedback/constitution.ts and is allowed to change there. What must
  // hold is that a wrong answer still gets a warm invitation to look
  // again, and never a judgement of the child.
  assert.ok(spoken.includes(neutralInvitation("girl")), `a wrong answer should still invite looking together: ${spoken}`);
  assert.equal(violatesConstitution(spoken), null, "the wrong-answer line must obey the feedback constitution");
});

t("the deterministic remainder never repeats the opener it follows", () => {
  for (const correct of [true, false]) {
    const rest = safeFeedbackAfterOpener("", {
      verifiedAnswer: correct ? null : 12,
      correct,
      secondAttempt: !correct,
      computation: null,
    });
    for (const opener of Object.values(OPENERS)) {
      assert.ok(!rest.includes(opener), `remainder repeats the opener: "${rest}"`);
    }
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
