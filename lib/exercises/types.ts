import { Subject } from "../memory/types";

/**
 * "number_line" and "tile_order" are Tier 2 (output/exercise-types-build-brief.md)
 * — the shared tap-to-place interaction primitive. Both use the same
 * interaction model (tap a chip, then tap where it goes) even though their
 * payloads differ, which is what "one shared primitive" means in practice:
 * one component family, not one payload shape. drag_group (visual
 * counting/grouping) is the 5th type the brief groups under this tier —
 * deliberately deferred, see PracticeMode.tsx notes, since it's a
 * many-to-few grouping interaction, not a 1:1 ordering one, and didn't fit
 * this primitive cleanly enough to rush into the same pass.
 */
export type ExerciseType = "open" | "multiple_choice" | "number_line" | "tile_order";
export type Grade = "א" | "ב" | "ג";

/**
 * The semantic exercise pattern from the locked inventory
 * (project-brief.md Section 2d-3), distinct from `ExerciseType` (which is
 * just the render/interaction shape). Several subtypes share the same
 * `type` — e.g. "explain_thinking" and "fill_in_blank" both render as
 * "open" but need different generation and evaluation behavior.
 */
export type ExerciseSubtype =
  // Tier 1 — near-free, existing open/multiple_choice shapes
  | "fill_in_blank" // math — baseline computation, renders as "open"
  | "pick_operation" // math — word problem, choose the operation, renders as "multiple_choice"
  | "explain_thinking" // math — qualitative reasoning, renders as "open", no single right answer
  | "comprehension" // hebrew — short passage + closed question
  | "spelling_correction_mc" // hebrew — choose the correctly-spelled option
  | "root_pattern_mc" // hebrew — which word comes from a given root (שורש), likely ב'-ג' only
  // Tier 2 — shared tap-to-place primitive
  | "number_line_placement" // math #1 — renders as "number_line"
  | "pattern_completion" // math #6 — renders as "tile_order", slotCount 1
  | "word_build" // hebrew #7 — renders as "tile_order", letters joined with no separator
  | "sentence_order"; // hebrew #8 — renders as "tile_order", words joined with spaces

/** Payload for type === "number_line". Kid taps one tick on a rendered
 *  line; (max-min)/step+1 is kept small by generation-prompt instruction
 *  (not code-enforced) so the line stays tappable, same trust-the-prompt
 *  pattern already used for "4 choices" on multiple_choice. */
export interface NumberLineData {
  min: number;
  max: number;
  step: number;
}

/** Payload for type === "tile_order". `items` are the shuffled chips shown
 *  to the kid; `slotCount` is how many get placed (usually items.length —
 *  less for pattern_completion, where extra items are unused distractors).
 *  `joinWith` tells PracticeMode how to serialize the kid's placed tiles
 *  into the plain-text answer string the existing evaluator already
 *  expects, so no new evaluation plumbing is needed for the happy path. */
export interface TileOrderData {
  items: string[];
  slotCount: number;
  joinWith: "" | " ";
}

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
  /** Present only when type === "number_line". */
  numberLine?: NumberLineData;
  /** Present only when type === "tile_order". */
  tiles?: TileOrderData;
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
