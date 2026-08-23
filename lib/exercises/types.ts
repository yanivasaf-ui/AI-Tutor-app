import { Subject } from "../memory/types";

export type ExerciseType = "open" | "multiple_choice";
export type Grade = "א" | "ב" | "ג";

export interface Exercise {
  id: string;
  subject: Subject;
  grade: Grade;
  type: ExerciseType;
  /** Which curriculum topic (from lib/rag) this exercise is grounded in —
   *  this is what makes the outcome a clean, structured signal instead of
   *  a fuzzy inference from a chat transcript. */
  topic: string;
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
