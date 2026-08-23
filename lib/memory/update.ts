import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { SubjectProfile } from "./types";

/**
 * After each tutor exchange, ask the model itself to update the kid's
 * persistent subject profile — a short, lightweight second call (small
 * max_tokens, forced JSON-ish output) rather than a hardcoded heuristic.
 * This matches the locked decision that pacing/level judgment is an LLM
 * call, not an algorithm ("this is not an algorithm, it's an LLM that
 * helps here" — M-memory/decisions.md, 2026-08-22).
 *
 * Deliberately kept separate from the main tutoring reply call so a
 * malformed update never breaks the reply the kid actually sees — on any
 * failure we just keep the previous profile untouched.
 */
export async function updateSubjectProfileFromExchange(
  current: SubjectProfile,
  opts: {
    grade: string;
    subject: string;
    kidName: string;
    userMessage: string;
    tutorReply: string;
  }
): Promise<Partial<SubjectProfile> | null> {
  const anthropic = getAnthropicClient();

  const prompt = `אתה עוזר שמעדכן פרופיל למידה פנימי של תלמיד/ה אחרי כל חילופי דברים עם מורה AI. אל תדבר אל התלמיד/ה - זה עדכון פנימי בלבד.

תלמיד/ה: ${opts.kidName}, כיתה ${opts.grade}, נושא: ${opts.subject}

מצב נוכחי של הפרופיל:
- רמה משוערת: ${current.estimatedLevel || "(אין עדיין - ברירת מחדל לפי כיתה)"}
- נושאים שכוסו עד כה: ${current.topicsCovered.join(", ") || "(אין עדיין)"}
- דפוסי טעויות חוזרים: ${current.errorPatterns.join(", ") || "(אין עדיין)"}
- אותות רגשיים בולטים: ${current.emotionalSignals.join(", ") || "(אין עדיין)"}
- תקציר קודם: ${current.recentSummary || "(אין עדיין)"}

חילופי הדברים האחרונים:
תלמיד/ה: ${opts.userMessage}
מורה: ${opts.tutorReply}

החזר/י אך ורק אובייקט JSON תקין (בלי טקסט נוסף, בלי הסברים) בפורמט הבא, כשכל שדה משקף את המצב המצטבר המעודכן (לא רק את החילופין האחרון), בעברית:
{
  "estimatedLevel": "משפט קצר אחד שמתאר רמה/קצב משוערים, או אותו ערך כמו קודם אם אין שינוי",
  "topicsCovered": ["מערך מעודכן של עד 8 נושאים אחרונים, מהישן לחדש"],
  "errorPatterns": ["מערך מעודכן של עד 5 דפוסי טעויות חוזרים, אם יש"],
  "emotionalSignals": ["מערך מעודכן של עד 5 אותות רגשיים בולטים, אם יש"],
  "recentSummary": "1-2 משפטים המסכמים את מצב הלמידה הנוכחי, להזרקה לפרומפט הבא"
}

אם החילופין הנוכחיים לא מוסיפים מידע משמעותי, פשוט החזר/י את הערכים הקודמים ללא שינוי (למעט אם ברור שיש שינוי אמיתי).`;

  try {
    const response = await anthropic.messages.create({
      model: TUTOR_MODEL,
      max_tokens: 400,
      system:
        "אתה מחזיר אך ורק JSON תקין, ללא טקסט נוסף, ללא markdown code fences.",
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;

    const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(raw);

    const patch: Partial<SubjectProfile> = {};
    if (typeof parsed.estimatedLevel === "string") patch.estimatedLevel = parsed.estimatedLevel;
    if (Array.isArray(parsed.topicsCovered)) {
      patch.topicsCovered = parsed.topicsCovered.slice(-8).map(String);
    }
    if (Array.isArray(parsed.errorPatterns)) {
      patch.errorPatterns = parsed.errorPatterns.slice(-5).map(String);
    }
    if (Array.isArray(parsed.emotionalSignals)) {
      patch.emotionalSignals = parsed.emotionalSignals.slice(-5).map(String);
    }
    if (typeof parsed.recentSummary === "string") patch.recentSummary = parsed.recentSummary;

    return patch;
  } catch (err) {
    // Never let a malformed memory-update call break the tutoring flow.
    console.error("[memory-update] failed to update subject profile:", err);
    return null;
  }
}
