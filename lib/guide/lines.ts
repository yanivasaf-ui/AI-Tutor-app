import type { CharacterId } from "@/lib/characters";

/**
 * Everything the character says, in one place (character-led redesign,
 * Task 5 items 4-5).
 *
 * `name` is the kid's name. SpeechBubble renders it first and bold, and
 * the spoken form opens with it — the character addresses the kid by name
 * in every line. The only lines without one are the two said *before*
 * the kid has told us their name (the character pick and the name
 * question in onboarding), which can't include it by definition.
 *
 * Hebrew grammar rules for every line here — these are spoken by TTS,
 * not just read:
 *
 * 1. Nothing gendered toward the kid. We don't know the kid's gender, and
 *    the character they picked says nothing about it. Lines use
 *    gender-neutral forms: impersonal/plural present ("לוחצים",
 *    "מתחילים"), first-person plural ("נמשיך", "עברנו"), infinitives
 *    ("אפשר ללחוץ").
 * 2. No slash forms ("נסה/י"). They're fine on a printed page and broken
 *    out loud — TTS reads the slash, or a gender at random.
 * 3. No forms that are gendered in *speech* but identical in *writing*.
 *    "לך", "שלך", "בחרת", "מחכה" look neutral on screen, but TTS has to
 *    pick a pronunciation (lecha/lach, mechake/mechaka) and will
 *    misgender half the kids — or, for the character's own verbs, make
 *    the girl character speak as a boy. Avoided entirely.
 * 4. The character's own first-person verbs *are* gendered — to the
 *    character (girl = feminine), same as the existing THINKING_CUE —
 *    and only where the two forms are written differently (שמח/שמחה,
 *    חושב/חושבת, מכין/מכינה).
 */
export interface Line {
  name?: string;
  text: string;
}

export function spoken(line: Line): string {
  return line.name ? `${line.name}, ${line.text}` : line.text;
}

const self = (c: CharacterId, boy: string, girl: string) => (c === "girl" ? girl : boy);

// ---- Onboarding --------------------------------------------------------

export const pickPrompt = (name?: string): Line =>
  name ? { name, text: "עם מי רוצים ללמוד?" } : { text: "היי! עם מי רוצים ללמוד?" };

export const picked = (c: CharacterId, name?: string): Line => ({
  name,
  text: self(c, "יש! אני כל כך שמח שנלמד ביחד!", "יש! אני כל כך שמחה שנלמד ביחד!"),
});

export const askName = (): Line => ({ text: "היי! בואו נכיר — מה השם?" });

export const askGrade = (name: string): Line => ({ name, text: "נעים מאוד! באיזו כיתה?" });

// ---- Map ---------------------------------------------------------------

export const mapFirst = (name: string): Line => ({
  name,
  text: "זו התחנה הראשונה שלנו. לוחצים על העיגול ומתחילים!",
});

export const mapNext = (name: string): Line => ({
  name,
  text: "הנה התחנה הבאה שלנו! לוחצים על העיגול וממשיכים.",
});

export const mapAllDone = (name: string): Line => ({ name, text: "עברנו את כל התחנות! כל הכבוד!" });

export const mapLocked = (name: string): Line => ({
  name,
  text: "לתחנה הזאת נגיע בהמשך. קודם — התחנה שלנו!",
});

export const mapEmpty = (name: string, otherSubjectLabel: string): Line => ({
  name,
  text: `כאן עוד אין תחנות. אולי ננסה ${otherSubjectLabel}?`,
});

// ---- Parent gate -------------------------------------------------------

export const parentGate = (name: string): Line => ({
  name,
  text: "כאן נכנסים רק הורים. אפשר לקרוא לאחד מהם?",
});

// ---- Exercise ----------------------------------------------------------

export const buildingExercise = (c: CharacterId, name: string): Line => ({
  name,
  text: self(c, "רגע, אני מכין לנו תרגיל...", "רגע, אני מכינה לנו תרגיל..."),
});

export const thinking = (c: CharacterId, name: string): Line => ({
  name,
  text: self(c, "רגע, אני חושב...", "רגע, אני חושבת..."),
});

export const notHeard = (name: string): Line => ({
  name,
  text: "לא שמעתי טוב. אפשר לומר שוב, או ללחוץ על תשובה.",
});

export const noContent = (name: string): Line => ({
  name,
  text: "לתחנה הזאת עוד אין לי תרגילים. נחזור למפה?",
});

export const somethingBroke = (name: string): Line => ({ name, text: "משהו השתבש. אפשר לנסות שוב?" });

/** The exercise question, as the character's line. */
export const question = (name: string, text: string): Line => ({ name, text });

/** Tutor feedback comes from the LLM, which may already use the kid's
 *  name — don't address them twice in one breath. */
export const feedback = (name: string, text: string): Line =>
  text.includes(name) ? { text } : { name, text };

// ---- Tier-2 celebrations -----------------------------------------------

export const topicComplete = (name: string): Line => ({
  name,
  text: "סיימנו תחנה! התחנה הבאה במפה נפתחה.",
});

export const sessionComplete = (name: string): Line => ({
  name,
  text: "איזו עבודה מצוינת היום — רבע שעה שלמה! אפשר לעצור כאן, או להמשיך עוד קצת.",
});

export const goodbye = (name: string): Line => ({ name, text: "להתראות! נתראה מחר." });
