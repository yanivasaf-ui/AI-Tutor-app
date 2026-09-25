/**
 * BUG B regression: exercises leaking across topic boundaries.
 *
 * The live bank held rows that were CORRECTLY tagged and entirely off-topic —
 * "כמה זה 15 - 7 + 4?" filed under measuring time, "כמה זה 5 + 3?" under
 * gematria, "כמה זה 12 × 8?" under area — and nothing checked a row against its
 * topic (bank-guard only checks that an exercise agrees with itself). Fixtures
 * marked REAL are rows read from the production bank on 2026-09-20; the few
 * marked CONSTRUCTED exist only to pin a rule the bank happens not to
 * exercise.
 *
 * Three layers are covered: the predicate itself (topicFit), SERVING (a leaky
 * row in the table is never handed to a kid), and ADMISSION (generateExercise
 * refuses to return an off-topic draft and asks again, with a corrective hint).
 *
 * Run: npx tsx tests/topic-fit.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { topicFit, ARITHMETIC_TOPICS, TOPIC_ANCHORS } from "../lib/exercises/topic-fit";
import { findReusableExercise } from "../lib/exercises/store";
import { generateExercise, TopicFitError } from "../lib/exercises/generate";
import { getAnthropicClient } from "../lib/llm/anthropic";
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

let n = 0;
function ex(topicId: string, over: Partial<Exercise>): Exercise {
  return {
    id: `fx${++n}`,
    subject: "math",
    grade: "ג",
    type: "open",
    topic: "x",
    topicId,
    question: "",
    correctAnswer: "1",
    difficulty: 2,
    ...over,
  } as Exercise;
}
const bare = (topicId: string, q: string, operands: number[], operators: ("+" | "-" | "*" | "/")[]) =>
  ex(topicId, { subtype: "fill_in_blank", question: q, computation: { operands, operators } });
const stars = (k: number, emoji: string) => Array.from({ length: k }, () => emoji);

// ---------- REAL leaks (must be rejected) ----------
const LEAKS: [string, Exercise][] = [
  ["math-a-time: 'כמה זה 15 - 7 + 4?'", bare("math-a-time", "כמה זה 15 - 7 + 4?", [15, 7, 4], ["-", "+"])],
  ["math-a-time: 'כמה זה 7 + 5?'", bare("math-a-time", "כמה זה 7 + 5?", [7, 5], ["+"])],
  ["math-b-time: 'כמה זה 2 + 1?'", bare("math-b-time", "כמה זה 2 + 1?", [2, 1], ["+"])],
  ["math-b-length: 'כמה זה 5 + 3?'", bare("math-b-length", "כמה זה 5 + 3?", [5, 3], ["+"])],
  ["math-b-volume: 'כמה זה 3 × 2?'", bare("math-b-volume", "כמה זה 3 × 2?", [3, 2], ["*"])],
  ["math-g-area: 'כמה זה 12 × 8?'", bare("math-g-area", "כמה זה 12 × 8?", [12, 8], ["*"])],
  ["math-g-gematria: 'כמה זה 5 + 3?'", bare("math-g-gematria", "כמה זה 5 + 3?", [5, 3], ["+"])],
  ["math-g-gematria: 'כמה זה 7 + 30 + 200?'", bare("math-g-gematria", "כמה זה 7 + 30 + 200?", [7, 30, 200], ["+", "+"])],
  [
    "math-g-gematria: word problem about balls",
    ex("math-g-gematria", {
      type: "multiple_choice",
      subtype: "pick_operation",
      question: "לדני יש 5 כדורים. לרותי יש 3 כדורים. כמה כדורים יש להם ביחד? איזו פעולה פותרת את הבעיה?",
      choices: ["5 + 3", "5 - 3", "5 × 3", "5 ÷ 3"],
    }),
  ],
  [
    "math-g-gematria: division grouping ('חלקי אותם' contains the letters 'אות')",
    ex("math-g-gematria", {
      type: "grouping",
      subtype: "visual_grouping",
      question: "לפניך 15 כוכבים. חלקי אותם ל-3 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?",
      grouping: { items: stars(15, "⭐"), groupCount: 3 },
    }),
  ],
  [
    "math-a-time: division grouping of stars",
    ex("math-a-time", {
      type: "grouping",
      subtype: "visual_grouping",
      question: "לאורי יש 12 כוכבים ⭐. הוא רוצה לחלק אותם ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?",
      grouping: { items: stars(12, "⭐"), groupCount: 4 },
    }),
  ],
  [
    "math-a-data: '5 + ___ = 8' equation tiles",
    ex("math-a-data", {
      type: "tile_order",
      subtype: "equation_balance",
      question: "5 + ___ = 8",
      tiles: { items: ["2", "3", "4", "5"], slotCount: 1, joinWith: " " },
    }),
  ],
  [
    "math-a-data: fruit division grouping",
    ex("math-a-data", {
      type: "grouping",
      subtype: "visual_grouping",
      question: "חלקו את הפירות ל-3 קבוצות שוות. כמה פירות יש בכל קבוצה?",
      grouping: { items: stars(9, "🍎"), groupCount: 3 },
    }),
  ],
];

// ---------- REAL on-topic rows (must be accepted) ----------
const GOOD: [string, Exercise][] = [
  [
    "math-a-geometry: triangles built from straws",
    ex("math-a-geometry", {
      type: "tile_order",
      subtype: "pattern_completion",
      question: "דני בונה משולשים מקשיות. משולש אחד צריך 3 קשיות, שני משולשים צריכים 6 קשיות, שלושה משולשים צריכים 9 קשיות. כמה קשיות יצטרכו לארבעה משולשים?",
      tiles: { items: ["10", "11", "12", "13"], slotCount: 1, joinWith: " " },
    }),
  ],
  ["math-a-geometry: sides of triangles", ex("math-a-geometry", { subtype: "fill_in_blank", question: "לרועי יש 5 משולשים. כמה צלעות יש לכל המשולשים ביחד? חשבו: 5 × 3", computation: { operands: [5, 3], operators: ["*"] } })],
  ["math-a-length: measuring with clothes-pegs", ex("math-a-length", { subtype: "fill_in_blank", question: "אורן מדד את אורך השולחן שלו באטבים. בשורה הראשונה הוא שם 12 אטבים. בשורה השנייה הוא שם עוד 8 אטבים. כמה אטבים בסך הכול השתמש אורן? כתבו את התרגיל ואת התשובה: 12 + 8 = ?", computation: { operands: [12, 8], operators: ["+"] } })],
  ["math-b-time: clock times", ex("math-b-time", { type: "multiple_choice", subtype: "pick_operation", question: "דני התחיל לשחק בגינה בשעה 2:00. הוא סיים לשחק בשעה 5:30. דני רוצה לדעת כמה זמן הוא שיחק בגינה. איזו פעולה חשבון תעזור לו?", choices: ["חיסור: 5:30 פחות 2:00", "חיבור: 5:30 ועוד 2:00", "כפל: 5:30 כפול 2", "חיבור: 2:00 ועוד 30 דקות"] })],
  ["math-g-time: times only in the choices", ex("math-g-time", { type: "multiple_choice", subtype: "pick_operation", question: "רון התחיל לשחק בשעה 3:00. הוא סיים לשחק בשעה 5:00. איזו פעולה תעזור לרון לדעת כמה זמן הוא שיחק?", choices: ["5:00 - 3:00", "5:00 + 3:00", "5:00 × 3:00", "5:00 ÷ 3:00"] })],
  ["math-g-area: rows of squares", ex("math-g-area", { type: "multiple_choice", subtype: "pick_operation", question: "לימור רוצה לחשב את השטח של מלבן שיש בו 8 שורות של ריבועים, ובכל שורה יש 12 ריבועים. איזו פעולת חשבון תעזור לה למצוא את מספר הריבועים הכולל?", choices: ["8 + 12", "8 × 12", "12 - 8", "12 ÷ 8"] })],
  ["math-g-volume: a box net", ex("math-g-volume", { type: "multiple_choice", subtype: "pick_operation", question: "דני קיבל פריסה של תיבה. הפריסה כוללת 6 מלבנים: 2 מלבנים גדולים, 2 מלבנים בינוניים ו-2 מלבנים קטנים. כמה פאות יהיו לתיבה לאחר שדני יקפל את הפריסה?", choices: ["4 + 2", "2 + 2 + 2", "6 × 2", "6 + 6"] })],
  ["math-g-gematria: letter values", ex("math-g-gematria", { type: "tile_order", subtype: "equation_balance", question: "רונן חישב את ערך המילה 'אב' בגימטרייה. הוא קיבל: א' (1) + ב' (___) = 3. מהו ערך האות ב'?", tiles: { items: ["2", "1", "3", "4"], slotCount: 1, joinWith: " " } })],
  ["math-g-multiplication-division: dividing books", ex("math-g-multiplication-division", { type: "multiple_choice", subtype: "pick_operation", question: "בספרייה יש 8,000 ספרים. רוצים לסדר אותם על מדפים כך שבכל מדף יהיו 100 ספרים. איזו פעולה חשבונית תעזור לנו למצוא כמה מדפים נצטרך?", choices: ["8,000 + 100", "8,000 - 100", "8,000 × 100", "8,000 ÷ 100"] })],
  ["math-a-data: bar chart of birth months", ex("math-a-data", { subtype: "fill_in_blank", question: "בדיאגרמת העמודות מוצגים חודשי הלידה של תלמידי הכיתה. בחודש ינואר נולדו 3 ילדים, בפברואר 5 ילדים, במרץ 2 ילדים, באפריל 4 ילדים ובמאי 3 ילדים. כמה זה 5 + 4 + 3?", computation: { operands: [5, 4, 3], operators: ["+", "+"] } })],
  ["math-b-data: a poll's results", ex("math-b-data", { type: "multiple_choice", subtype: "pick_operation", question: "המורה שאלה את הילדים באיזה עונה נולדו. התוצאות: אביב - 5 ילדים, קיץ - 8 ילדים, סתיו - 3 ילדים, חורף - 6 ילדים. באיזו פעולה נשתמש כדי לדעת כמה יותר ילדים נולדו בקיץ מאשר באביב?", choices: ["8 + 5", "8 - 5", "8 + 3", "6 - 3"] })],
];

// ---------- REAL rows the first cut of this check wrongly REJECTED ----------
// Found by auditing the live bank (2026-09-21) and re-checked by hand: every
// one is genuinely about its topic, so the check must not drop it.
const WRONGLY_REJECTED: [string, Exercise][] = [
  ["math-g-multiplication-division: skip counting by 1,000 (a run of multiples)", ex("math-g-multiplication-division", { type: "tile_order", subtype: "pattern_completion", question: "בחנות צעצועים יש מדפים עם דובונים. על המדף הראשון יש 1,000 דובונים, על השני 2,000 דובונים, על השלישי 3,000 דובונים ועל הרביעי 4,000 דובונים. כמה דובונים יש על המדף החמישי?", tiles: { items: ["5000", "4500", "5500", "6000"], slotCount: 1, joinWith: " " } })],
  ["math-g-multiplication-division: skip counting by 10", ex("math-g-multiplication-division", { type: "tile_order", subtype: "pattern_completion", question: "רונית סופרת באתר החפירות. היא מצאה 10 כדים, אחר כך 20 כדים, אחר כך 30 כדים. כמה כדים היא תמצא בספירה הבאה?", tiles: { items: ["40", "35", "50", "45"], slotCount: 1, joinWith: " " } })],
  ["math-g-multiplication-division: skip counting by 300", ex("math-g-multiplication-division", { type: "tile_order", subtype: "pattern_completion", question: "חנות צעצועים קיבלה משלוחי צעצועים בכל שבוע. בשבוע הראשון הגיעו 300 צעצועים, בשבוע השני 600 צעצועים, בשבוע השלישי 900 צעצועים ובשבוע הרביעי 1,200 צעצועים. כמה צעצועים יגיעו בשבוע החמישי אם הרצף ממשיך?", tiles: { items: ["1500", "1400", "1600", "1800"], slotCount: 1, joinWith: " " } })],
  ["math-b-geometry: a tower of cubes (a cube IS a shape)", ex("math-b-geometry", { grade: "ב", type: "tile_order", subtype: "pattern_completion", question: "יעל בונה מגדל מקוביות. היא סופרת את הקוביות: 2, 4, 6, 8... כמה קוביות תהיינה במקום הבא?", tiles: { items: ["9", "10", "11", "12"], slotCount: 1, joinWith: " " } })],
];

console.log("the predicate: real leaks are rejected");
for (const [name, e] of LEAKS) {
  t(name, () => {
    const fit = topicFit(e, e.topicId);
    assert.equal(fit.ok, false, "a correctly-tagged, off-topic exercise was accepted");
    assert.equal(fit.checked, true);
    assert.match(fit.reason ?? "", /math-/, "a rejection must say which topic it missed");
  });
}

console.log("\nthe predicate: real on-topic rows are accepted (the guard must not eat good exercises)");
for (const [name, e] of GOOD) {
  t(name, () => {
    const fit = topicFit(e, e.topicId);
    assert.equal(fit.ok, true, `rejected a good exercise: ${fit.reason}`);
    assert.equal(fit.checked, true);
  });
}

console.log("\nthe predicate: rows an earlier cut wrongly rejected (false positives found in the live bank)");
for (const [name, e] of WRONGLY_REJECTED) {
  t(name, () => {
    const fit = topicFit(e, e.topicId);
    assert.equal(fit.ok, true, `still rejected: ${fit.reason}`);
  });
}
t("...and the leniency that admits them is SCOPED: a bare sum stays a leak in multiplication-division", () => {
  assert.equal(topicFit(bare("math-g-multiplication-division", "כמה זה 5 + 3?", [5, 3], ["+"]), "math-g-multiplication-division").ok, false);
});
t("...and a skip-counting pattern in a topic that is NOT multiplication is still judged on vocabulary", () => {
  const seq = ex("math-a-data", { grade: "א", type: "tile_order", subtype: "pattern_completion", question: "5, 10, 15, 20... מה המספר הבא?", tiles: { items: ["25", "30"], slotCount: 1, joinWith: " " } });
  assert.equal(topicFit(seq, "math-a-data").ok, false, "the pattern_completion allowance must not leak to other topics");
});
t("solids count as geometry vocabulary (cube, box, sphere, cylinder)", () => {
  for (const w of ["קובייה", "תיבה", "כדור", "גליל"]) {
    assert.equal(topicFit(ex("math-g-geometry", { question: `כמה פאות יש ל${w}?` }), "math-g-geometry").ok, true, w);
  }
});

console.log("\nthe predicate: scope");
t("arithmetic topics ARE computation: a bare sum is on-topic there", () => {
  for (const id of ARITHMETIC_TOPICS) {
    const fit = topicFit(bare(id, "כמה זה 7 + 5?", [7, 5], ["+"]), id);
    assert.deepEqual([fit.ok, fit.checked], [true, true], id);
  }
});
t("the SAME bare sum is a leak in every content topic that has a rule", () => {
  for (const id of Object.keys(TOPIC_ANCHORS).filter((k) => k !== "math-g-multiplication-division")) {
    assert.equal(topicFit(bare(id, "כמה זה 7 + 5?", [7, 5], ["+"]), id).ok, false, id);
  }
});
t("Hebrew topics and unknown ids are reported as NOT CHECKED, never as verified", () => {
  const h = topicFit(ex("hebrew-a-letters", { subject: "hebrew", question: "איזו אות באה אחרי א'?" }), "hebrew-a-letters");
  assert.deepEqual([h.ok, h.checked], [true, false]);
  assert.deepEqual([topicFit(ex("zzz", { question: "כמה זה 1 + 1?" }), "zzz").checked], [false]);
  assert.deepEqual([topicFit(ex("zzz", { question: "כמה זה 1 + 1?" }), undefined).checked], [false]);
});
t("multiplication-division: a bare multiplication/division is on-topic, a bare sum is not", () => {
  assert.equal(topicFit(bare("math-g-multiplication-division", "כמה זה 60 ÷ 10?", [60, 10], ["/"]), "math-g-multiplication-division").ok, true);
  assert.equal(topicFit(bare("math-g-multiplication-division", "כמה זה 6 × 7?", [6, 7], ["*"]), "math-g-multiplication-division").ok, true);
  assert.equal(topicFit(bare("math-g-multiplication-division", "כמה זה 5 + 3?", [5, 3], ["+"]), "math-g-multiplication-division").ok, false); // CONSTRUCTED
});
t("multiplication-division: the stored operators alone are enough when the wording has no symbol or keyword", () => {
  // No ×, ÷, כפל, חילוק... in the text: only computation.operators says it is a multiplication.
  assert.equal(topicFit(bare("math-g-multiplication-division", "כמה זה 6 כפול 7?", [6, 7], ["*"]), "math-g-multiplication-division").ok, true); // CONSTRUCTED
  assert.equal(topicFit(bare("math-g-multiplication-division", "כמה זה 60 חלקי 10?", [60, 10], ["/"]), "math-g-multiplication-division").ok, true); // CONSTRUCTED
  assert.equal(topicFit(bare("math-g-multiplication-division", "כמה זה 6 ועוד 7?", [6, 7], ["+"]), "math-g-multiplication-division").ok, false); // CONSTRUCTED
});

console.log("\nthe predicate: word boundaries (each of these once let a leak through or would reject a good row)");
t("'אותם' (them) is not the gematria word 'אות' (letter)", () => {
  const e = ex("math-g-gematria", { question: "יש 12 כדורים. חלקו אותם בין 4 ילדים. כמה כדורים לכל ילד?" }); // CONSTRUCTED
  assert.equal(topicFit(e, "math-g-gematria").ok, false);
  assert.equal(topicFit(ex("math-g-gematria", { question: "מהו ערך האות ג'?" }), "math-g-gematria").ok, true);
});
t("'קודם' (before) is not 'קו' (line); 'קווים' is", () => {
  assert.equal(topicFit(ex("math-a-length", { question: "מי הגיע קודם? כמה זה 3 + 4?" }), "math-a-length").ok, false); // CONSTRUCTED
  assert.equal(topicFit(ex("math-a-length", { question: "כמה קווים יש בציור? כמה זה 3 + 4?" }), "math-a-length").ok, true);
});
t("one-letter prefixes are tolerated: 'המשולשים', 'בצלעות', 'לשעון'", () => {
  assert.equal(topicFit(ex("math-a-geometry", { question: "כמה זה 3 + 4? בין המשולשים" }), "math-a-geometry").ok, true);
  assert.equal(topicFit(ex("math-b-geometry", { question: "ספרו בצלעות. כמה זה 3 + 4?" }), "math-b-geometry").ok, true);
  assert.equal(topicFit(ex("math-a-time", { question: "מה מראה השעון? כמה זה 3 + 4?" }), "math-a-time").ok, true);
});
t("an unrelated word that only LOOKS similar does not count ('סופרמרקט' is not 'סופרים'/'סופרת')", () => {
  assert.equal(topicFit(ex("math-a-data", { question: "בסופרמרקט יש 5 תפוחים. כמה זה 5 + 3?" }), "math-a-data").ok, false); // CONSTRUCTED
});
t("an anchor must START a word: it does not count when buried inside another (left boundary)", () => {
  // 'משך' (duration) sits inside 'הנחמשך' (nonsense) — a mid-word hit is not a topic word.
  assert.equal(topicFit(ex("math-a-time", { question: "הנחמשך זה 3 + 4?" }), "math-a-time").ok, false); // CONSTRUCTED
  assert.equal(topicFit(ex("math-a-time", { question: "משך הסרט. כמה זה 3 + 4?" }), "math-a-time").ok, true);
});
t("'מדד' is exempt from the whole-word rule: verb forms like 'מדדנו' still count", () => {
  assert.equal(topicFit(ex("math-a-length", { question: "מדדנו את הדלת. כמה זה 3 + 4?" }), "math-a-length").ok, true); // CONSTRUCTED
});
t("a short anchor takes a plural ending: 'מטרים' counts as 'מטר'", () => {
  assert.equal(topicFit(ex("math-b-length", { question: "כמה מטרים? כמה זה 3 + 4?" }), "math-b-length").ok, true);
});
t("a short anchor may carry a plural ('קווים'-style) but not any suffix: 'אותיות' ok, 'אותה' (her) not", () => {
  assert.equal(topicFit(ex("math-g-gematria", { question: "ראיתי אותה. כמה זה 3 + 4?" }), "math-g-gematria").ok, false); // CONSTRUCTED
  assert.equal(topicFit(ex("math-g-gematria", { question: "כמה אותיות. כמה זה 3 + 4?" }), "math-g-gematria").ok, true);
});
t("gershayim variants of ס\"מ are folded together", () => {
  // Nothing else in these sentences is a length word, so only the folded quote can make them pass.
  assert.equal(topicFit(ex("math-a-length", { question: "חתיכה של 5 ס״מ. כמה זה 5 + 3?" }), "math-a-length").ok, true);
  assert.equal(topicFit(ex("math-a-length", { question: 'חתיכה של 5 ס"מ. כמה זה 5 + 3?' }), "math-a-length").ok, true);
});
t("a clock time like 3:00 is time content even with no time word", () => {
  assert.equal(topicFit(ex("math-a-time", { question: "כמה זה 3:00 ועוד 2:00?" }), "math-a-time").ok, true);
});
t("choices and tiles count as exercise text (topic words often live only there)", () => {
  const e = ex("math-a-geometry", { type: "multiple_choice", question: "כמה זה 3 + 4?", choices: ["משולש", "7", "ריבוע", "8"] });
  assert.equal(topicFit(e, "math-a-geometry").ok, true);
});
t("tile words and grouped items count too", () => {
  const withTiles = ex("math-a-geometry", { type: "tile_order", question: "סדרו לפי הסדר", tiles: { items: ["משולש", "ריבוע"], slotCount: 2, joinWith: " " } });
  assert.equal(topicFit(withTiles, "math-a-geometry").ok, true);
  const withGroup = ex("math-a-geometry", { type: "grouping", question: "חלקו ל-3 קבוצות שוות", grouping: { items: stars(6, "🔺"), groupCount: 3 } });
  assert.equal(topicFit(withGroup, "math-a-geometry").ok, true);
  const plainTiles = ex("math-a-geometry", { type: "tile_order", question: "סדרו לפי הסדר", tiles: { items: ["3", "4"], slotCount: 2, joinWith: " " } });
  assert.equal(topicFit(plainTiles, "math-a-geometry").ok, false);
});
t("the topic asked for, not the row's own tag, decides fit", () => {
  const e = bare("math-a-time", "כמה זה 7 + 5?", [7, 5], ["+"]);
  assert.equal(topicFit(e, "math-a-time").ok, false);
  assert.equal(topicFit(e, "math-b-arithmetic").ok, true); // same row, an arithmetic topic
});

// ---------- serving ----------
console.log("\nserving: a leaky row in the table is never handed to a kid");
function row(e: Exercise) {
  return {
    id: e.id, subject: e.subject, grade: e.grade, type: e.type, subtype: e.subtype ?? null, topic: "t", topic_id: e.topicId ?? null,
    passage: null, question: e.question, choices: e.choices ?? null, number_line: null, tiles: e.tiles ?? null,
    grouping: e.grouping ?? null, correct_answer: e.correctAnswer, computation: e.computation ?? null, difficulty: 2,
  };
}
const client = (rows: ReturnType<typeof row>[]) => ({ rpc: async () => ({ data: rows, error: null }) }) as never;
const leak = LEAKS.find(([n]) => n.startsWith("math-g-gematria: 'כמה זה 5 + 3?'"))![1];
const good = GOOD.find(([n]) => n.startsWith("math-g-gematria: letter values"))![1];

await at("with one leak and one good row, only the good row is ever served", async () => {
  for (let i = 0; i < 300; i++) {
    const got = await findReusableExercise(client([row(leak), row(good)]), "math", "ג", "kid", "math-g-gematria", 2);
    assert.equal(got?.id, good.id, `served ${got?.id}`);
  }
});
await at("when EVERY candidate is a leak there is nothing reusable — null, so the caller generates a fresh one", async () => {
  const got = await findReusableExercise(client([row(leak)]), "math", "ג", "kid", "math-g-gematria", 2);
  assert.equal(got, null);
});
await at("the same rows in an arithmetic topic are served normally (no over-reach)", async () => {
  const b = bare("math-g-arithmetic", "כמה זה 5 + 3?", [5, 3], ["+"]);
  const got = await findReusableExercise(client([row(b)]), "math", "ג", "kid", "math-g-arithmetic", 2);
  assert.equal(got?.id, b.id);
});
await at("a LEGACY untagged row (topic_id null) is judged against the topic the kid is in", async () => {
  const legacy = { ...row(leak), topic_id: null };
  for (let i = 0; i < 100; i++) {
    const got = await findReusableExercise(client([legacy, row(good)]), "math", "ג", "kid", "math-g-gematria", 2);
    assert.equal(got?.id, good.id, "an untagged off-topic row was served");
  }
});
await at("an unscoped request checks each row against its OWN tag", async () => {
  for (let i = 0; i < 100; i++) {
    const got = await findReusableExercise(client([row(leak), row(good)]), "math", "ג", "kid", undefined, 2);
    assert.equal(got?.id, good.id);
  }
});

console.log("\nserving: the last-resort escape hatch");
await at("ignoreTopicFit serves a row the check would drop — the route's fallback so a kid is never left with nothing", async () => {
  const got = await findReusableExercise(client([row(leak)]), "math", "ג", "kid", "math-g-gematria", 2, undefined, { ignoreTopicFit: true });
  assert.equal(got?.id, leak.id);
});
await at("the escape hatch still honours excludeIds — it relaxes the topic check, nothing else", async () => {
  const got = await findReusableExercise(client([row(leak)]), "math", "ג", "kid", "math-g-gematria", 2, [leak.id], { ignoreTopicFit: true });
  assert.equal(got, null);
});
await at("it is OFF by default: the same call without the flag drops the row", async () => {
  assert.equal(await findReusableExercise(client([row(leak)]), "math", "ג", "kid", "math-g-gematria", 2), null);
});

// ---------- admission ----------
console.log("\nadmission: generateExercise refuses an off-topic draft and asks again");
type Call = { messages: { content: string }[] };
function fakeModel(replies: object[]) {
  const calls: Call[] = [];
  const messages = getAnthropicClient().messages as unknown as { create: (req: Call) => Promise<unknown> };
  messages.create = async (req: Call) => {
    calls.push(req);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { content: [{ type: "text", text: JSON.stringify(reply) }] };
  };
  return calls;
}
const leakyDraft = { type: "open", topic: "גימטריה", question: "כמה זה 5 + 3?", computation: { operands: [5, 3], operators: ["+"] }, correctAnswer: "8" };
const goodDraft = { type: "open", topic: "גימטריה", question: "ערך האות א' הוא 1 וערך האות ב' הוא 2. כמה זה 1 + 2?", computation: { operands: [1, 2], operators: ["+"] }, correctAnswer: "3" };
const gen = (topicId: string) =>
  generateExercise({ subject: "math", grade: "ג", profile: null, topicId, level: 2, forceSubtype: "fill_in_blank" });
const quiet = console.warn;
console.warn = () => {};

await at("an off-topic draft is not returned: it is re-requested, and the retry says WHY", async () => {
  const calls = fakeModel([leakyDraft, goodDraft]);
  const out = await gen("math-g-gematria");
  assert.equal(out.question, goodDraft.question);
  assert.equal(calls.length, 2, "exactly one retry");
  assert.ok(!calls[0].messages[0].content.includes("הקודם נדחה"), "the first ask carries no correction");
  assert.ok(calls[1].messages[0].content.includes("הקודם נדחה"), "the retry must tell the model what was wrong");
});
await at("if every attempt is off-topic it THROWS: nothing leaky is ever returned (or saved)", async () => {
  const calls = fakeModel([leakyDraft]);
  await assert.rejects(gen("math-g-gematria"), (err: unknown) => err instanceof TopicFitError);
  assert.equal(calls.length, 3, "bounded by the existing MAX_GENERATION_ATTEMPTS");
});
await at("the returned exercise is stamped with the topic AND actually fits it", async () => {
  fakeModel([goodDraft]);
  const out = await gen("math-g-gematria");
  assert.equal(out.topicId, "math-g-gematria");
  assert.equal(topicFit(out, out.topicId).ok, true);
});
await at("an arithmetic topic still accepts the same bare sum on the first try (the gate does not over-reach)", async () => {
  const calls = fakeModel([leakyDraft]);
  const out = await gen("math-g-arithmetic");
  assert.equal(out.question, "כמה זה 5 + 3?");
  assert.equal(calls.length, 1);
});
console.warn = quiet;

console.log("\nniqqud is the same words (2026-09-25: 24 good drafts rejected for their niqqud)");
t("a pointed volume question fits math-b-volume ('תֵּיבָה' is the anchor 'תיבה')", () => {
  const e = { id: "n1", subject: "math", grade: "ב", type: "open", topic: "t", question: "דָּנִי בָּנָה תֵּיבָה מִ-12 קֻבִּיּוֹת. כַּמָּה קֻבִּיּוֹת בְּכָל שִׁכְבָה?", correctAnswer: "4" } as Exercise;
  assert.equal(topicFit(e, "math-b-volume").ok, true);
});
t("stripping niqqud keeps the maqaf: a hyphenated word is not fused into its neighbour", () => {
  const e = { id: "n2", subject: "math", grade: "ג", type: "open", topic: "t", question: "משולש שׁווה־צלעות: כמה צלעות שוות יש לו?", correctAnswer: "3" } as Exercise;
  assert.equal(topicFit(e, "math-g-geometry").ok, true);
});

console.log("\nthe route: a TopicFitError must not become a 500 while the bank still has something");
{
  const route = readFileSync(new URL("../app/api/tutor/route.ts", import.meta.url), "utf8");
  t("generate is wrapped, and only a TopicFitError is caught (every other failure still surfaces)", () => {
    assert.match(route, /generated = await generateExercise\(/);
    assert.match(route, /if \(!\(genErr instanceof TopicFitError\)\) throw genErr;/);
  });
  t("the fallback re-queries the bank with the fit check off, and rethrows when the bank is empty too", () => {
    assert.match(route, /ignoreTopicFit: true/);
    assert.match(route, /if \(!fallback\) throw genErr;/);
  });
  t("the fallback exercise is served, not saved (nothing off-topic is ever written to the bank)", () => {
    const block = route.slice(route.indexOf("} catch (genErr) {"), route.indexOf("const generateMs"));
    assert.ok(!/saveExercise/.test(block), "the unchecked fallback row must never be written back");
    assert.match(block, /source: "bank-hit-unfiltered"/);
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
