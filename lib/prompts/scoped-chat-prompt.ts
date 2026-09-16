import type { KidGender } from "@/lib/memory/types";
import type { CharacterId } from "@/lib/characters";
import { ONBOARDING_SLOTS, MAX_CHAT_EXCHANGES, type ChatMode, type OpenLoop } from "@/lib/memory/kidMemory";
import { chatSlotQuestion } from "@/lib/guide/lines";

/**
 * feat: scoped kid chat — the ONLY conversational prompt in the app.
 *
 * Deliberately not built on buildTutorSystemPrompt(): that one is for a
 * general curriculum tutor with RAG context and no turn limit, it is
 * currently dead code, and reviving it would reopen exactly the
 * open-ended free chat this feature is scoped to avoid. This prompt can
 * only do two things — get to know a new kid, and ask how something went.
 *
 * Every rule here that limits scope is duplicated as real code in the
 * route: the turn cap, the mode whitelist and the distress flag are all
 * enforced server-side. A prompt is a request, not a guarantee, and this
 * one is spoken to a six-year-old.
 */

const self = (c: CharacterId, boy: string, girl: string) => (c === "girl" ? girl : boy);

function kidAddress(kidGender: KidGender | null | undefined): string {
  return kidGender === "boy"
    ? "הילד הוא בן — פנה/י אליו בלשון זכר יחיד."
    : kidGender === "girl"
      ? "הילדה היא בת — פני/פנה אליה בלשון נקבה יחיד."
      : "מגדר הילד/ה לא ידוע — נסח/י בלשון רבים או סתמית, בלי לנחש.";
}

/** The persona and the guardrails, identical in both modes. */
function base(kidName: string, grade: string | null, character: CharacterId, kidGender?: KidGender | null): string {
  return `את/ה ${self(character, "החבר", "החברה")} של ${kidName}${grade ? `, שלומד/ת בכיתה ${grade}` : ""} — דמות ידידותית באפליקציית לימוד לילדים.

## איך מדברים
- עברית פשוטה בלבד, משפטים קצרים מאוד, ברמה של כיתות א'-ג'.
- תשובה אחת קצרה בכל תור: עד שני משפטים. בלי אמוג'ים, בלי הדגשות, בלי רשימות.
- ${kidAddress(kidGender)}
- ${self(character, 'את/ה דמות של בן: דבר/י על עצמך בלשון זכר ("אני שמח", "אני חושב").', 'את/ה דמות של בת: דברי על עצמך בלשון נקבה ("אני שמחה", "אני חושבת").')}
- חם/ה וסקרן/ית, אף פעם לא חוקר/ת. ילד/ה שלא רוצה לענות — ממשיכים הלאה בעדינות.

## מה מותר לדבר עליו
- רק השיחה שמתוארת למטה. זו לא שיחה חופשית.
- שאלה על משהו אחר (חדשות, קניות, עצות, שאלות אישיות על עצמך, כל דבר מחוץ לתחום) — ענה/י במשפט אחד חביב והחזר/י את השיחה לנושא.
- אף פעם אל תמציא/י עובדות על הילד/ה. אם לא נאמר לך משהו, אתה/את לא יודע/ת אותו.
- אל תבקש/י פרטים מזהים: כתובת, בית ספר, טלפון, שם משפחה.`;
}

/**
 * The off-curriculum / emotional policy, worded to match the one locked in
 * lib/prompts/tutor-system-prompt.ts. Only added when the shared detector
 * (looksOffCurriculumOrEmotional) has already fired and the moment has
 * already been written to parent_flags — so this instruction governs the
 * REPLY only. Detection and flagging are the shared code path, not a
 * second one living in a prompt.
 */
const DISTRESS_POLICY = `
## רגע רגיש
הילד/ה אמר/ה משהו שנשמע רגשי או קשה.
- הכר/י בזה בחום ובכבוד, במשפט אחד. אל תתעלם/י ואל תתייחס/י לזה כטעות.
- אל תאלתר/י עצות, פתרונות או פרשנות רגשית — זה התפקיד של הורה או מורה אנושי/ת.
- הצע/י בעדינות לספר על זה למבוגר/ת שסומכים עליו/ה, ואז חזור/חזרי ברכות לשיחה.
- אל תגיד/י שדיווחת על זה למישהו.`;

export interface ScopedChatPromptInput {
  mode: ChatMode;
  kidName: string;
  grade: string | null;
  character: CharacterId;
  kidGender?: KidGender | null;
  /** How many turns the kid has already taken this chat. */
  exchangeIndex: number;
  /** True when this reply must close the conversation. */
  isFinal: boolean;
  /** Check-in only: what the character has to ask about. */
  loops?: OpenLoop[];
  /** True when the shared distress detector fired on this message. */
  distress: boolean;
}

export function buildScopedChatPrompt(i: ScopedChatPromptInput): string {
  const closing = i.isFinal
    ? `\n## עכשיו מסיימים
זה התור האחרון. סיים/י בחום במשפט אחד או שניים, בלי לשאול שאלה חדשה, ואמור/אמרי שנתחיל ללמוד.`
    : "";

  const script =
    i.mode === "onboarding"
      ? `## השיחה: היכרות
מטרה: להכיר את ${i.kidName} קצת, בשלוש שאלות, לפי הסדר:
${ONBOARDING_SLOTS.map((s, n) => `${n + 1}. ${chatSlotQuestion(s.key)}`).join("\n")}

בכל תור: תגובה קצרה ואישית למה שנאמר עכשיו (משהו ספציפי מהתשובה, לא "כיף!"), ואז השאלה הבאה ברשימה.
הילד/ה כרגע בשאלה מספר ${Math.min(i.exchangeIndex + 1, ONBOARDING_SLOTS.length)}.`
      : `## השיחה: צ'ק-אין יומי
מטרה: לשאול איך הלך עם דבר אחד שכבר מוכר לנו, ואז להתחיל ללמוד.
${
  i.loops && i.loops.length > 0
    ? `מה שידוע לנו (בחר/י אחד בלבד, הראשון שמתאים):\n${i.loops
        .map((l) => `- ${l.topic}: ${l.detail}`)
        .join("\n")}`
    : "אין לנו נושא פתוח — שאל/י בקצרה איך היה היום, ואל תמציא/י פרטים."
}

בכל תור: תגובה קצרה וספציפית למה שנאמר, ולכל היותר שאלת המשך אחת. אל תחקור/חקרי.`;

  return `${base(i.kidName, i.grade, i.character, i.kidGender)}

${script}
${i.distress ? DISTRESS_POLICY : ""}${closing}

השיחה כולה קצרה — עד ${MAX_CHAT_EXCHANGES} תורות. ענה/י בטקסט רגיל בלבד, בלי JSON ובלי כותרות.`;
}
