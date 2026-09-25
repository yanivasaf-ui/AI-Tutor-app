import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import type { Exercise } from "@/lib/exercises/types";
import { UNIVERSAL_RULES, type RuleId } from "./rubric";
import type { QualityResult, QualityViolation } from "./quality-gate";

/**
 * The judgment half of the authoring rubric: a model reads a draft against
 * the rules code cannot check (spoken age-appropriate Hebrew, a concrete
 * scenario, story/number consistency beyond what quality-gate.ts parses).
 *
 * OFF BY DEFAULT. Running it inline adds one model call to every freshly
 * generated question — latency the child waits through on a bank miss,
 * and cost on every draft. Whether that trade is worth it is a product
 * decision, so it is a switch, not a default:
 *
 *   QUESTION_REVIEW=inline  → generate.ts reviews every draft before it
 *                             can be saved or served (rejected drafts are
 *                             retried like any other gate failure).
 *   QUESTION_REVIEW unset / "off" → no review call anywhere at runtime.
 *
 * FAIL-OPEN. A review that errors or returns something unparseable passes
 * the draft (with a warning): the deterministic gate has already run, and
 * a flaky reviewer must not turn into "משהו השתבש" for a child.
 */

export type ReviewMode = "off" | "inline";

export function reviewMode(): ReviewMode {
  return process.env.QUESTION_REVIEW === "inline" ? "inline" : "off";
}

/** Rules the reviewer judges: only those enforcement says need judgment.
 *  Rules enforced by code alone (no-series-as-count, no-pattern-drift)
 *  already ran before a draft gets here; asking the model too made it
 *  flag clean questions for them (calibration, 2026-09-25). */
const REVIEWED_RULES = UNIVERSAL_RULES.filter((r) => r.enforcement.includes("review"));
const RULE_IDS = new Set<string>(REVIEWED_RULES.map((r) => r.id));

/**
 * How high the bar for "violation" is. Calibrated offline by
 * scripts/calibrate-review.mts against tests/fixtures/review-calibration.json
 * (known-bad questions it must catch, clean ones it must not reject).
 *  - strict: any doubt about any rule is a violation (the first version).
 *  - balanced: a violation only when it would actually trip a child up.
 *  - lenient: only outright defects.
 */
export type ReviewStrictness = "strict" | "balanced" | "lenient";

export const REVIEW_THRESHOLD: Readonly<Record<ReviewStrictness, string>> = {
  strict: "סמן/י הפרה בכל מקרה של ספק לגבי אחד הכללים.",
  balanced: `סמן/י הפרה רק אם היא תכשיל ילד/ה בכיתה הזו: התשובה הצפויה שגויה, לא נובעת מהשאלה או לא יחידה (כולל תשובה נכונה שמוסתרת בתוך ניסוח אפשרות, כמו "אף תשובה לא נכונה, התשובה היא…"); השאלה סותרת את עצמה (מספר שנאמר ומספר שנשאל, מה שנשאל ומה שנבדק); התרחיש בלתי אפשרי (חפץ במידות שלא ייתכנו, פעולה שאין לה פשר); או שיש יותר משאלה אחת.
אל תסמן/י: העדפות ניסוח וסגנון; מספרים בטווח הכיתה (א עד 100, ב עד 1,000, ג עד 10,000); תרגיל חשבון ישיר כשיש לו מסגרת קצרה; תרחיש פשוט שאינו מקורי במיוחד; ציר מספרים שהשאלה מגדירה בהקשר.`,
  lenient: "סמן/י הפרה רק אם התשובה הצפויה שגויה או לא יחידה, או שהשאלה סותרת את עצמה. כל השאר עובר.",
};

/**
 * What each exercise format looks like when it is built correctly. The
 * first calibration run rejected ~80% of clean questions because the
 * reviewer judged every question as a free-standing word problem: it read
 * the required written sum of a fill_in_blank as a second task, "איזו פעולה
 * תעזור" as a meta-question, "הסבירו" as a second task, and a grouping
 * question that draws its objects as one that never says the total.
 * Each entry describes the format's own shape, from what the generator is
 * instructed to build (lib/exercises/generate.ts SUBTYPE_GUIDANCE).
 */
