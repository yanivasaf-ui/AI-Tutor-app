/**
 * Per-kid, per-subject practice state: the adaptive level for each topic,
 * explicit journey completion, and the two per-subject flags the entry
 * flow needs. Lives in `subject_profiles.practice_state` (jsonb) — an
 * extension of the existing subject-profile row, not a parallel store.
 * lib/memory/store.ts's updateSubjectProfile() upserts explicit columns
 * only, so the LLM memory update never overwrites this column.
 *
 * Everything in this file is pure (no DB, no React) so the rules can be
 * tested directly and imported on both sides of the wire.
 */

export type Level = 1 | 2 | 3;
export type PracticeMode = "journey" | "free";
/** What the last answer did to the level: first placement after the
 *  diagnostic, a step up, a step down, or nothing. */
export type LevelChange = "placed" | "up" | "down" | null;

export interface TopicState {
  /** Undefined until the diagnostic places the kid. */
  level?: Level;
  /** First-attempt answers counted toward placement, while undiagnosed. */
  diagnostic?: { answered: number; correct: number };
  /** Consecutive first-attempt correct answers at the current level. */
  streak?: number;
  /** Set once, the first time this topic is answered correctly from the
   *  journey map. Free practice never writes it — the map position is
   *  derived from this and nothing else. */
  journeyDoneAt?: string;
  attempts?: number;
  correct?: number;
}

export interface PracticeState {
  topics?: Record<string, TopicState>;
  /** The map's one-time intro line for this subject was shown. */
  journeyIntroSeenAt?: string;
  /** A parent's "הצע תרגול" pick. Stored on the suggested topic's subject;
   *  at most one subject carries one at a time. */
  parentSuggestion?: { topicId: string; at: string };
}

/** What the client needs to show: the level, or that placement is still
 *  running, and what just happened. */
export interface PracticeSummary {
  level: Level | null;
  diagnosing: boolean;
  change: LevelChange;
}

export const DIAGNOSTIC_QUESTIONS = 2;
/** Diagnostic exercises (and any topic without a level) are built at the
 *  middle level. */
export const DEFAULT_LEVEL: Level = 2;
export const STREAK_TO_LEVEL_UP = 2;

function isLevel(v: unknown): v is Level {
  return v === 1 || v === 2 || v === 3;
}

function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function parseTopicState(raw: unknown): TopicState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const t: TopicState = {};
  if (isLevel(r.level)) t.level = r.level;
  const d = r.diagnostic as Record<string, unknown> | undefined;
  if (d && typeof d === "object") {
    const answered = count(d.answered);
    const correct = count(d.correct);
    if (answered !== undefined && correct !== undefined) t.diagnostic = { answered, correct: Math.min(correct, answered) };
  }
  if (count(r.streak) !== undefined) t.streak = count(r.streak);
  if (str(r.journeyDoneAt)) t.journeyDoneAt = str(r.journeyDoneAt);
  if (count(r.attempts) !== undefined) t.attempts = count(r.attempts);
  if (count(r.correct) !== undefined) t.correct = count(r.correct);
  return t;
}

/** Defensive read of the jsonb column: anything malformed is dropped, not
 *  trusted — the column is written by this app only, but a bad value must
 *  never crash the map. */
export function parsePracticeState(raw: unknown): PracticeState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: PracticeState = {};
  if (r.topics && typeof r.topics === "object" && !Array.isArray(r.topics)) {
    const topics: Record<string, TopicState> = {};
    for (const [id, v] of Object.entries(r.topics as Record<string, unknown>)) {
      const t = parseTopicState(v);
      if (t) topics[id] = t;
    }
    out.topics = topics;
  }
  if (str(r.journeyIntroSeenAt)) out.journeyIntroSeenAt = str(r.journeyIntroSeenAt);
  const s = r.parentSuggestion as Record<string, unknown> | undefined;
  if (s && typeof s === "object" && str(s.topicId)) {
    out.parentSuggestion = { topicId: s.topicId as string, at: str(s.at) ?? "" };
  }
  return out;
}

export function isDiagnosing(t: TopicState | undefined): boolean {
  return t?.level === undefined;
}

export function levelForNextExercise(t: TopicState | undefined): Level {
  return t?.level ?? DEFAULT_LEVEL;
}

