import { getTopics, getTopicById } from "@/lib/map/topics";
import {
  HOW_DID_YOU_KNOW,
  IMPROVEMENT,
  namesAStrategy,
  sessionClose,
  sessionGoal,
} from "@/lib/feedback/constitution";

/**
 * The shape of a session: one idea, opened, worked, and closed.
 *
 * Three beats, in order, and each is allowed to happen once:
 *
 *   goal    at the start, one line saying what today is about
 *   ask     at most once, "איך ידעת?" — only after the character has just
 *           named a strategy the child used
 *   close   at the end, what changed, and where the path goes next
 *
 * Everything here is derived from what already happened in the session.
 * Nothing is persisted, nothing is scored, and the closing beat describes
 * change rather than a mark out of four — see the constitution's note on
 * why.
 *
 * WHAT THIS DOES NOT DO: it does not decide when a station is finished.
 * Station completion currently fires on the first correct answer
 * (ExerciseScreen's `topicMoment`), which is NOT the "one idea, 3-4
 * problems" arc the brief describes. That gap is reported rather than
 * silently changed here, because moving it changes how fast every child
 * progresses through the map.
 */

export interface SessionObservations {
  /** Distinct problems the child has been asked in this session. */
  attempted: number;
  /** ...of which answered correctly. */
  correct: number;
  /** Problems answered right on the FIRST attempt, in order asked. */
  firstAttemptByProblem: boolean[];
  /** Hint rungs opened per problem, in order asked. */
  hintsByProblem: number[];
}

export const NO_OBSERVATIONS: SessionObservations = {
  attempted: 0,
  correct: 0,
  firstAttemptByProblem: [],
  hintsByProblem: [],
};

export interface ArcState {
  goalSpoken: boolean;
  /** "איך ידעת?" is a once-per-session question. */
  howDidYouKnowAsked: boolean;
  closed: boolean;
}

export const ARC_START: ArcState = { goalSpoken: false, howDidYouKnowAsked: false, closed: false };

// ------------------------------------------------------------------ goal

/**
 * What today is about, in the child's own words for the topic.
 *
 * KNOWN LIMITATION, stated rather than papered over: the brief's example
 * ("היום אנחנו לומדים לחבר עם פריקה לעשרות") names a STRATEGY, and no
 * such field exists — lib/map/topics.ts carries a curriculum title and a
 * kid-facing topic name, nothing finer. So the goal line names the topic,
 * which is true and useful, and a per-idea strategy line would need
 * curriculum authoring that does not exist yet.
 */
export function goalLine(topicId: string | undefined): string | null {
  if (!topicId) return null; // free practice has no single idea for the day
  const topic = getTopicById(topicId);
  if (!topic) return null;
  return sessionGoal(topic.displayNameKid || topic.topic);
}

export function openSession(state: ArcState, topicId: string | undefined): { say: string | null; state: ArcState } {
  if (state.goalSpoken) return { say: null, state };
  const say = goalLine(topicId);
  return { say, state: { ...state, goalSpoken: true } };
}

// ------------------------------------------------------------- "how did you know?"

/**
 * May the character ask it, right now?
 *
 * Three conditions, all required: the child just got it right without
 * needing the retry, the character's own line just named what they did,
 * and it has not been asked yet this session.
 */
export function shouldAskHowDidYouKnow(
  state: ArcState,
  opts: { correct: boolean; attempt: 1 | 2; spokenLine: string }
): boolean {
  if (state.howDidYouKnowAsked) return false;
  if (!opts.correct || opts.attempt !== 1) return false;
  return namesAStrategy(opts.spokenLine);
}

export function askHowDidYouKnow(state: ArcState): { say: string; state: ArcState } {
  return { say: HOW_DID_YOU_KNOW, state: { ...state, howDidYouKnowAsked: true } };
}

// ----------------------------------------------------------------- close

/**
 * What the character noticed, picked from what actually happened.
 *
 * Ordered most specific first, so the most recognisable true thing wins.
 * `steady` is the floor: it says only that the work was finished together,
 * which is true on every session including the ones that went badly.
 */
export function improvementSeen(o: SessionObservations): string {
  const firsts = o.firstAttemptByProblem;
  const hints = o.hintsByProblem;

  if (firsts.length >= 2) {
    const half = Math.floor(firsts.length / 2);
    const early = firsts.slice(0, half);
    const late = firsts.slice(half);
    const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
    if (rate(late) > rate(early)) return IMPROVEMENT.fasterByTheEnd;
  }

  if (hints.length >= 2) {
    const half = Math.floor(hints.length / 2);
    const early = hints.slice(0, half);
    const late = hints.slice(half);
    const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    if (total(early) > 0 && total(late) < total(early)) return IMPROVEMENT.neededFewerHints;
  }

  // Missed at least one and still finished with a correct answer.
  if (firsts.some((f) => !f) && o.correct > 0) return IMPROVEMENT.recoveredAfterAMiss;

  return IMPROVEMENT.steady;
}

/** The next stop on the map after this one, in the child's words. */
export function nextStationName(subject: "math" | "hebrew", grade: "א" | "ב" | "ג", topicId: string | undefined): string | null {
  if (!topicId) return null;
  const topics = getTopics(subject, grade);
  const i = topics.findIndex((t) => t.id === topicId);
  if (i < 0 || i + 1 >= topics.length) return null; // last stop: nothing to promise
  const next = topics[i + 1];
  return next.displayNameKid || next.topic;
}

export function closeSession(
  state: ArcState,
  o: SessionObservations,
  where: { subject: "math" | "hebrew"; grade: "א" | "ב" | "ג"; topicId: string | undefined }
): { say: string; state: ArcState } {
  return {
    say: sessionClose(improvementSeen(o), nextStationName(where.subject, where.grade, where.topicId)),
    state: { ...state, closed: true },
  };
}