export const FORMAT_SHAPE: Readonly<Partial<Record<NonNullable<Exercise["subtype"]>, string>>> = {
  fill_in_blank:
    "סיפור קצר של משפט אחד ואחריו התרגיל בספרות (\"כמה זה 8 + 5 + 7?\"). זו שאלה אחת: הסיפור נותן הקשר, והתרגיל הכתוב הוא המשימה. הוא חייב להופיע במפורש כדי שהמערכת תבדוק את התשובה. אל תסמן/י אותו כשתי משימות.",
  pick_operation:
    "\"איזו פעולה תעזור…?\" היא שאלה תקינה בפורמט הזה: התלמיד/ה בוחר/ת את הפעולה, לא מחשב/ת את התוצאה. האפשרויות הן פעולות או ביטויים, והתשובה הנכונה היא הביטוי שפותר את הבעיה. אל תדרוש/י שהשאלה תבקש חישוב.",
  explain_thinking:
    "שאלה פתוחה שמבקשת הסבר. ניסוח כמו \"הסבירו איך חישבתם\" הוא תקין ואינו משימה שנייה. התשובה הצפויה היא תיאור של הסבר טוב (רובריקה), לא ערך יחיד — אל תסמן/י אותה כלא חד-משמעית רק כי אין בה מספר.",
  number_line_placement:
    "התלמיד/ה ממקם/ת ערך על ציר מספרים שהאפליקציה מציירת (עם התחלה וקפיצות משלה). אין צורך שהשאלה תגדיר את הציר. התשובה הצפויה היא הערך שממקמים.",
  equation_balance:
    "סיפור קצר ומשוואה עם מקום ריק (___) שהתלמיד/ה משלים/ה באחת מכמה אבנים. המשוואה היא המשימה, והיא אמורה לשקף את הסיפור; אל תסמן/י אותה כשתי משימות אלא אם המשוואה סותרת את מה שנשאל.",
  pattern_completion:
    "רצף מספרים עם קפיצה קבועה והתלמיד/ה בוחר/ת את המספר הבא מבין אבנים. הרצף עצמו מוצג בשאלה.",
  shape_match:
    "רצף צורות (אמוג'י) ואבנים של צורות; התלמיד/ה בוחר/ת את הצורה שממשיכה את הדפוס.",
  visual_grouping:
    "העצמים מצוירים על המסך (מספרם מופיע בשדה grouping) והתלמיד/ה גורר/ת אותם לקבוצות. לכן השאלה לא חייבת לציין את הסך הכל — הוא נקבע לפי מספר העצמים המצוירים. התשובה הנכונה היא מספר העצמים חלקי מספר הקבוצות. בדוק/י שהמספרים שהשאלה כן מציינת מתאימים למה שמצויר.",
};

/**
 * True at every strictness level. Calibration (2026-09-25) showed the
 * reviewer treating the curriculum's own subject matter as a defect.
 */
export const CURRICULUM_ALLOWANCES = `הבהרות שנכונות תמיד:
- מונחים מתוכנית הלימודים הם תקינים גם אם הם לא "שפת ילדים": דיאגרמת עמודות, גימטרייה, שטח, סמ"ר, תיבה, זווית חדה, ציר מספרים. אל תסמן/י אותם כלא-מדוברים או כלא-מוחשיים. נושא הגימטרייה בכיתה ג הוא נושא לימוד.
- איות שמשרד החינוך משתמש בו (כתה, בכתה) אינו שגיאה.
- נתונים שמובאים בטקסט (ערכי עמודות, מספרי ילדים) הם הדרך להציג דיאגרמה בשאלה כתובה; אין צורך שהדיאגרמה תצויר.
- בפורמטים של משוואה ושל ציר מספרים, השאלה מספרת הקשר והפורמט מוסיף את המשוואה/הציר — זו אותה משימה, לא שנייה. גם "כמה יש בסך הכל? מקמו על הציר" וגם משוואה שחוזרת על התשובה של הסיפור הם תקינים.
- טווחי מספרים: כיתה א עד 100, כיתה ב עד 1,000, כיתה ג עד 10,000. מספר בטווח אינו "גדול מדי".
- אל תסמן/י שאלת עיגול פינות: אי-בהירות דקדוקית (זכר/נקבה, יחיד/רבים), או האם מי שמחלק נכלל בין המקבלים, אלא אם היא משנה את התשובה.
- רצף צורות תקין אם יש לו מחזור עקבי אחד שקובע את הצורה הבאה. כלל "הפרש קבוע" חל על מספרים בלבד.`;

