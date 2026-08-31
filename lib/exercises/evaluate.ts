import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { Exercise, ExerciseEvaluation } from "./types";

/**
 * Judges a kid's answer with the LLM (not string-equality — an open-response
 * math or Hebrew answer needs real judgment: "12" vs "יש 12" vs a correct
 * but differently-worded explanation should all count). Feedback follows the
 * same locked pedagogy as free chat (lib/prompts/tutor-system-prompt.ts):
 * process praise if right, validate-then-hint (never just reveal the
 * answer) if wrong.
 */
export async function evaluateExerciseAnswer(
  exercise: Exercise,
  kidAnswer: string
): Promise<ExerciseEvaluation> {
  const anthropic = getAnthropicClient();

  // "explain_thinking" has no single right answer — correctAnswer holds a
  // description of what a good explanation looks like, not a literal
  // target. Judging it like every other subtype (fuzzy match against a
  // fixed answer) would mark a valid-but-different explanation wrong.
  // pattern_completion/word_build/sentence_order/equation_balance/shape_match
  // are all tile-arrangement tasks (see lib/exercises/types.ts TileOrderData)
  // — the kid's placed tiles get serialized into one string by PracticeMode,
  // same shape as correctAnswer. Unlike the fuzzy math/explanation judging
  // below, exact match is the actual thing being tested here, so "close but
  // scrambled/wrong tile" must not pass.
  const isTileOrderSubtype =
    exercise.subtype === "pattern_completion" ||
    exercise.subtype === "word_build" ||
    exercise.subtype === "sentence_order" ||
    exercise.subtype === "equation_balance" ||
    exercise.subtype === "shape_match";

  const judgingInstruction =
    exercise.subtype === "explain_thinking"
      ? `אין כאן תשובה נכונה יחידה. "${exercise.correctAnswer}" הוא תיאור של מה מאפיין הסבר טוב, לא תשובה מדויקת לחפש. שפוט/י אם ההסבר של התלמיד/ה מציג חשיבה הגיונית ותקפה על הבעיה — גם אם הדרך שונה מהמתואר.`
      : isTileOrderSubtype
        ? `זהו תרגיל של סידור אבנים/אריחים לפי סדר/ערך נכון. קבל/י כתשובה נכונה רק אם התשובה תואמת בדיוק את "${exercise.correctAnswer}" (מותר להתעלם מהבדלי רווחים), לא סידור "קרוב" או חלקית נכון.`
        : exercise.subtype === "visual_grouping"
          ? `התלמיד/ה חילק/ה חפצים לקבוצות. התשובה שהתלמיד/ה נתן/ה מכילה את מספר הפריטים בכל אחת מהקבוצות שיצר/ה, מופרדים בפסיקים. התשובה הנכונה, "${exercise.correctAnswer}", היא מספר הפריטים שאמור להיות בכל קבוצה. קבל/י כתשובה נכונה רק אם כל המספרים בתשובת התלמיד/ה שווים בדיוק למספר הזה — אם קבוצה כלשהי גדולה או קטנה ממנו, זו תשובה שגויה.`
          : `שפוט/י אם התשובה נכונה — קבל/י ניסוחים שונים או תשובות חלקיות-אך-נכונות מבחינה מהותית, לא רק התאמה מילולית מדויקת.`;

  const prompt = `שאלה שנשאלה לתלמיד/ה: "${exercise.question}"
${exercise.passage ? `קטע קריאה: "${exercise.passage}"` : ""}
${exercise.choices ? `אפשרויות: ${exercise.choices.join(" | ")}` : ""}
התשובה הנכונה: "${exercise.correctAnswer}"
התשובה שהתלמיד/ה נתן/ה: "${kidAnswer}"

${judgingInstruction}

כתוב/י משוב לתלמיד/ה, בעברית, בטון חם ומעודד — קצר מאוד, ילד/ה בכיתה יסודית קורא/ת את זה, לא מבוגר/ת. אורך הוא כלל נוקשה כאן, לא המלצה:
- אם נכון: משפט אחד בלבד, לא יותר. שבח/י על התהליך/המאמץ, לא על תכונה מולדת (למשל "ניסית וזה עבד!" ולא "את/ה כל כך חכם/ה"). בלי הסבר נוסף אחרי זה.
  דוגמה לאורך הנכון בדיוק: "כל הכבוד, מצאת את זה!"
- אם לא נכון: עד שני חלקים קצרים בלבד, כל חלק עד כ-8 מילים — (1) תיקוף רגשי קצר ("זה בסדר, זה קורה") ואז (2) רמז אחד קצר שמכוון לכיוון הנכון, בלי לגלות את התשובה. בלי משפט שלישי.
  דוגמה לאורך הנכון בדיוק: "זה בסדר, זה קורה! נסה לחבר קודם את העשרות."

החזר/י אך ורק אובייקט JSON תקין:
{
  "correct": true | false,
  "feedback": "המשוב לתלמיד/ה כמתואר לעיל",
  "errorNote": "רק אם לא נכון - תיאור קצר של סוג הטעות (למשל 'בלבול בין חיבור לחיסור' או 'טעות בכיוון הגזירה'), לצורך מעקב פנימי - לא מוצג לתלמיד/ה"
}`;

  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    // Was 400 — generous headroom that let feedback run long (real
    // examples seen: 3-4 sentences for one correct answer). The prompt
    // above now hard-caps feedback length itself; this cap is a second,
    // structural backstop — a shorter ceiling also bounds worst-case
    // generation time, part of the "make it faster" pass.
    max_tokens: 220,
    system: "את/ה מחזיר/ה אך ורק JSON תקין, ללא טקסט נוסף, ללא markdown code fences.",
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Exercise evaluation returned no text content.");
  }

  const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(raw);

  return {
    correct: parsed.correct === true,
    feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
    errorNote: typeof parsed.errorNote === "string" ? parsed.errorNote : undefined,
  };
}
