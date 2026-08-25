import { Subject } from "../memory/types";

export type ExerciseType = "open" | "multiple_choice";
export type Grade = "א" | "ב" | "ג";

/**
 * The semantic exercise pattern from the locked inventory
 * (project-brief.md Section 2d-3), distinct from `ExerciseType` (which is
 * just the render/interaction shape). Several subtypes share the same
 * `type` — e.g. "explain_thinking" and "fill_in_blank" both render as
 * "open" but need different generation and evaluation behavior.
 *
 * Only the Tier 1 subtypes from output/exercise-types-build-brief.md are
 * listed here (near-free — no new interaction shape needed). Tiers 2/3
 * (drag primitives, equation balancing, etc.) add new ExerciseTypes, not
 * just new subtypes, when they're built.
 */
export type ExerciseSubtype =
  | "fill_in_blank" // math — baseline computation, renders as "open"
  | "pick_operation" // math — word problem, choose the operation, renders as "multiple_choice"
  | "explain_thinking" // math — qualitative reasoning, renders as "open", no single right answer
  | "comprehension" // hebrew — short passage + closed question
  | "spelling_correction_mc" // hebrew — choose the correctly-spelled option
  | "root_pattern_mc"; // hebrew — which word comes from a given root (שורש), likely ב'-ג' only

export interface Exercise {
  id: string;
  subject: Subject;
  grade: Grade;
  type: ExerciseType;
  /** The semantic pattern this exercise follows — see ExerciseSubtype.
   *  Optional so exercises generated before this field existed still
   *  parse; new generations always set it. */
  subtype?: ExerciseSubtype;
  /** Which curriculum topic (from lib/rag) this exercise is grounded in —
   *  this is what makes the outcome a clean, structured signal instead of
   *  a fuzzy inference from a chat transcript. */
  topic: string;
  /** Present only for subtype === "comprehension" — a short passage shown
   *  above the question. */
  passage?: string;
  question: string;
  /** Present only when type === "multiple_choice". */
  choices?: string[];
  correctAnswer: string;
}

export interface ExerciseEvaluation {
  correct: boolean;
  /** What the tutor says back to the kid — process-praise if right,
   *  validate-then-hint (never the answer) if wrong, per the locked
   *  pedagogy in lib/prompts/tutor-system-prompt.ts. */
  feedback: string;
  /** Short, structured description of *what kind* of mistake, only when
   *  wrong — this is the clean signal for SubjectProfile.errorPatterns
   *  that a free-form chat transcript can't reliably produce. */
  errorNote?: string;
}
