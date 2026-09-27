import { allowedFormats, hasCondition, isServedTopic } from "@/lib/map/topic-formats";
import { operationsUsed } from "./operation-scope";
import { exerciseText } from "./topic-fit";
import type { Exercise, ExerciseSubtype } from "./types";

/**
 * Does this exercise's FORMAT belong to its topic? The structural check of
 * the allowed-format table (lib/map/topic-formats.ts) — it reads the
 * exercise's format, never its wording, so a +3 sequence dressed in triangle
 * words is still a sequence, and sequences do not belong to "צורות".
 *
 * Why structure and not wording (BUG B, 2026-09-26): the previous check,
 * topic-fit.ts, asks whether an exercise uses the topic's vocabulary. The
 * grade-ב sweep's leaks all did — the bank was full of arithmetic in topic
 * costume — so every one of them passed.
 *
 * Applied wherever a row is admitted (generation, saveExercise, the seeded-
 * bank insert script) and wherever a row is served (findReusableExercise).
 * No flag lifts it.
 */

export interface FormatFitResult {
  ok: boolean;
  /** False when there was no topic to check against. */
  checked: boolean;
  reason?: string;
}

/**
 * The exercise's format. A row with no subtype but a computation is a
 * computation exercise (the vetted Ministry templates are stored that way);
 * a row with neither has no format to check and is refused.
 */
export function effectiveFormat(ex: Pick<Exercise, "subtype" | "computation">): ExerciseSubtype | undefined {
  return ex.subtype ?? (ex.computation ? "fill_in_blank" : undefined);
}

/**
 * Words and signs that make a question about DOING an operation. Used for
 * the number-line condition (owner G5): in an operations topic, a number
 * line is allowed only when the placement comes from an operation.
 */
export const OPERATION_CUE = new RegExp(
  `\\d\\s*[+\\-−×÷*]\\s*\\d|=|(?<![\\u05d0-\\u05ea])[הובלמשכ]{0,2}(?:עוד|הוסיפ|נוספ|נשאר|נותר|פחות|יותר|ביחד|בסך|קפיצ|קפצ|נתנ|לקח|קיבל|קנה|איבד|חיבור|חיסור|כפל|חילוק|חלק|חיברנ|חיסרנ)`,
  "u"
);

export function involvesOperation(ex: Exercise): boolean {
  return operationsUsed(ex).size > 0 || OPERATION_CUE.test(exerciseText(ex));
}

export function formatFit(ex: Exercise, topicId: string | undefined): FormatFitResult {
  if (!topicId) return { ok: true, checked: false };
  if (!isServedTopic(topicId)) return { ok: false, checked: true, reason: `${topicId} is not a served topic` };
  const format = effectiveFormat(ex);
  if (!format) return { ok: false, checked: true, reason: "the exercise has no format" };
  if (!allowedFormats(topicId).includes(format)) {
    return { ok: false, checked: true, reason: `${format} is not an allowed format for ${topicId} (allowed: ${allowedFormats(topicId).join(", ")})` };
  }
  if (format === "number_line_placement" && hasCondition(topicId, "number-line-needs-operation") && !involvesOperation(ex)) {
    return { ok: false, checked: true, reason: `in ${topicId} a number line must come from an operation; placing a stated number involves none` };
  }
  return { ok: true, checked: true };
}

/** A generated draft whose format does not belong to its topic. */
export class FormatFitError extends Error {
  constructor(reason: string, question: string) {
    super(`${reason}. Question: "${question}"`);
    this.name = "FormatFitError";
  }
}

/** Internal model instruction after a FormatFitError (the only way a
 *  generated draft can miss its format is the number-line condition). */
export const FORMAT_FIT_RETRY_HINT =
  "התרגיל הקודם נדחה: בנושא הזה מיקום על ציר המספרים חייב לנבוע מפעולת חשבון שבשאלה (למשל: \"עמד על 3 וקפץ עוד 4 — איפה הוא עכשיו?\"), לא ממספר שכבר כתוב בה.";
