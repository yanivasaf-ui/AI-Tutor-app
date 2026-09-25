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
 *  1b. THE RULES ADDED AFTER THE LIVE RUN — verbatim exercises from the
 *     80-question run: "0, 2, 3, ?" (answer 5) must fail series-
 *     determinate; the shape requests that came back as word problems must
 *     fail no-pattern-drift; real shape and number patterns must pass.
 *  1c. DEFECTS THE MODEL REVIEWER FOUND in questions the first calibration
 *     labelled clean: 3 are rejected in code (a clock time as an operand,
 *     איזה/איזו gender, an equation blank copied from the story); 1 has no
 *     code rule and is pinned as a known gap.
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
import type { RuleId } from "../lib/authoring/rubric";

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

// ---------------------------------------------------------------- 1b. rules added after the live run
console.log("\nseries determinism and pattern drift (verbatim from the 80-question live run, 2026-09-25)");
/** One live-run exercise, as generated: tiles present only when the model
 *  returned them (the drifted shape requests came back with none). */
interface LivePattern {
  ref: string;
  grade: Grade;
  topicId: string;
  subtype: "shape_match" | "pattern_completion";
  question: string;
  correctAnswer: string;
  tiles?: string[];
  expect: "series-determinate" | "no-pattern-drift" | "pass";
}
const LIVE_RUN_PATTERNS: LivePattern[] = [
 {
  "ref": "math-b-geometry #4",
  "grade": "ב",
  "topicId": "math-b-geometry",
  "subtype": "pattern_completion",
  "question": "נועם מסדר משולשים לפי מספר הצלעות השוות שלהם. הוא מתחיל ממשולש שונה-צלעות (אפס צלעות שוות), אחר כך שווה-שוקיים (2 צלעות שוות), ואז שווה-צלעות (3 צלעות שוות). איזה מספר צריך להופיע אחרון ברצף: 0, 2, 3, ?",
  "correctAnswer": "5",
  "tiles": [
   "4",
   "5",
   "6",
   "3"
  ],
  "expect": "series-determinate"
 },
 {
  "ref": "math-b-arithmetic #3",
  "grade": "ב",
  "topicId": "math-b-arithmetic",
  "subtype": "shape_match",
  "question": "למורה דני יש 24 עפרונות צבעוניים. הוא רוצה לחלק אותם שוה בשוה ל-4 ילדים. כמה עפרונות יקבל כל ילד?",
  "correctAnswer": "6",
  "expect": "no-pattern-drift"
 },
 {
  "ref": "math-b-arithmetic #5",
  "grade": "ב",
  "topicId": "math-b-arithmetic",
  "subtype": "shape_match",
  "question": "לאמא יש 24 עוגיות. היא רוצה לחלק אותן שוה בשוה ל-4 ילדים. כמה עוגיות יקבל כל ילד?",
  "correctAnswer": "6",
  "expect": "no-pattern-drift"
 },
 {
  "ref": "math-b-time #1",
  "grade": "ב",
  "topicId": "math-b-time",
  "subtype": "shape_match",
  "question": "שיעור הספורט התחיל בשעה 10:00 בבוקר.\nהשיעור נמשך שעתיים.\nבאיזו שעה נגמר שיעור הספורט?",
  "correctAnswer": "12:00",
  "expect": "no-pattern-drift"
 },
 {
  "ref": "math-b-volume #3",
  "grade": "ב",
  "topicId": "math-b-volume",
  "subtype": "shape_match",
  "question": "רון בנה תיבה מקוביות קטנות. בכל שכבה יש לו 6 קוביות. הוא בנה 3 שכבות אחת על השנייה. כמה קוביות השתמש רון בסך הכל?",
  "correctAnswer": "18",
  "expect": "no-pattern-drift"
 },
 {
  "ref": "math-b-volume #5",
  "grade": "ב",
  "topicId": "math-b-volume",
  "subtype": "shape_match",
  "question": "דני בנה תיבה מקוביות קטנות.\nבכל שכבה יש 6 קוביות.\nהוא בנה 3 שכבות.\nכמה קוביות דני השתמש בסך הכל?",
  "correctAnswer": "18",
  "expect": "no-pattern-drift"
 },
 {
  "ref": "math-g-arithmetic #1",
  "grade": "ג",
  "topicId": "math-g-arithmetic",
  "subtype": "shape_match",
  "question": "בספרייה היו 2,345 ספרים. הגיעו עוד 1,428 ספרים חדשים. כמה ספרים יש עכשיו בספרייה?",
  "correctAnswer": "3773",
  "expect": "no-pattern-drift"
 },
 {
  "ref": "math-g-arithmetic #5",
  "grade": "ג",
  "topicId": "math-g-arithmetic",
  "subtype": "shape_match",
  "question": "בספרייה היו 2,456 ספרים. קנו עוד 1,378 ספרים חדשים. כמה ספרים יש עכשיו בספרייה?",
  "correctAnswer": "3834",
  "expect": "no-pattern-drift"
 },
 {
  "ref": "math-g-time #4",
  "grade": "ג",
  "topicId": "math-g-time",
  "subtype": "shape_match",
  "question": "נועה התחילה לצייר בשעה 3:15 וסיימה בשעה 4:00. כמה זמן היא ציירה?",
  "correctAnswer": "45 דקות",
  "expect": "no-pattern-drift"
 },
 {
  "ref": "math-b-numbers-0-1000 #4",
  "grade": "ב",
  "topicId": "math-b-numbers-0-1000",
  "subtype": "shape_match",
  "question": "הנה רצף של ספירה בדילוגים:\n\n🔟 2️⃣0️⃣ 🔟 2️⃣0️⃣ ___\n\nאיזו צורה ממשיכה את הדפוס?",
  "correctAnswer": "🔟",
  "tiles": [
   "🔟",
   "2️⃣0️⃣",
   "5️⃣0️⃣",
   "🔢"
  ],
  "expect": "no-pattern-drift"
 },
 {
  "ref": "math-b-numbers-0-1000 #2",
  "grade": "ב",
  "topicId": "math-b-numbers-0-1000",
  "subtype": "pattern_completion",
  "question": "דני קופץ על המדרגות. הוא קופץ על מדרגות: 100, 200, 300, 400. על איזו מדרגה הוא יקפץ הבא?",
  "correctAnswer": "500",
  "tiles": [
   "500",
   "450",
   "600",
   "510"
  ],
  "expect": "pass"
 },
 {
  "ref": "math-g-geometry #2",
  "grade": "ג",
  "topicId": "math-g-geometry",
  "subtype": "shape_match",
  "question": "הסתכלו על רצף הצורות:\n🔺 🟦 🟦 🔺 🟦 🟦 🔺 ___\n\nאיזו צורה צריכה להופיע במקום הריק?",
  "correctAnswer": "🟦",
  "tiles": [
   "🔺",
   "🟦",
   "⭐",
   "🔵"
  ],
  "expect": "pass"
 },
 {
  "ref": "math-g-geometry #5",
  "grade": "ג",
  "topicId": "math-g-geometry",
  "subtype": "shape_match",
  "question": "תסתכלו על הרצף:\n🔺 🟦 🟦 🔺 🔺 🟦 🟦 🔺 🔺 ___\n\nאיזו צורה צריך לשים במקום הריק?",
  "correctAnswer": "🟦",
  "tiles": [
   "🟦",
   "🔺",
   "⭐",
   "🔵"
  ],
  "expect": "pass"
 },
 {
  "ref": "math-g-volume #4",
  "grade": "ג",
  "topicId": "math-g-volume",
  "subtype": "shape_match",
  "question": "רונית בונה תיבות מנייר. היא בנתה תיבה גדולה, אחר כך תיבה קטנה, ושוב תיבה גדולה, ושוב תיבה קטנה.\nאיזו תיבה היא תבנה הבאה?\n\n📦 📭 📦 📭 ___",
  "correctAnswer": "📦",
  "tiles": [
   "📦",
   "📭",
   "🎁",
   "📮"
  ],
  "expect": "pass"
 },
 {
  "ref": "math-g-volume #1",
  "grade": "ג",
  "topicId": "math-g-volume",
  "subtype": "pattern_completion",
  "question": "רונית בונה תיבות מקוביות. התיבה הראשונה מכילה 6 קוביות, השנייה 12 קוביות, השלישית 18 קוביות. כמה קוביות יש בתיבה הרביעית?",
  "correctAnswer": "24",
  "tiles": [
   "24",
   "20",
   "22",
   "26"
  ],
  "expect": "pass"
 },
 {
  "ref": "math-g-numbers-0-10000 #1",
  "grade": "ג",
  "topicId": "math-g-numbers-0-10000",
  "subtype": "pattern_completion",
  "question": "דני אוסף מדבקות. ביום ראשון היו לו 1,000 מדבקות. בכל יום הוא מוסיף עוד 500 מדבקות. ביום שני היו לו 1,500 מדבקות. ביום שלישי היו לו 2,000 מדבקות. ביום רביעי היו לו 2,500 מדבקות. כמה מדבקות היו לדני ביום חמישי?",
  "correctAnswer": "3000",
  "tiles": [
   "3000",
   "2800",
   "3500",
   "3200"
  ],
  "expect": "pass"
 },
 {
  "ref": "math-g-numbers-0-10000 #4",
  "grade": "ג",
  "topicId": "math-g-numbers-0-10000",
  "subtype": "pattern_completion",
  "question": "נועה אוספת מדבקות. ביום הראשון יש לה 1,000 מדבקות. ביום השני יש לה 1,500 מדבקות. ביום השלישי יש לה 2,000 מדבקות. ביום הרביעי יש לה 2,500 מדבקות. כמה מדבקות יהיו לה ביום החמישי?",
  "correctAnswer": "3000",
  "tiles": [
   "2800",
   "3000",
   "3200",
   "2900"
  ],
  "expect": "pass"
 }
];
function liveExercise(f: LivePattern): Exercise {
  return {
    id: f.ref, subject: "math", grade: f.grade, topic: "t", topicId: f.topicId, subtype: f.subtype,
    type: f.tiles ? "tile_order" : "open",
    tiles: f.tiles ? { items: f.tiles, slotCount: 1, joinWith: " " } : undefined,
    question: f.question, correctAnswer: f.correctAnswer,
  } as Exercise;
}
for (const f of LIVE_RUN_PATTERNS) {
  const label = f.expect === "pass" ? "passes" : `is rejected — ${f.expect}`;
  t(`REAL ${f.ref} (${f.subtype}) ${label}: "${f.question.replace(/\s+/g, " ").slice(0, 50)}…"`, () => {
    const got = rules(liveExercise(f));
    if (f.expect === "pass") assert.deepEqual(got, []);
    else assert.ok(got.includes(f.expect), JSON.stringify(got));
  });
}
t("a written series with one rule passes; with none, when its next term is asked, it is rejected", () => {
  const q = (question: string, subtype?: Exercise["subtype"]) => rules(ex({ question, subtype, type: "open" }));
  assert.ok(!q("השלימו: 4, 8, 12, 16, ___").includes("series-determinate"));
  assert.ok(q("השלימו: 0, 2, 3, ___").includes("series-determinate"));
  assert.ok(q("מה המספר הבא? 1, 2, 4, 7, ?").includes("series-determinate"));
  // Only constant-difference series are generated (SUBTYPE_GUIDANCE), so a
  // doubling series is not a determinate one here either.
  assert.ok(q("השלימו: 2, 4, 8, ___").includes("series-determinate"));
});
t("a LIST of numbers is not a series: the Ministry's 'איזה מהמספרים הבאים…: 7, 15, 23, 12?' is not flagged", () => {
  assert.ok(!rules(ex({ question: "איזה מהמספרים הבאים יכול להיות מספר החרוזים הירוקים במחרוזת: 7, 15, 23, 12?" })).includes("series-determinate"));
  assert.ok(!rules(ex({ question: "אביאל בונה מספרים מהספרות הבאות: 9,6,2. כמה מספרים הוא יכול לבנות?" })).includes("series-determinate"));
});

