import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { embedText } from "@/lib/rag/embed";
import { search } from "@/lib/rag/store";
import { SubjectProfile } from "@/lib/memory/types";
import { Exercise, ExerciseSubtype, Grade } from "./types";

/**
 * Tier 1 subtypes from output/exercise-types-build-brief.md — the ones that
 * need no new interaction shape, only subtype-aware generation/evaluation.
 * Each guidance string tells the model exactly what pattern to build and
 * which `type` it must render as, so the six subtypes stay pedagogically
 * distinct instead of collapsing back into "pick open or multiple_choice."
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
};

const MATH_SUBTYPES: ExerciseSubtype[] = ["fill_in_blank", "pick_operation", "explain_thinking"];
const HEBREW_SUBTYPES: ExerciseSubtype[] = ["comprehension", "spelling_correction_mc", "root_pattern_mc"];

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
  "type": "open" | "multiple_choice",
  "topic": "שם הנושא מהרשימה לעיל",
  "passage": "רק אם התבנית דורשת קטע קריאה (comprehension) - הקטע עצמו, אחרת השמט שדה זה",
  "question": "נוסח השאלה, בעברית, מתאים לילד/ה",
  "choices": ["רק אם type הוא multiple_choice - 4 אפשרויות"],
  "correctAnswer": "התשובה הנכונה (או הטקסט המדויק של האפשרות הנכונה אם multiple_choice; ראה הנחיה מיוחדת לתבנית explain_thinking)"
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

  return {
    id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    subject,
    grade,
    type: parsed.type === "multiple_choice" ? "multiple_choice" : "open",
    subtype,
    topic: typeof parsed.topic === "string" ? parsed.topic : retrieved[0].topic,
    passage: subtype === "comprehension" && typeof parsed.passage === "string" ? parsed.passage : undefined,
    question: parsed.question,
    choices: Array.isArray(parsed.choices) ? parsed.choices.map(String) : undefined,
    correctAnswer: parsed.correctAnswer,
  };
}
