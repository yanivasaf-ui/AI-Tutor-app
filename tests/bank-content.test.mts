/**
 * The bank content-quality pass (QA 2026-09-26, classes a–f): the gate
 * rules that now catch the detectable classes, the reviewed fix script for
 * the rows still served, and the defective rows already out of serving.
 *
 * Run: npx tsx tests/bank-content.test.mts
 */
import assert from "node:assert/strict";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { checkQuestionQuality } from "../lib/authoring/quality-gate";
import { formatFit } from "../lib/exercises/format-fit";
import { operationScope } from "../lib/exercises/operation-scope";
import { topicFit } from "../lib/exercises/topic-fit";
import { getTopicById } from "../lib/map/topics";
import { CONTENT_FIXES, fixesSql } from "../scripts/bank-content-fixes";
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
const ex = (p: Partial<Exercise> & { question: string }): Exercise =>
  ({ id: "x", subject: "math", grade: "ג", type: "open", topic: "t", correctAnswer: "1", ...p }) as Exercise;
const rules = (e: Exercise) => checkQuestionQuality(e).violations.map((v) => v.rule);
const details = (e: Exercise) => checkQuestionQuality(e).violations.map((v) => v.detail).join(" | ");

console.log("(b) impossible content — a square's area is a whole number squared");
t("REAL 1405203b: 'ריבועים בגדלים 4, 9, 14, 19 סמ\"ר' → rejected (14, 19 and the answer 24 are not squares)", () => {
  const e = ex({ subtype: "pattern_completion", question: 'רותם מודדת שטחים של ריבועים שונים ברשת. היא מצאה ריבועים בגדלים הבאים: 4 סמ"ר, 9 סמ"ר, 14 סמ"ר, 19 סמ"ר. איזה שטח יהיה הריבוע הבא ברצף?', correctAnswer: "24" });
  assert.ok(rules(e).includes("internal-consistency"));
  assert.match(details(e), /14, 19, 24/);
});
t("squares with square areas pass; a rectangle of unit squares is not a square", () => {
  assert.ok(!rules(ex({ question: 'ריבועים בגדלים 4 סמ"ר, 9 סמ"ר, 16 סמ"ר. מה השטח של הריבוע הבא?', correctAnswer: "25" })).includes("internal-consistency"));
  assert.deepEqual(rules(ex({ question: 'מלבן מורכב מריבועים. שטחו 12 סמ"ר. כמה ריבועים יש בו?', correctAnswer: "12" })), []);
});

console.log("\n(c) two valid answers — the same computation offered twice");
t("REAL 9a3529d5 (the toothpick triangle): '3 + 3' and '3 × 2' → rejected", () => {
  const e = ex({ grade: "ב", type: "multiple_choice", subtype: "pick_operation", question: "לנועה יש משולש עם 3 צלעות שוות. היא רוצה לבנות עוד משולש כזה. כמה קיסמים היא צריכה?", choices: ["3 + 3", "3 × 2", "3 - 2", "3 ÷ 3"], correctAnswer: "3 + 3" });
  assert.match(details(e), /"3 \+ 3" and "3 × 2" are the same computation/);
});
const REAL_5E33 = ex({ grade: "א", type: "multiple_choice", subtype: "pick_operation", topicId: "math-a-data", question: "בכיתה יש 3 ילדים שנולדו בחורף, ו-5 ילדים שנולדו באביב. כמה ילדים בסך הכול נולדו בשני העונות האלה?", choices: ["3 + 5", "5 - 3", "5 + 3", "3 - 5"], correctAnswer: "3 + 5" });
t("REAL 5e3330c2: '3 + 5' and '5 + 3' → rejected", () => {
  assert.match(details(REAL_5E33), /"3 \+ 5" and "5 \+ 3" are the same computation/);
});
t("different computations with the same value are NOT two answers (8 − 5 vs 6 − 3; 2 + 2 vs 3 + 1)", () => {
  const mc = (choices: string[], correctAnswer: string) => ex({ type: "multiple_choice", subtype: "pick_operation", question: "באיזו פעולה נשתמש?", choices, correctAnswer });
  assert.deepEqual(rules(mc(["8 - 5", "6 - 3", "8 + 5", "5 - 8"], "8 - 5")), []);
  assert.deepEqual(rules(mc(["2 + 2", "3 + 1", "2 × 3", "2 - 2"], "2 + 2")), []);
  assert.deepEqual(rules(mc(["5 - 3", "3 - 5", "5 + 3", "3 × 5"], "5 - 3")), [], "order matters for − and ÷");
  assert.deepEqual(rules(mc(["חיבור", "חיסור", "כפל", "חילוק"], "חיבור")), [], "word choices are not parsed");
});
t("repeated addition and multiplication of the same numbers are the same computation (2 + 2 + 2 and 3 × 2)", () => {
  const e = ex({ type: "multiple_choice", subtype: "pick_operation", question: "כמה?", choices: ["2 + 2 + 2", "3 × 2", "3 + 2", "6 - 2"], correctAnswer: "3 × 2" });
  assert.ok(rules(e).includes("unambiguous-answer"));
});

