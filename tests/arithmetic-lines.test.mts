/**
 * The character must never state an answer that isn't the code-computed one.
 *
 * Regression test for the 2026-09-14 production bug: a displayed 10×4 was
 * answered "14" out loud. These assertions cover every answer-bearing line
 * the character can say about a computation exercise, across all four
 * operators, including when the model returns adversarially wrong text.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import {
  arithmeticClaimsIn,
  balancesEquation,
  computeAnswer,
  falseClaimsIn,
  isValidComputation,
  lineIsArithmeticallySafe,
  parseComputation,
  questionStatesComputation,
  statesWrongAnswer,
  type Computation,
} from "../lib/exercises/arithmetic";
import { numericAnswerMatches, safeFeedback } from "../lib/exercises/evaluate";

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

/** One case per operator, plus the chained and reported shapes. */
const CASES: { label: string; comp: Computation; question: string; truth: number }[] = [
  { label: "addition", comp: { operands: [20, 30], operators: ["+"] }, question: "כמה זה 20 + 30?", truth: 50 },
  { label: "subtraction", comp: { operands: [87, 39], operators: ["-"] }, question: "כמה זה 87 - 39?", truth: 48 },
  { label: "multiplication (the reported bug)", comp: { operands: [10, 4], operators: ["*"] }, question: "כמה זה 10 × 4?", truth: 40 },
  { label: "division", comp: { operands: [12, 3], operators: ["/"] }, question: "כמה זה 12 ÷ 3?", truth: 4 },
  { label: "chained +/-", comp: { operands: [87, 39, 24], operators: ["-", "+"] }, question: "חשבו: 87 - 39 + 24", truth: 72 },
];

console.log("computeAnswer is the single source of truth");
for (const c of CASES) {
  t(`${c.label}: computed answer is ${c.truth}`, () => {
    assert.equal(computeAnswer(c.comp), c.truth);
  });
  t(`${c.label}: the displayed question states its own computation`, () => {
    assert.equal(questionStatesComputation(c.question, c.comp), true);
  });
}

console.log("\nthe displayed question and the verified answer cannot drift apart");
t("10 × 4 spec rejected against a question that reads 10 + 4", () => {
  // Exactly the reported failure: 10+4=14 shown, 10*4=40 "verified".
  assert.equal(questionStatesComputation("כמה זה 10 + 4?", { operands: [10, 4], operators: ["*"] }), false);
});
t("a word problem with no stated operator is rejected", () => {
  assert.equal(questionStatesComputation("לשרה 4 שקיות ובכל אחת 10 סוכריות", { operands: [4, 10], operators: ["*"] }), false);
});
t("operands in the wrong order are rejected", () => {
  assert.equal(questionStatesComputation("כמה זה 4 - 87?", { operands: [87, 4], operators: ["-"] }), false);
});

console.log("\ncomputations this app refuses to build on");
t("division by zero has no answer", () => assert.equal(computeAnswer({ operands: [12, 0], operators: ["/"] }), null));
t("division with a remainder has no answer", () => assert.equal(computeAnswer({ operands: [7, 2], operators: ["/"] }), null));
t("a negative result has no answer", () => assert.equal(computeAnswer({ operands: [5, 8], operators: ["-"] }), null));
t("mixed precedence is refused (2 + 3 × 4 is not left-to-right)", () => {
  assert.equal(isValidComputation({ operands: [2, 3, 4], operators: ["+", "*"] }), false);
});
t("parseComputation accepts both operators:[] and operator:''", () => {
  assert.deepEqual(parseComputation({ operands: [10, 4], operator: "*" }), { operands: [10, 4], operators: ["*"] });
  assert.equal(parseComputation({ operands: [10, 4], operators: ["^"] }), null);
  assert.equal(parseComputation({ operands: [10], operators: [] }), null);
});

