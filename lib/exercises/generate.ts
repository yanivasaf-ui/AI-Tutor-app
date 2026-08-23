import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { embedText } from "@/lib/rag/embed";
import { search } from "@/lib/rag/store";
import { SubjectProfile } from "@/lib/memory/types";
import { Exercise, Grade } from "./types";

/**
 * Generates one new exercise, grounded in the RAG curriculum content at
 * (roughly) the kid's current level — not a fixed problem bank. This is the
 * core mechanism Leo flagged as missing: without a real, structured exercise
 * loop, "placement derived from real exercise performance" (the locked
 * decision) had nothing concrete to derive from.
 *
 * Chooses open-response vs multiple-choice per problem based on what fits
 * the topic, decided by the model itself — no separate "kid modality
 * preference" system yet (explicitly out of scope for this pass, per the
 * strategy conversation that flagged voice as the only genuinely expensive
 * modality; MC vs open text is free either way).
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

  const prompt = `את/ה בונה תרגיל אחד לתלמיד/ה בכיתה ${grade}, בנושא ${subject === "math" ? "חשבון" : "עברית"}.

תוכן לימודי לביסוס התרגיל (מקור: תוכנית הלימודים):
${contextBlock}

${profile ? `רמה משוערת נוכחית של התלמיד/ה: ${profile.estimatedLevel || "ברירת מחדל לפי כיתה"}` : ""}
${avoidTopics ? `נושאים שתורגלו לאחרונה (עדיף לגוון, לא חובה להימנע לגמרי): ${avoidTopics}` : ""}

בחר/י את אחד הנושאים לעיל ובנה/י תרגיל אחד קצר, ברור, ומתאים לגיל. בחר/י את הפורמט המתאים ביותר לתרגיל הזה: "open" (תשובה פתוחה קצרה) או "multiple_choice" (4 אפשרויות, רק אחת נכונה).

החזר/י אך ורק אובייקט JSON תקין, ללא טקסט נוסף, בפורמט הזה:
{
  "type": "open" | "multiple_choice",
  "topic": "שם הנושא מהרשימה לעיל",
  "question": "נוסח השאלה, בעברית, מתאים לילד/ה",
  "choices": ["רק אם type הוא multiple_choice - 4 אפשרויות"],
  "correctAnswer": "התשובה הנכונה (או הטקסט המדויק של האפשרות הנכונה אם multiple_choice)"
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
    topic: typeof parsed.topic === "string" ? parsed.topic : retrieved[0].topic,
    question: parsed.question,
    choices: Array.isArray(parsed.choices) ? parsed.choices.map(String) : undefined,
    correctAnswer: parsed.correctAnswer,
  };
}