console.log("\n(e) copy — a repeated word in a list, a hint against the answer");
t("REAL 78c0e1d1 (Hebrew): \"'לצייר', 'ציורים', 'ציור', 'ציור'\" → rejected", () => {
  const e = ex({ subject: "hebrew", type: "multiple_choice", subtype: "comprehension", question: "מה השורש המשותף למילים: 'לצייר', 'ציורים', 'ציור', 'ציור'?", choices: ["צ.י.ר", "צ.ב.ע", "י.פ.ה", "פ.ר.ח"], correctAnswer: "צ.י.ר" });
  const r = checkQuestionQuality(e);
  assert.equal(r.ok, false);
  assert.match(details(e), /repeats "ציור"/);
});
t("REAL 87d2183c, the same list without the repeat ('ציור' ו'ציירת') passes; a target word referred back to is not a list", () => {
  assert.ok(checkQuestionQuality(ex({ subject: "hebrew", question: "מה השורש המשותף של המילים 'לצייר', 'ציורים', 'ציור' ו'ציירת'?" })).ok);
  assert.ok(checkQuestionQuality(ex({ subject: "hebrew", question: "מילת היעד: 'שולחן'. איזו מילה מסתיימת באותו צליל כמו 'שולחן'?" })).ok);
});
t("REAL a2b1e746: hint 'חפשו אות שצריכה להיות אחרת' while the answer is 'כל המילים נכתבו נכון' → rejected", () => {
  const e = ex({ subject: "hebrew", grade: "ב", type: "multiple_choice", subtype: "comprehension", question: "באיזו מילה בקטע יש טעות כתיב? (רמז: חפשו אות שצריכה להיות אחרת)", choices: ["ציפור - צריך להיות 'צפור'", "שמח - צריך להיות 'סמח'", "קטנה - צריך להיות 'קטנא'", "כל המילים נכתבו נכון"], correctAnswer: "כל המילים נכתבו נכון" });
  assert.match(details(e), /hint says there is an error/);
});
t("the same 'all correct' answer without a misleading hint passes; a hint with a real error to find passes", () => {
  assert.ok(checkQuestionQuality(ex({ subject: "hebrew", type: "multiple_choice", question: "באיזו מילה יש טעות כתיב?", choices: ["ספר", "בית", "גן", "כל המילים נכתבו נכון"], correctAnswer: "כל המילים נכתבו נכון" })).ok);
  assert.ok(checkQuestionQuality(ex({ subject: "hebrew", type: "multiple_choice", question: "באיזו מילה יש טעות? (רמז: חפשו אות שצריכה להיות אחרת)", choices: ["ספר", "בייט", "גן", "כל המילים נכתבו נכון"], correctAnswer: "בייט" })).ok);
});

