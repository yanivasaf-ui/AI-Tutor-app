import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { embedText } from "@/lib/rag/embed";
import { search } from "@/lib/rag/store";
import { SubjectProfile } from "@/lib/memory/types";
import { Exercise, ExerciseSubtype, ExerciseType, NumberLineData, TileOrderData, Grade } from "./types";

/**
 * Tier 1 + Tier 2 subtypes from output/exercise-types-build-brief.md, each
 * mapped to a specific pedagogical pattern rather than leaving "open vs
 * multiple_choice vs number_line vs tile_order" as the model's own free
 * choice. Tier 2 (number_line_placement, pattern_completion, word_build,
 * sentence_order) additionally requires the model to return a numberLine or
 * tiles payload alongside the question — see the parsing logic below.
 */
const SUBTYPE_GUIDANCE: Record<ExerciseSubtype, string> = {
  fill_in_blank:
    'תרגיל חישוב בסיסי (חיבור/חיסור/כפל/חילוק, לפי המתאים לכיתה). type חייב להיות "open", והתשובה היא מספר.',
  pick_operation:
    'בעיית מילה קצרה. השאלה מבקשת מהתלמיד/ה לבחור איזו פעולה חשבונית פותרת אותה — לא לחשב את התוצאה עצמה. type חייב להיות "multiple_choice", 4 אפשרויות מתוך פעולות חשבון (חיבור/חיסור/כפל/חילוק, הרלוונטיות בלבד).',
  explain_thinking:
    'שאלה פתוחה שמבקשת מהתלמיד/ה להסביר את דרך החשיבה/האסטרטגיה לפתרון, לא רק תוצאה מספרית. type חייב להיות "open". אין תשובה נכונה יחידה — correctAnswer צריך לתאר בקצרה מה מאפיין הסבר טוב (למשל "הסבר שמזכיר פירוק למאות/עשרות/יחידות"), לא תשובה מדויקת.',
  comprehension:
    'כתוב/י קטע קריאה קצר (2-4 משפטים, מתאים לגיל) בשדה passage, ואז שאלת הבנה סגורה עליו בשדה question. type יכול להיות "open" (תשובה קצרה) או "multiple_choice".',
  spelling_correction_mc:
    'משפט קצר עם 4 אפשרויות כתיב למילה אחת בתוכו — רק אחת נכונה. type חייב להיות "multiple_choice".',
  root_pattern_mc:
    'תן/י שורש (למשל כ-ת-ב) ובקש/י לבחור איזו מילה מבין 4 אפשרויות נגזרת מהשורש הזה. type חייב להיות "multiple_choice".',
  number_line_placement:
    'תרגיל מיקום על ציר מספרים. type חייב להיות "number_line". קבע/י min, max, step כך שמספר הסימונים על הציר — ((max-min)/step)+1 — לא יעלה על 9, ומתאים לרמת הכיתה. החזר/י שדה נוסף numberLine: {"min": מספר, "max": מספר, "step": מספר}. נסח/י את question כשאלה שמבקשת למקם ערך מסוים על הציר (למשל "היכן נמצא המספר 42 על הציר?"), ו-correctAnswer הוא הערך הנכון (כמחרוזת).',
  pattern_completion:
    'רצף מספרים עם דפוס ברור (למשל דילוגים קבועים), עם ערך אחד חסר בסוף הרצף. type חייב להיות "tile_order". החזר/י שדה נוסף tiles: {"items": [4 מספרים מעורבבים, קרובים לתשובה הנכונה, אחד מהם נכון]}. correctAnswer הוא הערך הנכון להשלמת הרצף.',
  word_build:
    'תן/י מילה עברית קצרה ומתאימה לגיל (מהתוכן הלימודי או קרובה אליו). type חייב להיות "tile_order". החזר/י שדה נוסף tiles: {"items": [אותיות המילה בסדר מעורבב]} — קריטי: items חייב להכיל בדיוק את האותיות של המילה, אותה אחת אחת, בלי אף אות נוספת ובלי אף אות חסרה (רק הסדר מעורבב, לא התוכן). correctAnswer הוא אותה מילה בדיוק (האותיות ברצף הנכון, ללא רווחים ביניהן) — ודא/י ש-correctAnswer מכיל בדיוק את אותן אותיות כמו items, לא יותר ולא פחות.',
  sentence_order:
    'תן/י משפט קצר ופשוט (3-6 מילים) מתאים לגיל. type חייב להיות "tile_order". החזר/י שדה נוסף tiles: {"items": [מילות המשפט בסדר מעורבב]} — קריטי: items חייב להכיל בדיוק את מילות המשפט, אותה אחת אחת, בלי אף מילה נוספת ובלי אף מילה חסרה (רק הסדר מעורבב, לא התוכן). correctAnswer הוא אותו משפט בדיוק, עם רווחים בין המילים בסדר הנכון — ודא/י שמספר המילים ב-correctAnswer זהה למספר הפריטים ב-items.',
};

