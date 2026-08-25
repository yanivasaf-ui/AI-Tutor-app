import { Subject } from "../memory/types";

/**
 * A real message that tripped the "gentle redirect + flag to parent"
 * off-curriculum/emotional detector (lib/prompts/tutor-system-prompt.ts,
 * looksOffCurriculumOrEmotional). Until this table existed, a flagged
 * message was only console.logged — the "flag to parent" half of that
 * locked decision was never actually built. This is what closes it.
 */
export interface ParentFlag {
  id: string;
  kidId: string;
  subject: Subject | null;
  grade: string | null;
  message: string;
  createdAt: string;
}

/** One real exercise attempt, enriched with the exercise's question/topic
 *  for display — a parent reading "5 + ___ = 12, correct" needs the
 *  question text, not just a correct/incorrect boolean. */
export interface RecentAttempt {
  id: string;
  subject: Subject;
  question: string;
  topic: string;
  correct: boolean;
  createdAt: string;
}

/** Per-subject accuracy, computed from the full exercise_attempts history
 *  (not just the recent-activity slice) — the real "how is my kid doing"
 *  number a parent actually wants, not just skimmed from a short list. */
export interface SubjectStats {
  subject: Subject;
  totalAttempts: number;
  correctAttempts: number;
}
