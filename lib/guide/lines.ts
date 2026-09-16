import type { CharacterId } from "@/lib/characters";
import type { KidGender } from "@/lib/memory/types";

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
 * 1. (2026-09-15, voice-experience fix item 4) The kid's gender is now
 *    collected in onboarding (KidGender, lib/memory/types.ts) and known
 *    everywhere after that step. A handful of lines ask the kid directly
 *    what THEY want ("מה רוצים ללמוד?") and used to hide behind the
 *    impersonal/generic-plural form specifically to dodge an unknown
 *    gender — those now take an optional `kidGender` and address the kid
 *    directly ("מה אתה/את רוצה"), via the `directed()` helper below.
 *    Falls back to the old neutral phrasing when gender is null (a kid
 *    from before this field existed, or the two lines asked before
 *    gender is known at all — pickPrompt/askName/askGrade, onboarding's
 *    own first steps). Most other lines were never actually dodging
 *    gender in the first place — genuine first-person-plural "let's"
 *    framing ("נמשיך", "עברנו") and impersonal UI instructions
 *    ("לוחצים על העיגול", "אפשר ללחוץ") are gender-invariant in Hebrew
 *    on their own merits, not a workaround, so they're unchanged.
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
  /** When set, spoken() says THIS instead of `text` — for a line whose
   *  BUBBLE stays short while its SPOKEN form says more (e.g. reading a
   *  list of options aloud after a short visible prompt, so the bubble
   *  isn't a wall of text duplicating buttons already on screen). */
  spokenText?: string;
}

export function spoken(line: Line): string {
  const body = line.spokenText ?? line.text;
  return line.name ? `${line.name}, ${body}` : body;
}

const self = (c: CharacterId, boy: string, girl: string) => (c === "girl" ? girl : boy);

/** Same shape as `self()`, but for the CHILD's own gender rather than the
 *  character's — see rule 1 above. `neutral` is used when gender isn't
 *  known yet. */
const directed = (g: KidGender | null | undefined, boy: string, girl: string, neutral: string) =>
  g === "boy" ? boy : g === "girl" ? girl : neutral;

// ---- Onboarding --------------------------------------------------------

export const pickPrompt = (name?: string): Line =>
  name ? { name, text: "עם מי רוצים ללמוד?" } : { text: "היי! עם מי רוצים ללמוד?" };

export const picked = (c: CharacterId, name?: string): Line => ({
  name,
  text: self(c, "יש! אני כל כך שמח שנלמד ביחד!", "יש! אני כל כך שמחה שנלמד ביחד!"),
});

export const askName = (): Line => ({ text: "היי! בואו נכיר — מה השם?" });

/** Voice-experience fix item 4 (2026-09-15): new onboarding step, name
 *  then gender then grade — collected once so every later line can
 *  address the kid correctly. */
export const askGender = (name: string): Line => ({ name, text: "אתה בן או את בת?" });

export const askGrade = (name: string): Line => ({ name, text: "נעים מאוד! באיזו כיתה?" });

// ---- Entry: mode choice --------------------------------------------------

/** Asked after sign-in, before anything else. The "continue the journey"
 *  half is neutral on purpose (first-person-plural, invariant) — the
 *  journey isn't presented as the "right" answer; only the "something
 *  else" half asks the kid directly, so only that half is gendered. */
export const modeQuestion = (name: string, kidGender?: KidGender | null): Line => ({
  name,
  text: `נמשיך במסלול שלנו, או שיש משהו ש${directed(kidGender, "אתה רוצה", "את רוצה", "רוצים")} לתרגל?`,
});

// ---- Scoped chat -------------------------------------------------------

/**
 * feat: scoped kid chat — the onboarding script's questions. They live here
 * with every other line the character says, and are the SINGLE source for
 * both the opener the kid sees first and the script the server hands the
 * model. Two copies would drift, and the kid would be asked the first
 * question twice.
 *
 * Gender-free by rule 3 above: these reach TTS through the same niqqud
 * step, which has no idea whose chat this is.
 */
export const chatSlotQuestion = (key: "friend" | "hobby" | "school"): string => {
  switch (key) {
    case "friend":
      return "עם מי הכי כיף לשחק בכיתה?";
    case "hobby":
      return "ומה הכי אוהבים לעשות אחרי הלימודים?";
    case "school":
      return "ומה השיעור הכי כיף בבית הספר?";
  }
};

/** The character's first line — said before the kid has typed anything, so
 *  it is templated rather than generated: no model call to open a chat. */
export const chatOpening = (mode: "onboarding" | "checkin", name: string): Line =>
  mode === "onboarding"
    ? { name, text: `כיף להכיר! ${chatSlotQuestion("friend")}` }
    : { name, text: "היי! ספרו לי, איך היה היום?" };

/** "היום" / "אתמול" / "לא מזמן" — the only three the opener ever needs. */
function whenHe(daysAgo: number): string {
  if (daysAgo <= 0) return "היום";
  if (daysAgo === 1) return "אתמול";
  return "לא מזמן";
}

