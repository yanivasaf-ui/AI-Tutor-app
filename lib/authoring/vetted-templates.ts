import type { Exercise, Grade } from "@/lib/exercises/types";
import { computeAnswer, formatAnswer, type Computation } from "@/lib/exercises/arithmetic";
import { getTopicById } from "@/lib/map/topics";
import type { CorpusProvenance } from "./rubric";
import corpusSlots from "./corpus-slots.json";

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
 *
 * The templates are Ministry questions, verbatim (niqqud included), picked
 * by hand in scripts/build-corpus-index.ts TEMPLATE_PICKS and built into
 * corpus-slots.json with their provenance. The answer is computed here from
 * the computation, never stored as a model's claim. No subtype: they are
 * word problems graded in code by their computation, and none of the
 * generated subtypes' shapes (a stated "כמה זה 5 + 3?") applies.
 *
 * Coverage, 2026-09-25: math-b-arithmetic (4), math-g-arithmetic (1),
 * math-g-multiplication-division (2). Every other topic has none — the
 * corpus offered no clean, self-contained question for it — and falls
 * through to the route's error, as before this gate existed.
 */
export interface VettedTemplate {
  topicId: string;
  exercise: Omit<Exercise, "id">;
  /** Where the wording comes from. */
  provenance: CorpusProvenance;
}

interface BuiltTemplate {
  topicId: string;
  question: string;
  computation: Computation;
  difficulty: 1 | 2 | 3;
  provenance: CorpusProvenance;
}

function toTemplate(b: BuiltTemplate): VettedTemplate {
  const topic = getTopicById(b.topicId);
  const answer = computeAnswer(b.computation);
  if (!topic || answer === null) throw new Error(`vetted template for ${b.topicId} is not usable: ${b.question}`);
  return {
    topicId: b.topicId,
    provenance: b.provenance,
    exercise: {
      subject: "math",
      grade: topic.grade as Grade,
      type: "open",
      topic: topic.topic,
      topicId: topic.id,
      question: b.question,
      correctAnswer: formatAnswer(answer),
      computation: b.computation,
      difficulty: b.difficulty,
    },
  };
}

export const VETTED_TEMPLATES: readonly VettedTemplate[] = (corpusSlots.templates as unknown as BuiltTemplate[]).map(toTemplate);

/** One vetted template for this topic, or null when it has none. */
export function vettedTemplate(topicId: string | undefined, pick: () => number = Math.random): Omit<Exercise, "id"> | null {
  if (!topicId) return null;
  const pool = VETTED_TEMPLATES.filter((t) => t.topicId === topicId);
  if (pool.length === 0) return null;
  return pool[Math.floor(pick() * pool.length)].exercise;
}
