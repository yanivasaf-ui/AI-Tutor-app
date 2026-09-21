/**
 * fill_in_blank: a topical preamble, then the computation.
 *
 * The old guidance ordered a bare computation and "not a word problem",
 * while a resolved topic simultaneously demanded topic content. The two
 * could not both be satisfied, and the bank shows which one won: every
 * bare-computation leak found by the BUG B audit is a fill_in_blank
 * (docs/investigations/BUG-B-topic-boundary.md).
 *
 * The good rows in the bank already resolve it — one grounding sentence,
 * then the computation in digits:
 *   "בדיאגרמת העמודות מוצגים חודשי הלידה... כמה זה 5 + 4 + 3?"
 *   "לרועי יש 5 משולשים. כמה צלעות יש לכל המשולשים ביחד? חשבו: 5 × 3"
 *
 * What must not break: the computation still has to appear literally, or
 * questionStatesComputation() rejects the draft and the child's answer can
 * no longer be graded in code.
 *
 * Run: npx tsx tests/fill-in-blank-prompt.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { questionStatesComputation } from "../lib/exercises/arithmetic";
import { topicFit } from "../lib/exercises/topic-fit";
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

const src = readFileSync(new URL("../lib/exercises/generate.ts", import.meta.url), "utf8");
const guidance = src.slice(src.indexOf("fill_in_blank:"), src.indexOf("pick_operation:"));

console.log("the guidance");

t("asks for a grounding sentence before the computation", () => {
  assert.match(guidance, /משפט פתיחה קצר/, "the preamble must be asked for");
  assert.match(guidance, /שני חלקים/, "the two-part structure must be stated");
});

t("still demands the computation literally, in digits and an operator sign", () => {
  assert.match(guidance, /בספרות ובסימן הפעולה/);
  assert.match(guidance, /לא מחליף את התרגיל/, "the preamble must not be allowed to replace the computation");
});

t("the contradiction is gone: it no longer forbids topical framing outright", () => {
  assert.ok(
    !/\(למשל "כמה זה 10 × 4\?"\), לא כבעיה מילולית/.test(guidance),
    "the old 'not a word problem' clause conflicted with the topic instruction and must be gone"
  );
});

t("...but it still keeps this a computation drill, not a word problem to decode", () => {
  assert.match(guidance, /רק לחשב/, "the child must still only have to compute");
  assert.match(guidance, /לא בעיה מילולית שצריך לפענח/);
});

t("free practice, with no content topic, may still be the bare computation", () => {
  assert.match(guidance, /תרגול חופשי/);
});

t("the computation contract is untouched — code still owns the result", () => {
  assert.match(guidance, /אל תחשב\/י את התוצאה/);
  assert.match(guidance, /operands/);
  assert.match(guidance, /מותר לשרשר רק \+ ו-/);
  assert.match(guidance, /רק חלוקה ללא שארית/);
});

console.log("\nquestions in the new shape still pass the gates they have to pass");

const ex = (question: string, topicId: string, operands: number[], operators: ("+" | "-" | "*" | "/")[]): Exercise =>
  ({
    id: "x", subject: "math", grade: "א", type: "open", subtype: "fill_in_blank",
    topic: "t", topicId, question, correctAnswer: "0", difficulty: 2,
    computation: { operands, operators },
  }) as Exercise;

// Real rows from the bank, in exactly the shape the new guidance asks for.
const GOOD: [string, Exercise][] = [
  ["data preamble then a three-term sum", ex("בדיאגרמת העמודות מוצגים חודשי הלידה של תלמידי הכיתה. בחודש ינואר נולדו 3 ילדים, בפברואר 5 ילדים, במרץ 2 ילדים, באפריל 4 ילדים ובמאי 3 ילדים. כמה זה 5 + 4 + 3?", "math-a-data", [5, 4, 3], ["+", "+"])],
  ["geometry preamble then a product", ex("לרועי יש 5 משולשים. כמה צלעות יש לכל המשולשים ביחד? חשבו: 5 × 3", "math-a-geometry", [5, 3], ["*"])],
  ["length preamble then a sum", ex("אורן מדד את אורך השולחן שלו באטבים. בשורה הראשונה הוא שם 12 אטבים. בשורה השנייה הוא שם עוד 8 אטבים. כמה אטבים בסך הכול השתמש אורן? כתבו את התרגיל ואת התשובה: 12 + 8 = ?", "math-a-length", [12, 8], ["+"])],
];

for (const [name, e] of GOOD) {
  t(`${name}: the computation is still found in the question`, () => {
    assert.ok(questionStatesComputation(e.question, e.computation!), "questionStatesComputation must still match");
  });
  t(`${name}: and it now counts as on-topic`, () => {
    assert.equal(topicFit(e, e.topicId).ok, true, "a preamble in the topic's own words is what makes it fit");
  });
}

t("a preamble carrying its own numbers does not break the computation scan", () => {
  // The preamble states 3, 5, 2, 4, 3 before the computation's 5 + 4 + 3.
  const e = GOOD[0][1];
  assert.ok(questionStatesComputation(e.question, e.computation!));
});

t("the bare form the old guidance produced is still recognised as a leak", () => {
  const bare = ex("כמה זה 5 + 3?", "math-a-data", [5, 3], ["+"]);
  assert.ok(questionStatesComputation(bare.question, bare.computation!), "it was always well-formed");
  assert.equal(topicFit(bare, "math-a-data").ok, false, "...and always off-topic — that is the leak this rewrite removes");
});

t("in an arithmetic topic the bare computation is still perfectly on-topic", () => {
  const bare = ex("כמה זה 5 + 3?", "math-b-arithmetic", [5, 3], ["+"]);
  assert.equal(topicFit(bare, "math-b-arithmetic").ok, true);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