// ---------------------------------------------------------------- 1c. reviewer-confirmed defects
console.log("\ndefects the model reviewer found in questions labelled clean (calibration, 2026-09-25)");
/** Verbatim from the 80-question live run. `gate: "code"`: the code gate
 *  rejects it, with that rule. `gate: "review-only"`: no code rule exists —
 *  it is a known gap the reviewer alone covers (see below). */
interface ConfirmedDefect { ref: string; why: string; gate: "code" | "review-only"; rule: RuleId; exercise: Partial<Exercise> & { question: string } }
const CONFIRMED_DEFECTS: ConfirmedDefect[] = [
  {
    ref: "math-g-time #5", gate: "code", rule: "unambiguous-answer",
    why: "the correct choice '3:15 + 45' adds minutes to a clock time as if it were a number, with no conversion given",
    exercise: {
      grade: "ג", subtype: "pick_operation", type: "multiple_choice",
      question: "נועה התחילה לשחק בגינה בשעה 3:15. היא שיחקה במשך 45 דקות. איזו פעולה תעזור לנו למצוא באיזו שעה נועה סיימה לשחק?",
      choices: ["3:15 + 45", "3:15 - 45", "3:15 × 45", "45 ÷ 3:15"], correctAnswer: "3:15 + 45",
    },
  },
  {
    ref: "math-b-data #1", gate: "code", rule: "spoken-hebrew",
    why: "'איזו פירות' — the feminine איזו with a masculine noun",
    exercise: {
      grade: "ב", subtype: "explain_thinking", type: "open",
      question: "המורה שאלה את הילדים בכיתה איזו פירות הם הכי אוהבים. היא בנתה דיאגרמת עמודות: תפוח - 5 ילדים, בננה - 8 ילדים, תפוז - 3 ילדים, ענבים - 6 ילדים.\n\nהסבירי איך את יכולה לגלות איזו פרי הכי פחות ילדים אוהבים, בלי לספור שוב.",
      correctAnswer: "הסבר טוב מזכיר השוואה בין גבהי העמודות או בין המספרים",
    },
  },
  {
    ref: "math-g-data #4", gate: "code", rule: "internal-consistency",
    why: "asks how many MORE like apples (5), but the blank's answer (7) is a number the story already states; 12 - 7 = 5 restates the answer instead of asking for it",
    exercise: {
      grade: "ג", subtype: "equation_balance", type: "tile_order",
      question: "דני ספר כמה ילדים אוהבים כל פרי. הוא בנה דיאגרמת עמודות. העמודה של תפוחים הגיעה ל-12 ילדים, והעמודה של תפוזים הגיעה ל-7 ילדים. כמה ילדים יותר אוהבים תפוחים מאשר תפוזים?\n\n12 - ___ = 5",
      tiles: { items: ["7", "5", "6", "8"], slotCount: 1, joinWith: " " }, correctAnswer: "7",
    },
  },
  {
    ref: "math-g-volume #5", gate: "review-only", rule: "internal-consistency",
    why: "a tower row with 0 cubes: 4, then 2 fewer each row up, and the third row is 0 — not a row, and a count of nothing placed on an axis",
    exercise: {
      grade: "ג", subtype: "number_line_placement", type: "number_line",
      question: "דני בנה מגדל מקוביות. בשורה התחתונה יש לו 4 קוביות. בכל שורה מעל יש לו פחות 2 קוביות מהשורה שמתחת. היכן על הציר נמצא מספר הקוביות בשורה השלישית?",
      correctAnswer: "0",
    },
  },
];
const defect = (d: ConfirmedDefect): Exercise => ex({ id: d.ref, ...d.exercise });
for (const d of CONFIRMED_DEFECTS.filter((x) => x.gate === "code")) {
  t(`REAL ${d.ref} is rejected — ${d.rule}: ${d.why.slice(0, 60)}…`, () => {
    assert.ok(rules(defect(d)).includes(d.rule), JSON.stringify(rules(defect(d))));
  });
}
t("KNOWN GAP: the tower row that reaches 0 cubes has no code rule — the gate passes it, only the model review catches it (if a rule is ever added, move it to gate:'code')", () => {
  for (const d of CONFIRMED_DEFECTS.filter((x) => x.gate === "review-only")) {
    assert.deepEqual(rules(defect(d)), [], `${d.ref} is now caught by the code gate: promote it to gate:"code"`);
  }
});
t("the checks are narrow: correct look-alikes pass", () => {
  // a time answer that is a time, not an operation on one
  assert.deepEqual(rules(ex({ question: "שיעור הספורט התחיל בשעה 10:00. הוא נמשך שעתיים. באיזו שעה נגמר?", correctAnswer: "12:00" })), []);
  // איזה/איזו agreeing with the noun
  assert.deepEqual(rules(ex({ question: "איזה פרי הכי אוהבים בכיתה?" })), []);
  assert.deepEqual(rules(ex({ question: "איזו צורה יש לכדור?" })), []);
  // an equation whose blank is NOT a number the story gave
  assert.deepEqual(
    rules(ex({ grade: "ג", subtype: "equation_balance", type: "tile_order", question: "לנועה יש 24 מדבקות. היא קיבלה עוד ואז היו לה 30. כמה קיבלה?\n\n24 + ___ = 30", tiles: { items: ["6", "5", "7", "8"], slotCount: 1, joinWith: " " }, correctAnswer: "6" })),
    []
  );
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