console.log("\nEVERY answer-bearing line matches the computed answer, across all operators");
for (const c of CASES) {
  const answer = computeAnswer(c.comp)!;
  const wrong = answer + 6;

  // The adversarial cases are what actually shipped the bug: a model that
  // states a number of its own.
  const adversarial = [
    `התשובה הנכונה היא ${wrong}.`,
    `אז ${c.comp.operands.join(` ${c.comp.operators[0]} `)} זה ${wrong}.`,
    `בואו נחשב יחד, ו${c.comp.operands[0]} ${c.comp.operators[0]} ${c.comp.operands[1]} שווה ${wrong}, אז התשובה הנכונה היא ${wrong}.`,
  ];

  for (const [i, modelText] of adversarial.entries()) {
    t(`${c.label}: adversarial line #${i + 1} never reaches the child`, () => {
      const line = safeFeedback(modelText, { verifiedAnswer: answer, correct: false, secondAttempt: true });
      assert.ok(!line.includes(String(wrong)), `line still contains the wrong number: ${line}`);
      assert.ok(line.includes(String(answer)), `second-attempt line must state the true answer: ${line}`);
      assert.equal(falseClaimsIn(line).length, 0);
      assert.equal(statesWrongAnswer(line, answer), false);
    });
  }

  t(`${c.label}: a clean model line is allowed through unchanged`, () => {
    const clean = `זה בסדר, זה קורה! אפשר לנסות שוב לאט.`;
    assert.equal(safeFeedback(clean, { verifiedAnswer: answer, correct: false, secondAttempt: false }), clean);
  });

  t(`${c.label}: a truthful restatement is allowed through`, () => {
    const truthful = `${c.comp.operands.join(` ${c.comp.operators[0]} `)} זה ${answer}.`;
    if (c.comp.operators.length === 1) {
      assert.equal(safeFeedback(truthful, { verifiedAnswer: answer, correct: false, secondAttempt: true }), truthful);
    }
  });

  t(`${c.label}: every emitted line is arithmetically safe`, () => {
    for (const text of [...adversarial, "", "כל הכבוד!"]) {
      for (const secondAttempt of [false, true]) {
        for (const correct of [false, true]) {
          const line = safeFeedback(text, { verifiedAnswer: answer, correct, secondAttempt });
          assert.equal(lineIsArithmeticallySafe(line, answer), true, `unsafe line emitted: ${line}`);
        }
      }
    }
  });
}

console.log("\nfalse arithmetic is caught in symbols and in spoken Hebrew");
t("symbolic false claim", () => assert.equal(falseClaimsIn("אז 10 * 4 = 14.").length, 1));
t("spoken-Hebrew false claim", () => assert.equal(falseClaimsIn("עשר כפול ארבע זה ארבע עשרה").length, 1));
t("spoken-Hebrew true claim passes", () => assert.equal(falseClaimsIn("עשר כפול ארבע זה ארבעים").length, 0));
t("true claim with filler passes ('זה בדיוק 50')", () => {
  assert.equal(falseClaimsIn("בואו נחבר: 20 ועוד 30 זה בדיוק 50.").length, 0);
  assert.equal(arithmeticClaimsIn("בואו נחבר: 20 ועוד 30 זה בדיוק 50.").length, 1);
});
t("unrelated neighbouring numbers are not read as a claim", () => {
  assert.equal(falseClaimsIn("יש 3 כוכבים ו-2 עיגולים, ובשאלה 7 חלקים").length, 0);
});

console.log("\ngrading is decided by code, not by prose");
t("digits, Hebrew words and restatements all grade the same", () => {
  assert.equal(numericAnswerMatches("40", 40), true);
  assert.equal(numericAnswerMatches("ארבעים", 40), true);
  assert.equal(numericAnswerMatches("20 ועוד 30 זה 50", 50), true);
  assert.equal(numericAnswerMatches("14", 40), false);
  assert.equal(numericAnswerMatches("לא יודעת", 40), false);
});

console.log("\nequation_balance is solved, not merely offered");
t("a balancing tile passes and a non-balancing one fails", () => {
  assert.equal(balancesEquation("3 + ___ = 7", "4"), true);
  assert.equal(balancesEquation("3 + ___ = 7", "5"), false);
  assert.equal(balancesEquation("10 - ___ = 4", "6"), true);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
