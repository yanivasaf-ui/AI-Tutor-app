/**
 * The homework prototype's front door: what it accepts, and what it turns
 * away.
 *
 * Three outcomes, and the boundary between the first two is the subtle
 * one. "כמה זה 24 + 37?" is a PROBLEM even though it literally asks for an
 * answer — that is how an arithmetic exercise is written. What gets
 * declined is a request aimed at the tutor ("תגיד לי את התשובה"), because
 * the entire point of this mode is that the child produces the answer.
 *
 * Run: npx tsx tests/homework-parse.test.mts
 */
import assert from "node:assert/strict";
import { computeAnswer } from "../lib/exercises/arithmetic";
import { extractExpression, isAskingForTheAnswer, parseHomeworkProblem, renderExpression } from "../lib/homework/parseProblem";
import { homeworkModeEnabled } from "../lib/homework/flag";

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

console.log("accepted: arithmetic, however it is written");

const ACCEPTED: [string, number][] = [
  ["24 + 37", 61],
  ["כמה זה 24 + 37?", 61],
  ["24+37", 61],
  ["תרגיל 3: 24 + 37", 61],          // the label must not be read as the problem
  ["עשרים ועוד שלושים", 50],          // Hebrew words, via the shared tokenizer
  ["15 - 7 + 4", 12],
  ["10 × 4", 40],
  ["10 * 4", 40],
  ["60 ÷ 10", 6],
  ["שמונה פחות שלוש", 5],
  ["  87 - 39 + 24  ", 72],
];
for (const [text, expected] of ACCEPTED) {
  t(`accepts "${text}" → ${expected}`, () => {
    const p = parseHomeworkProblem(text);
    assert.equal(p.kind, "arithmetic", `declined: ${JSON.stringify(p)}`);
    if (p.kind !== "arithmetic") return;
    assert.equal(p.answer, expected);
    assert.equal(computeAnswer(p.computation), expected, "the answer comes from the shared evaluator");
  });
}

t("a leading label is not mistaken for the problem", () => {
  const p = parseHomeworkProblem("תרגיל 3: 24 + 37");
  assert.equal(p.kind === "arithmetic" && p.canonical, "24 + 37");
});

t("the canonical form is what the child will see written back", () => {
  assert.equal(renderExpression({ operands: [15, 7, 4], operators: ["-", "+"] }), "15 - 7 + 4");
  assert.equal(renderExpression({ operands: [10, 4], operators: ["*"] }), "10 × 4");
});

console.log("\nrejected: not maths");

const NOT_MATH = [
  "לכתוב חיבור על החופש הגדול",
  "מה זה שם עצם?",
  "לקרוא את הסיפור בעמוד 42 ולענות על השאלות",
  "צריך לצייר מפה של ישראל",
  "שלום",
  "",
  "   ",
  "42",                      // a number alone is not a problem
  "עמוד 42 שאלה 3",           // two numbers, no operator between them
];
for (const text of NOT_MATH) {
  t(`declines "${text.trim() || "(empty)"}"`, () => {
    const p = parseHomeworkProblem(text);
    assert.equal(p.kind, "not-math", `accepted something that is not arithmetic: ${JSON.stringify(p)}`);
  });
}

t("arithmetic this app cannot evaluate is declined as such, not walked through", () => {
  // computeAnswer owns these rules; the prototype never second-guesses it.
  for (const text of ["7 ÷ 2", "3 - 10"]) {
    const p = parseHomeworkProblem(text);
    assert.equal(p.kind, "not-math", text);
    assert.equal(p.kind === "not-math" && p.reason, "unsupported-result", `${text} should be declined for its result`);
  }
});

t("...and that is a DIFFERENT reason from 'not maths', so the reply can differ", () => {
  const a = parseHomeworkProblem("מה זה שם עצם?");
  const b = parseHomeworkProblem("7 ÷ 2");
  assert.equal(a.kind === "not-math" && a.reason, "no-expression");
  assert.equal(b.kind === "not-math" && b.reason, "unsupported-result");
});

console.log("\nrejected: asking the tutor to do the homework");

const DEMANDS = [
  "תגיד לי את התשובה",
  "תגידי לי את התשובה",
  "תן לי את התשובה של 24 + 37",
  "מה התשובה?",
  "מה התשובה ל-24 + 37",
  "תפתור לי את זה",
  "פתור את התרגיל 24 + 37",
  "תעשה לי את זה",
  "פשוט תגיד לי",
  "עשה בשבילי 24 + 37",
];
for (const text of DEMANDS) {
  t(`declines "${text}"`, () => {
    assert.equal(parseHomeworkProblem(text).kind, "asking-for-answer");
  });
}

t("the demand outranks the arithmetic beside it — the request is what is declined", () => {
  const p = parseHomeworkProblem("תגיד לי את התשובה של 24 + 37");
  assert.equal(p.kind, "asking-for-answer", "it must not quietly start a walkthrough instead");
});

t("a plain problem is NOT read as a demand, however it is phrased", () => {
  for (const text of ["כמה זה 24 + 37?", "24 + 37 = ?", "מה זה 5 + 3", "כמה יוצא 8 - 3?"]) {
    assert.equal(isAskingForTheAnswer(text), false, `"${text}" is a problem, not a demand`);
    assert.equal(parseHomeworkProblem(text).kind, "arithmetic", text);
  }
});

console.log("\nthe expression finder");

t("finds the longest run, not the first", () => {
  assert.deepEqual(extractExpression("תרגיל 3: 15 - 7 + 4"), { operands: [15, 7, 4], operators: ["-", "+"] });
  // A genuinely earlier, shorter expression must lose to the longer one.
  assert.deepEqual(extractExpression("דוגמה 3 + 1, ועכשיו 15 - 7 + 4"), { operands: [15, 7, 4], operators: ["-", "+"] });
});

t("returns null when there is no operator to work with", () => {
  assert.equal(extractExpression("42"), null);
  assert.equal(extractExpression("עמוד 42 שאלה 3"), null);
  assert.equal(extractExpression("שלום"), null);
});

console.log("\nthe flag");

t("off unless explicitly '1' — an unrecognised value never means on", () => {
  assert.equal(homeworkModeEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(homeworkModeEnabled({ HOMEWORK_MODE: "1" } as unknown as NodeJS.ProcessEnv), true);
  for (const v of ["", "0", "true", "yes", "on", "TRUE", " 1"]) {
    assert.equal(homeworkModeEnabled({ HOMEWORK_MODE: v } as unknown as NodeJS.ProcessEnv), false, `"${v}" must not enable it`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
