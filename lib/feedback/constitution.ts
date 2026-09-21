import type { KidGender } from "@/lib/memory/types";

/**
 * The feedback constitution: one place that owns what the character is
 * allowed to say back to a child about their work.
 *
 * WHY A MODULE AND NOT A STYLE GUIDE. Feedback strings were spread across
 * three files and one prompt, and the prompt is written by a model at
 * runtime. A rule that lives only in prose gets followed until it isn't,
 * and nobody notices — a child hears it once and it is gone. Here the
 * rules are data: the forbidden shapes are patterns that code can test,
 * every owned line is checked against them by the test suite, and the
 * model's output is run through the same check before a child hears it.
 *
 * WHAT "FEEDBACK" MEANS HERE, precisely: anything the character says in
 * response to what the child did or could not do — verdicts, hints,
 * explanations, repair prompts when speech was not understood, and the
 * praise at the end of a stop. Onboarding, the map, and the system's own
 * "something broke" belong to lib/guide/lines.ts: they are not judgements
 * of the child's work.
 *
 * THE TWO RULES
 *
 * 1. Praise the strategy, never the person. "ראיתי שספרת הלאה מה-4"
 *    tells a child what worked and can be repeated. "את/ה חכם/ה" tells
 *    them what they ARE, which is not repeatable and which a wrong answer
 *    then contradicts — the child concludes the opposite about themselves.
 *    This is the single rule most of this file exists to enforce.
 *
 * 2. A wrong answer opens an invitation, never a verdict on the child.
 *    "כמעט — בוא נסתכל ביחד" moves toward the work together. "טעית שוב"
 *    counts failures at them, and "עוד פעם?" adds an exasperated adult.
 *
 * And one allowance: the character may occasionally say the work was hard
 * for it too. A child who believes the tutor finds everything easy learns
 * that difficulty is a fact about them. Occasionally is the point — said
 * every time it is a tic, so shouldModelEffort() rations it.
 *
 * Gender follows lib/guide/lines.ts's convention: address the child in
 * their own gender when it is known, plural when it is not. The brief's
 * lines are given in the masculine; the other two forms are written out
 * here rather than misgendering a girl or inventing a neutral.
 *
 * No runtime imports on purpose — lib/exercises/openers.ts is imported by
 * the browser bundle and must not pull the Anthropic SDK in behind it.
 */

// ---------------------------------------------------------------- rules

export interface ConstitutionViolation {
  /** The matched text, for the warning line. */
  match: string;
  /** Which rule it broke, in words a person can act on. */
  rule: string;
}

interface ForbiddenShape {
  pattern: RegExp;
  rule: string;
}

/**
 * Hebrew word boundaries. `\\b` is defined against [A-Za-z0-9_], so against
 * Hebrew it never matches and every pattern below would be silently inert
 * — the guard would pass everything and nobody would know. Same convention
 * as lib/exercises/topic-fit.ts, which hit this first.
 */
const L = "(?<![\u05d0-\u05ea])";
const R = "(?![\u05d0-\u05ea])";

/** Praise adjectives that describe the CHILD rather than what they did. */
const PERSON_ATTRIBUTES = [
  "חכם", "חכמה", "חכמים", "חכמות",
  "גאון", "גאונית", "גאונים", "גאוניות", "גאוני",
  "מבריק", "מבריקה", "מבריקים", "מבריקות",
  "כישרוני", "כישרונית", "כישרוניים",
  "מוכשר", "מוכשרת", "מוכשרים", "מוכשרות",
  "פיקח", "פיקחית", "פיקחים",
].join("|");

/**
 * The shapes that may never reach a child. Written as patterns rather
 * than exact strings so a near-miss ("את כל כך חכמה", "איזה גאון אתה")
 * is caught too — an exact-string blocklist is a rule the next paraphrase
 * walks straight through.
 */
export const FORBIDDEN: readonly ForbiddenShape[] = [
  {
    // "אתה חכם", "את כל כך חכמה", "אתם גאונים"
    pattern: new RegExp(`${L}(?:אתה|את|אתם|אתן)\\s+(?:כל[\\s-]*כך\\s+|ממש\\s+|כזה\\s+|כזו\\s+)?(?:${PERSON_ATTRIBUTES})${R}`),
    rule: "praises the child as a person; praise the strategy they used instead",
  },
  {
    // "איזה גאון", "איזו חכמה" — the same praise with the pronoun dropped
    pattern: new RegExp(`${L}(?:איזה|איזו)\\s+(?:${PERSON_ATTRIBUTES})${R}`),
    rule: "praises the child as a person; praise the strategy they used instead",
  },
  {
    // The bare attribute aimed at the child with a possessive
    pattern: new RegExp(`${L}(?:${PERSON_ATTRIBUTES})\\s+(?:שכמותך|שלי)${R}`),
    rule: "praises the child as a person; praise the strategy they used instead",
  },
  {
    pattern: new RegExp(`${L}טעית\\s+שוב${R}`),
    rule: "counts the child's failures back at them; invite them to look again instead",
  },
  {
    pattern: new RegExp(`${L}עוד\\s+פעם\\s*\\?`),
    rule: "reads as an exasperated adult; invite them to look again instead",
  },
];

/**
 * Does this line break the constitution? Returns the first violation, or
 * null. Runs on model output before a child hears it, and on every string
 * this module owns, in the test suite.
 */
export function violatesConstitution(text: string): ConstitutionViolation | null {
  for (const { pattern, rule } of FORBIDDEN) {
    const m = pattern.exec(text);
    if (m) return { match: m[0], rule };
  }
  return null;
}

