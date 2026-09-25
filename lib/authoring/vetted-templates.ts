import type { Exercise } from "@/lib/exercises/types";
import type { CorpusProvenance } from "./rubric";

/**
 * The quality gate's last resort: when every generated draft for a topic
 * failed the authoring rubric, the child gets one of these instead of a
 * "משהו השתבש" screen — never a draft that failed.
 *
 * A template here is a question that has already been checked, not a
 * pattern for a model to fill in. Each one carries its own verified answer
 * (a computation code evaluates, where there is arithmetic) and the
 * provenance of the wording. The test suite runs every template through
 * the same gate as a generated draft.
 *
 * Served through the bank (lib/exercises/store.ts findOrSaveExercise), so
 * an attempt at one is recorded like any other exercise.
 */
export interface VettedTemplate {
  topicId: string;
  exercise: Omit<Exercise, "id">;
  /** Where the wording comes from. */
  provenance: CorpusProvenance;
}

export const VETTED_TEMPLATES: readonly VettedTemplate[] = [];

/** One vetted template for this topic, or null when it has none. */
export function vettedTemplate(topicId: string | undefined, pick: () => number = Math.random): Omit<Exercise, "id"> | null {
  if (!topicId) return null;
  const pool = VETTED_TEMPLATES.filter((t) => t.topicId === topicId);
  if (pool.length === 0) return null;
  return pool[Math.floor(pick() * pool.length)].exercise;
}
