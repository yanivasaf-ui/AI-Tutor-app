import { allowedFormats, isServedTopic } from "@/lib/map/topic-formats";
import type { MapTopic } from "@/lib/map/topics";
import type { ExerciseSubtype } from "./types";

/**
 * Which formats the bank seed (scripts/seed-exercise-bank.ts) cycles through
 * for a topic. Lives here, not in the script, so a test can check it for
 * every topic without running the script.
 *
 * BUG B: the 2026-09-14 seed cycled EVERY bankable format through EVERY
 * topic — deliberately, "so every topic banks SOMETHING quickly" — which is
 * how the bank came to hold sequences under shapes and length, division
 * under numbers and volume, root drills under reading. Now the pool is the
 * bankable formats the topic's allowed-format table permits, and an
 * unserved topic gets none.
 *
 * Bankable = has a structured spec bank-guard.ts can verify (explain_thinking
 * and shape_match do not, so they are live-generation only). The order is
 * the old "most topic-agnostic first" order, kept for throughput.
 */
export const MATH_BANKABLE: readonly ExerciseSubtype[] = ["pick_operation", "visual_grouping", "number_line_placement", "fill_in_blank", "pattern_completion", "equation_balance"];
export const HEBREW_BANKABLE: readonly ExerciseSubtype[] = ["comprehension", "spelling_correction_mc", "root_pattern_mc", "word_build", "sentence_order", "vowel_select_mc", "phonemic_visual_mc"];

export function seedPool(topic: Pick<MapTopic, "id" | "subject">): ExerciseSubtype[] {
  if (!isServedTopic(topic.id)) return [];
  const allowed = allowedFormats(topic.id);
  return (topic.subject === "math" ? MATH_BANKABLE : HEBREW_BANKABLE).filter((s) => allowed.includes(s));
}
