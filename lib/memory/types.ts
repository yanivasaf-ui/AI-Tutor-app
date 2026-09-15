import type { PracticeState } from "@/lib/practice/state";
import type { Grade } from "@/lib/exercises/types";

export type Subject = "math" | "hebrew";

/**
 * Per-kid, per-subject persistent profile. This is the "running history"
 * required by the locked placement/calibration decision
 * (M-memory/decisions.md, "AI Tutor IL: Core UX Mechanics Locked", 2026-08-22):
 * placement is derived entirely from real exercise performance, adjusted
 * session by session, with the tutor LLM judging pacing in-context — which
 * only works if this state actually persists across sessions.
 */
export interface SubjectProfile {
  /** Free-text estimated level/pace, written and updated by the tutor LLM
   *  itself (not a hardcoded rule) — e.g. "כיתה ב', קצת מעל הרמה הרשמית
   *  בחיבור וחיסור, עדיין מתקשה בבעיות מילוליות". Starts empty (grade-level
   *  default, per the locked cold-start tradeoff). */
  estimatedLevel: string;
  /** Short rolling list of topics actually covered in real sessions. */
  topicsCovered: string[];
  /** Recurring error patterns observed (not just "wrong answer" once). */
  errorPatterns: string[];
  /** Notable emotional/engagement signals — frustration, confidence,
   *  disengagement — surfaced over time, not just the single-message
   *  keyword flag that already exists in tutor-system-prompt.ts. */
  emotionalSignals: string[];
  /** One or two sentence free-text rolling summary the tutor LLM writes
   *  for itself, replaced (not appended) on every update. This is the
   *  primary thing injected into the next system prompt. */
  recentSummary: string;
  sessionCount: number;
  lastUpdated: string; // ISO timestamp
  /** Adaptive levels, journey completion and the entry-flow flags — see
   *  lib/practice/state.ts. Read with the profile; written only through
   *  lib/practice/store.ts, never by updateSubjectProfile(). */
  practice?: PracticeState;
}

export type KidGender = "boy" | "girl";

export interface KidProfile {
  id: string;
  name: string;
  avatarId: string | null;
  /** Null for kids created before kids.grade existed (their grade lived in
   *  localStorage only; the kid screen backfills it). */
  grade: Grade | null;
  /** Null for kids created before this field existed (2026-09-15, voice
   *  experience fix item 4) — every tutor line addresses the child by this
   *  gender when known; falls back to the pre-existing neutral phrasing
   *  when null, same as an unbackfilled grade. Distinct from `avatarId`
   *  (the character/mascot's own gender, unrelated to the child's). */
  gender: KidGender | null;
  createdAt: string;
  subjects: Partial<Record<Subject, SubjectProfile>>;
}

export interface KidProfileStoreShape {
  kids: Record<string, KidProfile>;
}

export function emptySubjectProfile(): SubjectProfile {
  return {
    estimatedLevel: "",
    topicsCovered: [],
    errorPatterns: [],
    emotionalSignals: [],
    recentSummary: "",
    sessionCount: 0,
    lastUpdated: new Date().toISOString(),
  };
}