export function summarize(t: TopicState | undefined, change: LevelChange = null): PracticeSummary {
  return { level: t?.level ?? null, diagnosing: isDiagnosing(t), change };
}

/**
 * The adaptive rules, for one answer on one topic.
 *
 * `attempt` is 1 for the first answer to a question, 2 for the retry after
 * a hint. The pedagogy is hint-first: a first wrong answer gets a hint and
 * a retry; a second wrong answer on the same question gets the full
 * explanation, then an easier exercise.
 *
 * Undiagnosed (first time on the topic): only first-attempt answers count.
 * After DIAGNOSTIC_QUESTIONS of them — 2 right → level 3, 1 → level 2,
 * 0 → level 1.
 *
 * Diagnosed:
 * - first-attempt right: streak + 1; at STREAK_TO_LEVEL_UP the level goes
 *   up one (max 3) and the streak restarts;
 * - first-attempt wrong: streak resets (the hint and retry follow);
 * - second-attempt right: streak resets — it wasn't a clean answer;
 * - second-attempt wrong: streak resets and the level goes down one
 *   (min 1), so the next exercise is easier.
 */
export function applyAnswer(
  prev: TopicState | undefined,
  { correct, attempt }: { correct: boolean; attempt: 1 | 2 }
): { next: TopicState; change: LevelChange } {
  const next: TopicState = {
    ...prev,
    diagnostic: prev?.diagnostic ? { ...prev.diagnostic } : undefined,
    attempts: (prev?.attempts ?? 0) + 1,
    correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
  };
  if (!next.diagnostic) delete next.diagnostic;

  if (next.level === undefined) {
    if (attempt !== 1) return { next, change: null };
    const d = next.diagnostic ?? { answered: 0, correct: 0 };
    d.answered += 1;
    if (correct) d.correct += 1;
    next.diagnostic = d;
    if (d.answered < DIAGNOSTIC_QUESTIONS) return { next, change: null };
    next.level = d.correct >= 2 ? 3 : d.correct === 1 ? 2 : 1;
    next.streak = 0;
    return { next, change: "placed" };
  }

  if (attempt === 1 && correct) {
    const streak = (next.streak ?? 0) + 1;
    if (streak >= STREAK_TO_LEVEL_UP && next.level < 3) {
      next.level = (next.level + 1) as Level;
      next.streak = 0;
      return { next, change: "up" };
    }
    next.streak = Math.min(streak, STREAK_TO_LEVEL_UP);
    return { next, change: null };
  }

  next.streak = 0;
  if (attempt === 2 && !correct && next.level > 1) {
    next.level = (next.level - 1) as Level;
    return { next, change: "down" };
  }
  return { next, change: null };
}

/**
 * One answer applied to a subject's whole practice state — the level
 * rules above, plus journey completion. Completion is recorded only from
 * the journey map (`mode === "journey"`), on the first correct answer, and
 * never overwritten; free practice leaves it untouched, which is what
 * keeps free practice from moving the kid's place on the map.
 */
export function recordAnswer(
  state: PracticeState,
  topicId: string,
  a: { correct: boolean; attempt: 1 | 2; mode: PracticeMode; at: string }
): { state: PracticeState; topic: TopicState; change: LevelChange } {
  const { next, change } = applyAnswer(state.topics?.[topicId], a);
  if (a.mode === "journey" && a.correct && !next.journeyDoneAt) next.journeyDoneAt = a.at;
  return { state: { ...state, topics: { ...state.topics, [topicId]: next } }, topic: next, change };
}

/** The parent's current suggestion, whichever subject carries it (the
 *  newest, if a race ever left one on both). */
export function activeSuggestion(
  bySubject: Partial<Record<string, PracticeState | undefined>>
): { topicId: string; at: string } | undefined {
  let best: { topicId: string; at: string } | undefined;
  for (const s of Object.values(bySubject)) {
    const p = s?.parentSuggestion;
    if (p && (!best || p.at > best.at)) best = p;
  }
  return best;
}

/** Topic ids completed on the journey, for the map. */
export function journeyDoneIds(state: PracticeState | undefined): Set<string> {
  const ids = new Set<string>();
  for (const [id, t] of Object.entries(state?.topics ?? {})) if (t.journeyDoneAt) ids.add(id);
  return ids;
}