const MATH_SUBTYPES: ExerciseSubtype[] = [
  "fill_in_blank",
  "pick_operation",
  "explain_thinking",
  "number_line_placement",
  "pattern_completion",
];
const HEBREW_SUBTYPES: ExerciseSubtype[] = [
  "comprehension",
  "spelling_correction_mc",
  "root_pattern_mc",
  "word_build",
  "sentence_order",
];

/** root_pattern_mc is flagged in the locked inventory as likely ב'-ג' only,
 *  not grade א' — excluded there rather than generated and hoped to be fine. */
function pickSubtype(subject: "math" | "hebrew", grade: Grade): ExerciseSubtype {
  const pool =
    subject === "math"
      ? MATH_SUBTYPES
      : HEBREW_SUBTYPES.filter((s) => !(s === "root_pattern_mc" && grade === "א"));
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generates one new exercise, grounded in the RAG curriculum content at
 * (roughly) the kid's current level — not a fixed problem bank. This is the
 * core mechanism Leo flagged as missing: without a real, structured exercise
 * loop, "placement derived from real exercise performance" (the locked
 * decision) had nothing concrete to derive from.
 *
 * Picks one of the Tier 1 exercise subtypes (see SUBTYPE_GUIDANCE above)
 * and asks the model to build specifically that pattern, rather than
 * leaving "open vs multiple_choice" as the model's own free choice — this
 * is what makes each generated exercise match one of the locked inventory's
 * distinct pedagogical patterns instead of drifting toward whichever shape
 * the model finds easiest.
 */
export async function generateExercise(opts: {
  subject: "math" | "hebrew";
  grade: Grade;
  profile: SubjectProfile | null;
}): Promise<Exercise> {
  const { subject, grade, profile } = opts;

  // Retrieval query: lean on the kid's real profile when it exists (recent
  // summary + topics already covered) so a returning kid gets grounded in
  // where they actually are, not just their nominal grade. A brand-new kid
  // falls back to a generic grade-level query — the locked cold-start
  // tradeoff, not a bug.
  const retrievalQuery = profile?.recentSummary
    ? `${profile.recentSummary} רמה: ${profile.estimatedLevel}`
    : `תרגיל ${subject === "math" ? "בחשבון" : "בעברית"} מתאים לכיתה ${grade}`;

  const queryEmbedding = await embedText(retrievalQuery);
  const retrieved = search(queryEmbedding, { subject, grade, topK: 3 });

  if (retrieved.length === 0) {
    throw new Error(
      `No curriculum content for subject=${subject} grade=${grade} — cannot ground an exercise.`
    );
  }

  const contextBlock = retrieved.map((c) => `- [${c.topic}] ${c.text}`).join("\n");
  const avoidTopics = profile?.topicsCovered.slice(-4).join(", ") || "";
  const subtype = pickSubtype(subject, grade);

  const prompt = `את/ה בונה תרגיל אחד לתלמיד/ה בכיתה ${grade}, בנושא ${subject === "math" ? "חשבון" : "עברית"}.

תוכן לימודי לביסוס התרגיל (מקור: תוכנית הלימודים):
${contextBlock}

${profile ? `רמה משוערת נוכחית של התלמיד/ה: ${profile.estimatedLevel || "ברירת מחדל לפי כיתה"}` : ""}
${avoidTopics ? `נושאים שתורגלו לאחרונה (עדיף לגוון, לא חובה להימנע לגמרי): ${avoidTopics}` : ""}

בחר/י את אחד הנושאים לעיל ובנה/י תרגיל אחד קצר, ברור, ומתאים לגיל, לפי התבנית הבאה בדיוק:
${SUBTYPE_GUIDANCE[subtype]}

החזר/י אך ורק אובייקט JSON תקין, ללא טקסט נוסף, בפורמט הזה:
{
  "type": "open" | "multiple_choice" | "number_line" | "tile_order",
  "topic": "שם הנושא מהרשימה לעיל",
  "passage": "רק אם התבנית דורשת קטע קריאה (comprehension) - הקטע עצמו, אחרת השמט שדה זה",
  "question": "נוסח השאלה, בעברית, מתאים לילד/ה",
  "choices": ["רק אם type הוא multiple_choice - 4 אפשרויות"],
  "numberLine": "רק אם type הוא number_line - {min, max, step}, אחרת השמט שדה זה",
  "tiles": "רק אם type הוא tile_order - {items: [...]}, אחרת השמט שדה זה",
  "correctAnswer": "התשובה הנכונה (ראה הנחיות מיוחדות לתבניות explain_thinking / number_line_placement / pattern_completion / word_build / sentence_order לעיל)"
}`;

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    max_tokens: 500,
    system: "את/ה מחזיר/ה אך ורק JSON תקין, ללא טקסט נוסף, ללא markdown code fences.",
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Exercise generation returned no text content.");
  }

  const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(raw);

  if (typeof parsed.question !== "string" || typeof parsed.correctAnswer !== "string") {
    throw new Error("Exercise generation returned malformed JSON.");
  }

  const type: ExerciseType =
    parsed.type === "multiple_choice" || parsed.type === "number_line" || parsed.type === "tile_order"
      ? parsed.type
      : "open";

  let numberLine: NumberLineData | undefined;
  if (type === "number_line") {
    const nl = parsed.numberLine;
    if (!nl || typeof nl.min !== "number" || typeof nl.max !== "number") {
      throw new Error("Exercise generation returned type=number_line with no valid numberLine payload.");
    }
    numberLine = { min: nl.min, max: nl.max, step: typeof nl.step === "number" && nl.step > 0 ? nl.step : 1 };
  }

  let tiles: TileOrderData | undefined;
  if (type === "tile_order") {
    const items = Array.isArray(parsed.tiles?.items) ? parsed.tiles.items.map(String) : null;
    if (!items || items.length === 0) {
      throw new Error("Exercise generation returned type=tile_order with no valid tiles payload.");
    }

    // The model sometimes pads items with an extra distractor letter/word
    // even when instructed not to (caught via testing: a 4-tile "אמא" —
    // 3 letters). For word_build/sentence_order every tile gets placed, so
    // a count mismatch makes an exact match impossible for any kid attempt
    // — reject rather than ship an unsolvable exercise.
    if (subtype === "word_build" && items.length !== parsed.correctAnswer.length) {
      throw new Error("word_build tile count doesn't match correctAnswer length.");
    }
    if (subtype === "sentence_order" && items.length !== parsed.correctAnswer.trim().split(/\s+/).length) {
      throw new Error("sentence_order tile count doesn't match correctAnswer word count.");
    }
    if (subtype === "pattern_completion" && !items.includes(parsed.correctAnswer)) {
      throw new Error("pattern_completion correctAnswer isn't among the offered tiles.");
    }

    tiles = {
      items,
      slotCount: subtype === "pattern_completion" ? 1 : items.length,
      joinWith: subtype === "word_build" ? "" : " ",
    };
  }

  return {
    id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    subject,
    grade,
    type,
    subtype,
    topic: typeof parsed.topic === "string" ? parsed.topic : retrieved[0].topic,
    passage: subtype === "comprehension" && typeof parsed.passage === "string" ? parsed.passage : undefined,
    question: parsed.question,
    choices: Array.isArray(parsed.choices) ? parsed.choices.map(String) : undefined,
    numberLine,
    tiles,
    correctAnswer: parsed.correctAnswer,
  };
}
