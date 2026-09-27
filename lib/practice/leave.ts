/**
 * Does leaving the exercise screen need the "לצאת מהתרגיל? התרגיל הנוכחי
 * לא יישמר." confirm step?
 *
 * Only when something would actually be lost: an exercise on screen that is
 * not finished — unanswered, being checked, or waiting for its second try.
 * Not when it is finished (answered correctly, or the final miss — the
 * answer is recorded and the next step is a new exercise), and not when
 * there is no exercise at all (loading, a failed load, an empty topic).
 * QA 2026-09-26: the dialog said "won't be saved" after a completed
 * exercise.
 */
export interface LeaveState {
  hasExercise: boolean;
  loading: boolean;
  /** The verdict shown for this exercise, if any. */
  evaluation: { correct: boolean } | null;
  /** 1 on a fresh question, 2 on the retry. */
  attempt: 1 | 2;
}

export function exerciseFinished(s: Pick<LeaveState, "evaluation" | "attempt">): boolean {
  return !!s.evaluation && (s.evaluation.correct || s.attempt === 2);
}

export function leaveNeedsConfirm(s: LeaveState): boolean {
  if (!s.hasExercise || s.loading) return false;
  return !exerciseFinished(s);
}
