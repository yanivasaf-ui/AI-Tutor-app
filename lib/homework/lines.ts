/**
 * Hebrew copy for the homework prototype.
 *
 * SEPARATE FROM lib/guide/lines.ts on purpose: this is a flag-gated spike
 * that may well be deleted, and its wording has not been through Udi. Its
 * own file keeps that reviewable in one place and keeps the shipped
 * guide's copy untouched.
 *
 * UDI REVIEW — every line in this file is new copy written for a
 * prototype, not reviewed, and the flag is off by default. Two things to
 * look at in particular:
 *   - "בוא" forms are masculine. The prototype has no gender for the
 *     child (no account linkage, by the brief), so these are plural where
 *     a direct address would otherwise have to guess.
 *   - the decline lines have to be clear to a PARENT, who is the one
 *     typing, while the rest of the screen speaks to a child.
 *
 * The spirit is the same as the feedback constitution on the
 * experience-phase-1 branch: praise what was done, never who the child is,
 * and a wrong turn opens an invitation rather than a verdict. That module
 * does not exist on this branch, so nothing is imported from it; if both
 * land, these lines should move under it.
 */

export const HOMEWORK_TITLE = "עזרה בשיעורי בית";
export const HOMEWORK_SUBTITLE = "כתבו כאן תרגיל בחשבון, ונעבור עליו יחד — צעד אחר צעד.";
export const INPUT_LABEL = "התרגיל";
export const INPUT_PLACEHOLDER = "למשל: 24 + 37";
export const START = "מתחילים";
export const RESTART = "תרגיל אחר";
export const CHECK = "בדיקה";
export const ANSWER_LABEL = "התשובה שלי";

/** The character never solves it. Said to the parent, plainly. */
export const DECLINE_ASKING_FOR_ANSWER =
  "כאן לא פותרים במקום הילד/ה — עוברים על התרגיל יחד, שלב אחר שלב. אפשר לכתוב את התרגיל עצמו, למשל 24 + 37.";

export const DECLINE_NOT_MATH =
  "בינתיים אני יודע לעזור רק בתרגילי חשבון. אפשר לכתוב תרגיל, למשל 24 + 37.";

export const DECLINE_UNSUPPORTED =
  "את התרגיל הזה אני עוד לא יודע לפרק לשלבים. אפשר לנסות תרגיל חיבור, חיסור, כפל או חילוק בלי שארית.";

/** Opening line once a problem is accepted. */
export function opening(canonical: string): string {
  return `יופי, ${canonical}. לא נמהר לתשובה — נלך שלב אחר שלב.`;
}

/** A step's question. The character asks; the child answers. */
export function askStep(expression: string): string {
  return `כמה זה ${expression}?`;
}

/** The last step, where the child produces the final answer. */
export function askFinal(canonical: string): string {
  return `ועכשיו הכול יחד: כמה זה ${canonical}?`;
}

/** A wrong turn. No verdict on the child, and never the number. */
export const WRONG_INVITATIONS = [
  "כמעט — בואו נסתכל על זה יחד עוד פעם.",
  "לא נורא, זה קורה. בואו ננסה דרך אחרת.",
];

/** A strategy question, chosen by operator — asks HOW, never what. */
export const STRATEGY_QUESTIONS: Record<string, string> = {
  "+": "מאיזה מספר נוח לכם להתחיל, ואיך אפשר להוסיף בשלבים?",
  "-": "מה אפשר להוריד קודם כדי להגיע למספר עגול?",
  "*": "אפשר לחשוב על זה כחיבור חוזר — כמה פעמים, ושל מה?",
  "/": "לכמה קבוצות שוות מחלקים, וכמה יש בכל אחת?",
};

/** After a step is solved by the child. Confirms the step, not the goal. */
export function stepConfirmed(expression: string, value: number): string {
  return `בדיוק, ${expression} זה ${value}.`;
}

/** Only ever said after the child produced the final answer themselves. */
export function solved(canonical: string, value: number): string {
  return `זהו, פתרתם את זה — ${canonical} זה ${value}. הגעתם לזה בעצמכם, שלב אחר שלב.`;
}

/** A reminder of what is already known, when the last step is hard. It
 *  repeats the child's OWN confirmed results and never adds the goal. */
export function recall(parts: string[]): string {
  return `מה שכבר מצאתם: ${parts.join(", ")}. מה זה נותן יחד?`;
}
