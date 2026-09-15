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
  wrongMathTermsIn,
  type Computation,
} from "../lib/exercises/arithmetic";
import { isWrongBareNumberAgainstRubric, numericAnswerMatches, safeFeedback } from "../lib/exercises/evaluate";

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

console.log("\nFIX 3 (2026-09-14): a wrong place-value word is caught like a wrong number");
console.log("  regression: a real sweep line said 'עשיריות' (tenths) where 'עשרות' (tens) was meant");
t("a fractional term (עשיריות/מאיות/אלפית) is always wrong — this app has no decimals", () => {
  const comp: Computation = { operands: [25, 17], operators: ["+"] };
  assert.equal(wrongMathTermsIn("מחברים את העשיריות: 5 ועוד 7", comp).length, 1);
  assert.equal(wrongMathTermsIn("קודם המאיות ואז השאר", comp).length, 1);
  assert.equal(wrongMathTermsIn("אלפית אחת קטנה", comp).length, 1);
  // Even with no computation to compare against at all.
  assert.equal(wrongMathTermsIn("מחברים את העשיריות", null).length, 1);
});
t("the correct whole-number term for a 2-digit computation passes", () => {
  const comp: Computation = { operands: [25, 17], operators: ["+"] };
  const line = "קודם מחברים את העשרות: 20 ועוד 10 זה 30, ואז את היחידות: 5 ועוד 7 זה 12.";
  assert.equal(wrongMathTermsIn(line, comp).length, 0);
  assert.equal(lineIsArithmeticallySafe(line, 42, comp), true);
});
t("a whole-number term bigger than anything in the computation is wrong", () => {
  const comp: Computation = { operands: [25, 17], operators: ["+"] }; // = 42, never reaches hundreds
  const line = "קודם מחברים את המאות, ואז את השאר.";
  assert.equal(wrongMathTermsIn(line, comp).length, 1);
  assert.equal(lineIsArithmeticallySafe(line, 42, comp), false);
});
t("a carry that genuinely reaches the next place is allowed to name it", () => {
  const comp: Computation = { operands: [87, 39], operators: ["+"] }; // = 126, a real carry into hundreds
  const line = "87 ועוד 39 קופץ למאות: התוצאה היא 126.";
  assert.equal(wrongMathTermsIn(line, comp).length, 0);
});
t("a single-digit computation still rejects 'עשרות'", () => {
  const comp: Computation = { operands: [7, 2], operators: ["+"] }; // = 9
  assert.equal(wrongMathTermsIn("סופרים את העשרות: 7 ועוד 2", comp).length, 1);
});
t("subtraction and multiplication are covered the same way", () => {
  const sub: Computation = { operands: [50, 20], operators: ["-"] }; // = 30
  assert.equal(wrongMathTermsIn("מחסרים את המאות", sub).length, 1);
  assert.equal(wrongMathTermsIn("מחסרים את העשרות: 5 פחות 2 זה 3", sub).length, 0);
  const mul: Computation = { operands: [10, 4], operators: ["*"] }; // = 40, the reported 10x4 bug's own shape
  assert.equal(wrongMathTermsIn("זה עשיריות של הכפל", mul).length, 1);
});
t("safeFeedback rejects a model line with a wrong place-value term, even with the right final number", () => {
  const comp: Computation = { operands: [25, 17], operators: ["+"] };
  const line = safeFeedback("קודם מחברים את העשיריות, ואז מגיעים ל-42.", { verifiedAnswer: 42, correct: true, secondAttempt: false, computation: comp });
  assert.notEqual(line, "קודם מחברים את העשיריות, ואז מגיעים ל-42.");
});

console.log("\nFIX 4 (2026-09-14): a wrong bare numeric answer is wrong, with or without an explanation");
console.log("  regression: '45 ממתקים' (answer 20) got \"התשובה 20 היא נכונה, אבל השאלה ביקשה להסביר\"");
t("the reported repro: a bare wrong number against a rubric naming the real one", () => {
  assert.equal(isWrongBareNumberAgainstRubric("45 ממתקים", "הסבר טוב מזכיר חיסור 25-5=20 ומגיע ל-20 ממתקים"), true);
});
t("a bare CORRECT number is not flagged — only a wrong one forces the override", () => {
  assert.equal(isWrongBareNumberAgainstRubric("20 ממתקים", "הסבר טוב מזכיר חיסור 25-5=20 ומגיע ל-20 ממתקים"), false);
});
t("real reasoning (not a bare number) is never second-guessed, even if it lands on the wrong number", () => {
  // This subtype exists to judge the REASONING, not re-grade the number —
  // the override only ever fires for a bare number with nothing else said.
  assert.equal(isWrongBareNumberAgainstRubric("לקחתי 25 ופחתתי 5 ויצא לי 45 בטעות", "הסבר טוב מזכיר חיסור 25-5=20"), false);
});
t("a rubric with no number at all names nothing to contradict", () => {
  assert.equal(isWrongBareNumberAgainstRubric("45", "הסבר שמזכיר פירוק למאות/עשרות/יחידות"), false);
});
t("more than one number in the kid's answer is not treated as 'bare' — left to the model", () => {
  assert.equal(isWrongBareNumberAgainstRubric("45 או אולי 20", "התשובה היא 20"), false);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