/** Convenience for assertions and guards that only need a boolean. */
export function obeysConstitution(text: string): boolean {
  return violatesConstitution(text) === null;
}

// ------------------------------------------------------------- gendered

/** lib/guide/lines.ts's convention, repeated here so this module keeps no
 *  runtime imports. */
function directed(g: KidGender | null | undefined, boy: string, girl: string, neutral: string): string {
  return g === "boy" ? boy : g === "girl" ? girl : neutral;
}

// -------------------------------------------------------- owned strings

/**
 * The deterministic openers, said the instant the verdict locks.
 *
 * They are fixed strings so they can be prefetched — that is what makes
 * the character audible at verdict-lock instead of a TTS round trip
 * later — and they carry no arithmetic and no answer, which is why they
 * are exempt from the arithmetic gate. That exemption belongs to these
 * three written-in-code lines and to nothing a model produces.
 *
 * `hint` is the constitution's neutral invitation: it names the near-miss
 * and moves toward the work, rather than commenting on the child.
 */
export const OPENERS = {
  correct: "כל הכבוד!",
  hint: "כמעט!",
  explain: "זה בסדר, זו שאלה לא פשוטה!",
} as const;

export type OpenerKind = keyof typeof OPENERS;

/** The clause that follows each opener, so opener + rest reads as one
 *  sentence. */
export const REST_CORRECT = "זה בדיוק נכון.";

/** The neutral invitation, in full. The brief's line, in the child's own
 *  gender. */
export function neutralInvitation(gender?: KidGender | null): string {
  return directed(gender, "בוא נסתכל ביחד.", "בואי נסתכל ביחד.", "בואו נסתכל ביחד.");
}

/** What follows the `hint` opener on a first wrong answer. */
export function restHint(gender?: KidGender | null): string {
  return `${neutralInvitation(gender)} אפשר לנסות שוב, לאט ובשלבים.`;
}

/** What follows the `explain` opener once the hint has already missed.
 *  The number itself is composed by the caller from the verified answer —
 *  this module never does arithmetic. */
export function restExplanation(formattedAnswer: string): string {
  return `התשובה הנכונה היא ${formattedAnswer}.`;
}

/**
 * The character admitting the work was hard for it too. Rationed by
 * shouldModelEffort() — said every time, it stops being true.
 */
export function effortModeling(gender?: KidGender | null): string {
  void gender; // the line speaks about the character, not the child
  return "זה היה קשה גם לי.";
}

/**
 * Should the character model effort on THIS exercise? Deterministic, not
 * random: keyed on the exercise id so the same exercise behaves the same
 * way twice, which is what makes it testable and what stops it firing
 * twice in one breath. Roughly one moment in three, and only where it is
 * true — after a hint has already missed.
 */
export function shouldModelEffort(opts: { exerciseId: string; secondAttempt: boolean; correct: boolean }): boolean {
  if (opts.correct || !opts.secondAttempt) return false;
  let h = 0;
  for (let i = 0; i < opts.exerciseId.length; i++) h = (h * 31 + opts.exerciseId.charCodeAt(i)) >>> 0;
  return h % 3 === 0;
}

// ------------------------------------------------------- repair prompts

/** Speech was not understood. Names no fault and always leaves tapping
 *  open — a child who cannot be heard must never be stuck. */
export const NOT_HEARD = "לא שמעתי טוב. אפשר לומר שוב, או ללחוץ על תשובה.";

/** The OS refused the microphone. Distinct from NOT_HEARD because "say it
 *  again" is useless advice when nothing can be heard at all. */
export const MIC_BLOCKED = "אין גישה למיקרופון. אפשר ללחוץ על תשובה בעצם.";

// --------------------------------------------------------- celebrations

export const TOPIC_COMPLETE = "סיימנו תחנה! התחנה הבאה במפה נפתחה.";

export const SESSION_COMPLETE =
  "איזו עבודה מצוינת היום — רבע שעה שלמה! אפשר לעצור כאן, או להמשיך עוד קצת.";

/**
 * The end-of-stop summary. Praises the work done, never the child, and
 * states the score plainly without a judgement attached to it.
 */
export function topicSummary(opts: { attempted: number; correct: number; topicLabel?: string }): string {
  const where = opts.topicLabel ? ` בנושא ${opts.topicLabel}` : "";
  return `כל הכבוד! סיימת את כל ${opts.attempted} התרגילים${where}. ענית נכון על ${opts.correct} מתוך ${opts.attempted}.`;
}

// ------------------------------------------------------- the model's brief

/**
 * The constitution as an instruction, for the one feedback path a model
 * writes. Embedded verbatim in the feedback prompt so the rules the tests
 * enforce and the rules the model is given cannot drift apart.
 *
 * The output is checked against FORBIDDEN afterwards regardless — this
 * makes a violation unlikely, the check makes it harmless.
 */
export const MODEL_RULES = `## איך מדברים אל התלמיד/ה
- משבחים את מה שהתלמיד/ה עשה/עשתה, לא את מי שהוא/היא. למשל "ראיתי שספרת הלאה מה-4" או "הדרך שבחרת עבדה" — ולא "את/ה חכם/ה", "איזה גאון", או כל שבח על תכונה.
- על תשובה לא נכונה: הזמנה להסתכל ביחד, בלי לספור כישלונות. אסור "טעית שוב", אסור "עוד פעם?".
- בלי אכזבה, בלי הפתעה שהתלמיד/ה הצליח/ה.`;

/** The one-line example of praise that names a strategy, used in the
 *  prompt and asserted in the tests so the two stay in step. */
export const STRATEGY_PRAISE_EXAMPLE = "ראיתי שספרת הלאה מה-4";
