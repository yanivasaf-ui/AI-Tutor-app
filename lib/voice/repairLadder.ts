import { askAgain, confirmHeard, TAP_OFFER } from "@/lib/feedback/constitution";
import type { KidGender } from "@/lib/memory/types";

/**
 * Two repairs, then a way through that does not need to be heard.
 *
 * A child answering by voice who is not understood used to get the same
 * line every time, for as many tries as they had patience for. That is the
 * worst shape this failure can take: the child has no idea what to change,
 * and the only signal they get is that it keeps not working — which reads
 * as "I am failing", not "the microphone is failing".
 *
 * So the ladder is bounded and always terminates in a door:
 *
 *   attempt 1, something plausible heard -> confirm it ("התכוונת ל-12?")
 *   attempt 1, nothing plausible heard   -> ask once more, plainly
 *   attempt 2 (either way)               -> offer the tap, explicitly
 *
 * There is never a third identical try, and never silence: every state
 * this returns carries something for the character to say.
 *
 * WHAT IT IS NOT. Nothing here is a judgement about arithmetic. A repair
 * is a recogniser problem, and the ladder sits entirely BEFORE an answer
 * is locked — it never records an attempt, never touches mastery state and
 * never reaches the verdict. The one exception is deliberate and is the
 * child's own doing: confirming "כן" submits that answer as theirs, which
 * is an answer they gave, not one the tutor guessed for them.
 */

export type RepairStage =
  /** Nothing wrong; the child is answering normally. */
  | { kind: "idle" }
  /** "התכוונת ל-12?" — awaiting כן / לא, by voice or by tap. */
  | { kind: "confirming"; candidate: string; say: string }
  /** "לא שמעתי, תגיד שוב?" — one more try, no candidate to offer. */
  | { kind: "retrying"; say: string }
  /** The door. Tapping is offered explicitly and the ladder is spent. */
  | { kind: "tap-offer"; say: string };

export interface RepairState {
  stage: RepairStage;
  /** How many unclear voice results this exercise has seen. Reset per
   *  exercise, never persisted, never part of the 1|2 answer attempt
   *  counter that drives the verdict. */
  unclearCount: number;
}

export const IDLE: RepairState = { stage: { kind: "idle" }, unclearCount: 0 };

/** Why an attempt ended up here, for the [stt-repair] log line. */
export type RepairReason = "no-match" | "ambiguous" | "out-of-range";

export interface UnclearInput {
  /** Best-first, and only ever real answers to this exercise. */
  candidates: readonly string[];
  reason: RepairReason;
  gender?: KidGender | null;
}

/**
 * A voice result the matcher could not turn into an answer. Returns the
 * next state; the caller says `stage.say` and renders any affordance.
 */
export function onUnclear(state: RepairState, input: UnclearInput): RepairState {
  const unclearCount = state.unclearCount + 1;

  // Second unclear attempt, whatever happened on the first: stop asking to
  // be heard and open the door. Also covers a child who said something
  // unclear again while a confirmation was on screen.
  if (unclearCount >= 2) {
    return { stage: { kind: "tap-offer", say: TAP_OFFER }, unclearCount };
  }

  const candidate = input.candidates[0];
  if (candidate !== undefined && candidate !== "") {
    return { stage: { kind: "confirming", candidate, say: confirmHeard(candidate) }, unclearCount };
  }
  return { stage: { kind: "retrying", say: askAgain(input.gender) }, unclearCount };
}

/** What a yes/no answer to the confirmation means. */
export type ConfirmOutcome =
  /** Submit this as the child's own answer — they confirmed it. */
  | { action: "submit"; value: string; state: RepairState }
  /** Offer the tap. Reached by "לא", because a second guess at the same
   *  misheard word helps nobody. */
  | { action: "offer-tap"; state: RepairState }
  /** Nothing was being confirmed; the caller should ignore this. */
  | { action: "ignore"; state: RepairState };

export function onConfirmation(state: RepairState, answer: "yes" | "no"): ConfirmOutcome {
  if (state.stage.kind !== "confirming") return { action: "ignore", state };
  if (answer === "yes") {
    return { action: "submit", value: state.stage.candidate, state: IDLE };
  }
  return {
    action: "offer-tap",
    state: { stage: { kind: "tap-offer", say: TAP_OFFER }, unclearCount: Math.max(state.unclearCount, 2) },
  };
}

/** A clear answer arrived, or a new exercise did: the ladder resets. */
export function reset(): RepairState {
  return IDLE;
}

/** Is the child being asked to confirm right now? Drives the yes/no
 *  buttons and tells the voice handler to read the next result as כן/לא
 *  rather than as an answer. */
export function isConfirming(state: RepairState): boolean {
  return state.stage.kind === "confirming";
}

/** Has the ladder run out? The tap affordance stays visible from here on,
 *  and no further voice attempt may re-open it for this exercise. */
export function isSpent(state: RepairState): boolean {
  return state.stage.kind === "tap-offer";
}

// ---- logging ------------------------------------------------------------

export interface RepairLogEntry {
  exerciseId: string;
  reason: RepairReason;
  unclearCount: number;
  /** What the ladder did about it. */
  outcome: "confirm" | "retry" | "tap-offer" | "confirmed-submit" | "rejected";
  /** Present only when a candidate was offered or confirmed. */
  candidate?: string;
}

/**
 * A repair is NOT a maths error, and this is the line that keeps the two
 * apart. `exercise_attempts` has no column for it, and the brief is
 * explicit that a schema change must not block this — so a repair is
 * recorded here, structured, and never written to the attempt row that
 * feeds mastery and verdict statistics.
 *
 * Carries no transcript and no answer text beyond the candidate the system
 * itself proposed: a child's voice is not logged.
 */
export function formatRepairLog(e: RepairLogEntry): string {
  const parts = [
    `exercise=${e.exerciseId}`,
    `reason=${e.reason}`,
    `unclear=${e.unclearCount}`,
    `outcome=${e.outcome}`,
    e.candidate === undefined ? null : `candidate=${JSON.stringify(e.candidate)}`,
  ].filter(Boolean);
  return `[stt-repair] ${parts.join(" ")}`;
}

export function logRepair(e: RepairLogEntry): void {
  try {
    console.log(formatRepairLog(e));
  } catch {
    /* a broken console must never reach a child's answer */
  }
}