console.log("\nthe fix script (reviewed, not run) — rows still served on this branch");
const full = (id: string): Exercise => {
  const base: Record<string, Partial<Exercise>> = {
    "719065d0": { grade: "ב", type: "tile_order", subtype: "equation_balance", topicId: "math-b-data", correctAnswer: "5", tiles: { items: ["5", "4", "6", "11"], slotCount: 1, joinWith: " " } },
    d69ffd9f: { grade: "ג", type: "tile_order", subtype: "equation_balance", topicId: "math-g-multiplication-division", correctAnswer: "7", tiles: { items: ["7", "5", "8", "6"], slotCount: 1, joinWith: " " } },
    "489e88bf": { grade: "ג", type: "tile_order", subtype: "equation_balance", topicId: "math-g-multiplication-division", correctAnswer: "4", tiles: { items: ["4", "5", "3", "6"], slotCount: 1, joinWith: " " } },
  };
  return { id, subject: "math", topic: "t", ...base[id.slice(0, 8)] } as Exercise;
};
t("three rows, each with a class and a reason", () => {
  assert.deepEqual(CONTENT_FIXES.map((f) => f.id.slice(0, 8)).sort(), ["489e88bf", "719065d0", "d69ffd9f"]);
  for (const f of CONTENT_FIXES) assert.ok(f.what.length > 10, f.id);
});
t("each is served on this branch BEFORE the fix — the script only touches rows that reach a child", () => {
  for (const f of CONTENT_FIXES) {
    const e = { ...full(f.id), question: f.before.question, choices: f.before.choices };
    assert.ok(formatFit(e, e.topicId).ok && operationScope(e, e.topicId).ok && topicFit(e, e.topicId).ok && checkQuestionQuality(e).ok, f.id);
  }
});
t("every 'after' passes everything serving checks: format table, operation scope, topic fit, the quality gate", () => {
  for (const f of CONTENT_FIXES) {
    const e = { ...full(f.id), question: f.after.question, choices: f.after.choices };
    assert.ok(getTopicById(e.topicId!), f.id);
    assert.ok(formatFit(e, e.topicId).ok, `${f.id}: format`);
    assert.ok(operationScope(e, e.topicId).ok, `${f.id}: operations`);
    assert.ok(topicFit(e, e.topicId).ok, `${f.id}: topic`);
    assert.deepEqual(checkQuestionQuality(e).violations, [], `${f.id}: gate`);
  }
});
t("each fix changes only what it says it changes", () => {
  const changed = (a: string, b: string) => {
    const wa = a.split(/\s+/), wb = b.split(/\s+/);
    return wa.map((w, i) => (w !== wb[i] ? `${w}→${wb[i]}` : null)).filter(Boolean);
  };
  const byId = Object.fromEntries(CONTENT_FIXES.map((f) => [f.id.slice(0, 8), f]));
  assert.deepEqual(changed(byId["719065d0"].before.question, byId["719065d0"].after.question), ["עניבים:→ענבים:"]);
  assert.deepEqual(changed(byId["d69ffd9f"].before.question, byId["d69ffd9f"].after.question), ["היא→הוא"]);
  assert.deepEqual(changed(byId["489e88bf"].before.question, byId["489e88bf"].after.question), ["היא→הוא"]);
});
t("the SQL is one transaction of guarded UPDATEs (id AND the audited text) — no DELETE, nothing else", () => {
  const sql = fixesSql();
  assert.match(sql, /^-- [\s\S]*\nbegin;\n[\s\S]*\ncommit;$/);
  const statements = sql.split("\n").filter((l) => !l.startsWith("--") && l.trim() && l !== "begin;" && l !== "commit;");
  assert.equal(statements.length, 3);
  for (const s of statements) {
    assert.match(s, /^update exercises set question = E'.*' where id = E'[0-9a-f-]{36}' and question = E'.*';$/);
  }
  assert.ok(!/\b(delete|drop|truncate|insert)\b/i.test(sql));
});

console.log("\nthe defective rows already out of serving (removed by the format cleanup, query C)");
const OUT_OF_SERVING: [id: string, topicId: string, subtype: Exercise["subtype"], cls: string][] = [
  ["cb7afb8d", "math-g-geometry", "number_line_placement", "a (זוויות ג: 'למשולש יש 3 זוויות. היכן נמצא המספר 3')"],
  ["1263f8cf", "math-g-geometry", "number_line_placement", "a (זוויות ג: '3 זוויות היו חדות … כמה זוויות חדות')"],
  ["d47d1a63", "math-g-volume", "pick_operation", "a (גופים ג: 'לשש מלבנים … כמה מלבנים', graded 6 × 1)"],
  ["1405203b", "math-g-area", "pattern_completion", "b (square areas 14, 19)"],
  ["9a3529d5", "math-b-geometry", "pick_operation", "c (toothpicks 3 + 3 / 3 × 2)"],
  ["0eaad9a4", "hebrew-b-metalinguistic", "comprehension", "c (ילדים / משחקים both plural)"],
  ["66a11e66", "hebrew-b-metalinguistic", "comprehension", "c (asks for a noun; all options are adjectives)"],
  ["740bf828", "math-g-volume", "pattern_completion", "d (מיכל … לו)"],
  ["7ce2de2e", "math-g-volume", "equation_balance", "d (מיכל … צייר / הוא)"],
  ["dd676976", "math-g-volume", "pattern_completion", "d (מיכל … לו)"],
  ["44977a5e", "math-g-volume", "pattern_completion", "d (מיכל … לו)"],
  ["78c0e1d1", "hebrew-g-metalinguistic", "comprehension", "e (ציור twice)"],
  ["a2b1e746", "hebrew-b-standard-orthography", "comprehension", "e (hint vs 'all correct')"],
  ["8e543fef", "math-g-gematria", "visual_grouping", "f (division as letter counting)"],
  ["804ae2af", "math-g-data", "visual_grouping", "f (pictogram: 'divide the apples to organize the data')"],
];
t("REAL 5e3330c2 (c, '3 + 5' / '5 + 3') is out of serving too: topic-fit refuses it, and now the gate", () => {
  assert.equal(topicFit(REAL_5E33, "math-a-data").ok, false);
  assert.equal(checkQuestionQuality(REAL_5E33).ok, false);
});
t(`all ${OUT_OF_SERVING.length} are refused by the allowed-format table (never served on this branch)`, () => {
  for (const [id, topicId, subtype, cls] of OUT_OF_SERVING) {
    assert.equal(formatFit(ex({ topicId, subtype, question: "q" }), topicId).ok, false, `${id} ${cls}`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
