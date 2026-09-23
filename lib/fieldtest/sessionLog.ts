/**
 * A session, as the field test needs to read it back.
 *
 * Written for docs/investigations/field-test-plan.md, which asks four
 * questions of a session with a six-year-old and a parent in the room:
 *
 *   1. how many repairs happen before a child gives up on voice and taps
 *   2. whether a hint lands without the parent stepping in
 *   3. where a parent decides "it's broken"
 *   4. how the session ends
 *
 * Only (1), (2) and (4) are things software can see. (3) is an
 * observation, and the log's job there is to carry enough timing for a
 * researcher's note to be lined up against what the app was doing —
 * which is why the raw events are exported and not just the summary.
 *
 * NOT ANALYTICS. Nothing here leaves the device: no network, no storage,
 * no identifiers. It holds one session in memory and hands it back as
 * JSON when asked. A child's answers and transcripts are never recorded —
 * only what KIND of thing happened and when, so a transcript cannot be
 * reconstructed from an export.
 */

export type AnswerVia = "tap" | "voice";
export type SessionEnd = "completed" | "left" | "still-open";

export type FieldEvent =
  | { t: number; kind: "session-start"; subject: string; grade: string; topicId: string | null }
  | { t: number; kind: "problem-start"; problem: number; exerciseId: string; subtype: string | null }
  | { t: number; kind: "answer"; problem: number; via: AnswerVia; attempt: 1 | 2; correct: boolean }
  /**
   * Submit -> the moment audio actually began, measured off the same
   * `speaking` flip the app already watches for its "speak-start" leg.
   *
   * Its OWN event, not a field on `answer`: the log is append-only and the
   * two facts become known at different moments — the verdict first, the
   * audio a beat later. Folding them into one row would mean either
   * emitting `answer` twice (double-counting the tap/voice share) or
   * mutating a row after the fact.
   */
  | { t: number; kind: "audible"; problem: number; ms: number }
  | { t: number; kind: "stt-repair"; problem: number; reason: string; outcome: string; unclear: number }
  | { t: number; kind: "hint-rung"; problem: number; rung: string; rungNumber: number }
  | { t: number; kind: "session-end"; reason: SessionEnd; lastProblem: number };

export type EventKind = FieldEvent["kind"];

/** One session's worth. Bounded so a long session cannot grow without
 *  limit; the cap is far above a real 15-minute session. */
export const MAX_EVENTS = 500;

export interface SessionLog {
  add(event: FieldEvent): void;
  events(): readonly FieldEvent[];
  summary(): FieldSummary;
  /** The whole session, ready to hand to a researcher. */
  toJSON(): string;
  reset(): void;
}

// ------------------------------------------------------------- summary

export interface FieldSummary {
  problems: number;
  /**
   * Measure 1. Per problem where the child answered by TAP after at least
   * one failed voice attempt: how many repairs came first. A problem
   * answered by voice, or tapped with no repairs, does not appear — the
   * question is specifically what it costs before a child gives up.
   */
  repairsBeforeTap: number[];
  /** Measure 2, the software half: rungs opened, per problem asked. */
  hintRungsPerProblem: number[];
  /** Answers by modality, and voice as a share of all answers. */
  tapVsVoice: { tap: number; voice: number; voiceShare: number | null };
  /** Time-to-audible across answers that produced speech. */
  timeToAudibleMs: { n: number; median: number | null; max: number | null };
  /** Measure 4: how it ended, and on which problem. */
  ending: { reason: SessionEnd; atProblem: number };
  /** Total repairs, regardless of what followed them. */
  repairs: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function summarize(events: readonly FieldEvent[]): FieldSummary {
  const problems = new Set<number>();
  const repairsByProblem = new Map<number, number>();
  const hintsByProblem = new Map<number, number>();
  const answersByProblem = new Map<number, { via: AnswerVia }[]>();
  const audible: number[] = [];
  let tap = 0;
  let voice = 0;
  let repairs = 0;
  let ending: { reason: SessionEnd; atProblem: number } = { reason: "still-open", atProblem: 0 };
  let lastProblem = 0;

  for (const e of events) {
    switch (e.kind) {
      case "problem-start":
        problems.add(e.problem);
        lastProblem = Math.max(lastProblem, e.problem);
        if (!hintsByProblem.has(e.problem)) hintsByProblem.set(e.problem, 0);
        break;
      case "stt-repair":
        repairs++;
        repairsByProblem.set(e.problem, (repairsByProblem.get(e.problem) ?? 0) + 1);
        break;
      case "hint-rung":
        hintsByProblem.set(e.problem, (hintsByProblem.get(e.problem) ?? 0) + 1);
        break;
      case "answer": {
        const list = answersByProblem.get(e.problem) ?? [];
        list.push({ via: e.via });
        answersByProblem.set(e.problem, list);
        if (e.via === "tap") tap++;
        else voice++;
        break;
      }
      case "audible":
        audible.push(e.ms);
        break;
      case "session-end":
        ending = { reason: e.reason, atProblem: e.lastProblem };
        break;
    }
  }

  // Measure 1: only problems that were TAPPED after a repair count. A tap
  // with no repair before it is just a child who preferred tapping.
  const repairsBeforeTap: number[] = [];
  for (const [problem, answers] of answersByProblem) {
    const n = repairsByProblem.get(problem) ?? 0;
    if (n > 0 && answers.some((a) => a.via === "tap")) repairsBeforeTap.push(n);
  }
  repairsBeforeTap.sort((a, b) => a - b);

  const answered = tap + voice;
  return {
    problems: problems.size,
    repairsBeforeTap,
    hintRungsPerProblem: [...hintsByProblem.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n),
    tapVsVoice: { tap, voice, voiceShare: answered === 0 ? null : voice / answered },
    timeToAudibleMs: { n: audible.length, median: median(audible), max: audible.length ? Math.max(...audible) : null },
    ending: ending.reason === "still-open" ? { reason: "still-open", atProblem: lastProblem } : ending,
    repairs,
  };
}

// ------------------------------------------------------------- recorder

export function createSessionLog(now: () => number = () => Date.now()): SessionLog {
  let events: FieldEvent[] = [];
  return {
    add(event) {
      // The clock is the recorder's, not the caller's: an event whose `t`
      // came from somewhere else cannot be lined up against the others.
      const stamped = { ...event, t: now() } as FieldEvent;
      events.push(stamped);
      if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
    },
    events() {
      return events;
    },
    summary() {
      return summarize(events);
    },
    toJSON() {
      return JSON.stringify({ version: 1, exportedAt: now(), summary: summarize(events), events }, null, 2);
    },
    reset() {
      events = [];
    },
  };
}