/**
 * feat: continuity greeting — the same mode question, opened by ONE
 * concrete thing that actually happened last time (lib/memory/kidMemory.ts's
 * pickOpenerFact). "נועה, אתמול חילוק היה קצת קשה, אז היום נתחיל משם.
 * נמשיך במסלול שלנו, או..."
 *
 * Deliberately in first-person plural ("הצלחנו", "סיימנו", "נתחיל"), not
 * second person: the natural phrasings here — "פתרת", "הלך לך" — are rule 3
 * above, written identically for a boy and a girl but pronounced
 * differently, and the niqqud step in front of TTS has no idea which kid
 * it is vocalising for. "We" is both the house voice for shared activity
 * (see journeyIntro) and the only form that cannot be mispronounced into
 * the wrong gender. The kid's gender still reaches the question half, which
 * has written-distinct forms and is safe.
 */
export const continuityGreeting = (
  name: string,
  fact: { factType: "win" | "struggle" | "preference" | "milestone"; topic: string; daysAgo: number },
  kidGender?: KidGender | null
): Line => {
  const when = whenHe(fact.daysAgo);
  const opener =
    fact.factType === "struggle"
      ? `${when} ${fact.topic} היה קצת קשה, אז נתחיל משם.`
      : fact.factType === "milestone"
        ? `${when} סיימנו את ${fact.topic} — איזה כיף!`
        : `${when} הצלחנו יפה ב${fact.topic}!`;
  return { name, text: `${opener} ${modeQuestion(name, kidGender).text}` };
};

// ---- Free practice -----------------------------------------------------

export const freePickSubject = (name: string, kidGender?: KidGender | null): Line => ({
  name,
  text: `מה ${directed(kidGender, "אתה מתרגל", "את מתרגלת", "מתרגלים")} — מתמטיקה או עברית? אפשר ללחוץ, או לומר.`,
});

/** The suggestion itself is tagged in the list; the spoken line only says
 *  it's there — "ההורים", not a slash form. */
export const freePickTopic = (name: string, hasSuggestion: boolean, kidGender?: KidGender | null): Line => ({
  name,
  text: hasSuggestion
    ? `מה ${directed(kidGender, "אתה רוצה", "את רוצה", "רוצים")} לתרגל? ההצעה של ההורים ראשונה ברשימה.`
    : `מה ${directed(kidGender, "אתה רוצה", "את רוצה", "רוצים")} לתרגל? אפשר ללחוץ על נושא, או לומר אותו.`,
});


export const topicNotFound = (name: string): Line => ({
  name,
  text: "לא מצאתי נושא כזה. אפשר לומר שוב, או ללחוץ על נושא.",
});

// ---- Map ---------------------------------------------------------------

/** Said once per subject, the first time the kid opens that subject's
 *  map — frames the path as the school year. */
export const journeyIntro = (name: string, started: boolean): Line => ({
  name,
  text: `זו הדרך שלנו לכל השנה — מספטמבר ועד יוני, עם עצירות בחנוכה ובפסח. לוחצים על העיגול ו${
    started ? "ממשיכים" : "מתחילים"
  }!`,
});

export const milestoneReached = (name: string, holiday: string): Line => ({
  name,
  text: `הגענו ל${holiday}! איזו דרך עשינו עד כאן.`,
});

export const milestoneAhead = (name: string, holiday: string): Line => ({
  name,
  text: `ל${holiday} נגיע בהמשך הדרך. קודם — התחנה שלנו!`,
});

/** `topic` names the stop (QA: "the map never shows the topic name") —
 *  both the character's spoken/written line and the visible name near the
 *  node itself (SpeechBubble's `eyebrow`, see ProgressMap.tsx). */
export const mapFirst = (name: string, topic: string): Line => ({
  name,
  text: `זו התחנה הראשונה שלנו: ${topic}. לוחצים על העיגול ומתחילים!`,
});

export const mapNext = (name: string, topic: string): Line => ({
  name,
  text: `התחנה הבאה שלנו: ${topic}. לוחצים על העיגול וממשיכים.`,
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

/** SpeechRecognition's "not-allowed"/"service-not-allowed" — the OS or
 *  browser refused microphone access, as opposed to genuinely hearing
 *  nothing (notHeard, above). Distinct copy because "I didn't hear you"
 *  invites trying again louder, which does nothing when the mic is
 *  blocked — every retry would fail the same way until a permission
 *  setting changes. Tap answers stay the way forward either way. */
export const micBlocked = (name: string): Line => ({
  name,
  text: "אין גישה למיקרופון. אפשר ללחוץ על תשובה בעצם.",
});

/** Grouping's tap-to-place interaction (star -> bucket) has no affordance
 *  a kid can infer just from looking at it — said in the same breath as
 *  the question and shown as a caption under it (see ExerciseScreen). No
 *  `name`: it's appended to a line that already opens with one. */
export const groupingInstructions = (): Line => ({
  text: "לוחצים על כוכב, ואז על הקבוצה.",
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