export function reviewPrompt(ex: Exercise, context?: string, strictness: ReviewStrictness = DEFAULT_STRICTNESS): string {
  const rules = REVIEWED_RULES.map((r) => `- [${r.id}] ${r.he}`).join("\n");
  const shown = {
    question: ex.question,
    passage: ex.passage,
    choices: ex.choices,
    // What is DRAWN, as counts: the question need not restate it.
    grouping: ex.grouping
      ? { objectsDrawn: ex.grouping.items.length, objectEmoji: ex.grouping.items[0], groups: ex.grouping.groupCount, perGroup: ex.grouping.items.length / ex.grouping.groupCount }
      : undefined,
    tiles: ex.tiles?.items,
    correctAnswer: ex.correctAnswer,
  };
  const format = ex.subtype ? FORMAT_SHAPE[ex.subtype] : undefined;
  return `את/ה בודק/ת שאלה במתמטיקה לילד/ה בכיתה ${ex.grade} לפני שהיא מוצגת. בדוק/י אותה מול הכללים:
${rules}
${format ? `\nהפורמט של השאלה הזו (${ex.subtype}) — כך נראית שאלה תקינה בו:\n${format}\n` : ""}
${CURRICULUM_ALLOWANCES}

רף ההחלטה: ${REVIEW_THRESHOLD[strictness]}
${context ? `\nכך נשמעות שאלות בנושא הזה בספרי משרד החינוך (לעיון, לא להעתקה):\n${context}\n` : ""}
השאלה (JSON):
${JSON.stringify(shown, null, 1)}

החזר/י אך ורק JSON: {"pass": true} אם השאלה עומדת בכל הכללים, אחרת {"pass": false, "violations": [{"rule": "<מזהה הכלל>", "detail": "<מה לא תקין, במשפט קצר אחד>"}]}`;
}

/** The level generate.ts uses when review is switched on. */
export const DEFAULT_STRICTNESS: ReviewStrictness = "strict";

export async function reviewQuestion(
  ex: Exercise,
  context?: string,
  opts: { strictness?: ReviewStrictness } = {}
): Promise<QualityResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: TUTOR_MODEL,
      // Room for several violations with a Hebrew sentence each: at 300 the
      // JSON was cut mid-string and the review failed open (5 of 63).
      max_tokens: 900,
      // A verdict, not prose: the same question should get the same answer
      // (untuned it flipped 9/12 → 7/12 rejections between two runs).
      temperature: 0,
      system: "את/ה מחזיר/ה אך ורק JSON תקין, ללא טקסט נוסף, ללא markdown code fences.",
      messages: [{ role: "user", content: reviewPrompt(ex, context, opts.strictness ?? DEFAULT_STRICTNESS) }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no text content");
    const parsed = JSON.parse(block.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim());
    if (parsed.pass === true) return { ok: true, checked: true, violations: [] };
    const violations: QualityViolation[] = (Array.isArray(parsed.violations) ? parsed.violations : [])
      .filter((v: { rule?: unknown }) => typeof v?.rule === "string" && RULE_IDS.has(v.rule))
      .map((v: { rule: string; detail?: unknown }) => ({ rule: v.rule as RuleId, detail: String(v.detail ?? "") }));
    // "pass: false" naming no rule we know is not a verdict we can act on.
    if (violations.length === 0) return { ok: true, checked: true, violations: [] };
    return { ok: false, checked: true, violations };
  } catch (err) {
    console.warn(`[question-review] review failed, passing the draft: ${err instanceof Error ? err.message : err}`);
    return { ok: true, checked: false, violations: [] };
  }
}
