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

  const prompt = `שאלה שנשאלה לתלמיד/ה: "${exercise.question}"
${exercise.choices ? `אפשרויות: ${exercise.choices.join(" | ")}` : ""}
התשובה הנכונה: "${exercise.correctAnswer}"
התשובה שהתלמיד/ה נתן/ה: "${kidAnswer}"

שפוט/י אם התשובה נכונה — קבל/י ניסוחים שונים או תשובות חלקיות-אך-נכונות מבחינה מהותית, לא רק התאמה מילולית מדויקת.

כתוב/י משוב לתלמיד/ה, בעברית, בטון חם ומעודד, במשפטים קצרים:
- אם נכון: שבח/י על התהליך/המאמץ, לא על תכונה מולדת ("ניסית כמה דרכים ומצאת!" ולא "את/ה כל כך חכם/ה").
- אם לא נכון: תקף/י רגשית קודם ("זה בסדר, זה קורה"), תן/י רמז אחד בלבד שמכוון לכיוון הנכון - אל תיתן/י את התשובה הנכונה במפורש, ועודד/י ניסיון נוסף.

החזר/י אך ורק אובייקט JSON תקין:
{
  "correct": true | false,
  "feedback": "המשוב לתלמיד/ה כמתואר לעיל",
  "errorNote": "רק אם לא נכון - תיאור קצר של סוג הטעות (למשל 'בלבול בין חיבור לחיסור' או 'טעות בכיוון הגזירה'), לצורך מעקב פנימי - לא מוצג לתלמיד/ה"
}`;

  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    max_tokens: 400,
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
