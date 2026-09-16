import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { KidGender, KidProfile, Subject, SubjectProfile, emptySubjectProfile } from "./types";
import { parsePracticeState } from "@/lib/practice/state";
import type { Grade } from "@/lib/exercises/types";

/**
 * Supabase-backed kid profile store. Takes the Supabase client as a
 * parameter rather than constructing its own — since the parent-accounts
 * migration, the `kids` table is RLS-gated on `auth.uid() = parent_id`, so
 * every call here needs the session-bound client from
 * lib/supabase/server.ts (which carries the logged-in parent's cookie), not
 * the plain anon client. Passing it in explicitly makes that requirement
 * visible at every call site instead of hiding it behind a module-level
 * singleton that would silently start failing RLS checks.
 */

type Client = SupabaseClient<Database>;

interface DbSubjectProfileRow {
  subject: string;
  estimated_level: string;
  topics_covered: string[];
  error_patterns: string[];
  emotional_signals: string[];
  recent_summary: string;
  session_count: number;
  last_updated: string;
  practice_state?: unknown;
}

function rowToProfile(row: DbSubjectProfileRow): SubjectProfile {
  return {
    estimatedLevel: row.estimated_level,
    topicsCovered: row.topics_covered ?? [],
    errorPatterns: row.error_patterns ?? [],
    emotionalSignals: row.emotional_signals ?? [],
    recentSummary: row.recent_summary,
    sessionCount: row.session_count,
    lastUpdated: row.last_updated,
    practice: parsePracticeState(row.practice_state),
  };
}

function toGrade(v: unknown): Grade | null {
  return v === "א" || v === "ב" || v === "ג" ? v : null;
}

function toGender(v: unknown): KidGender | null {
  return v === "boy" || v === "girl" ? v : null;
}

/** 2026-09-14: was a sequential for-loop awaiting getKid() one kid at a
 *  time — a real N+1 waterfall for any parent with more than one kid, and
 *  part of what the post-Google-sign-in wait was paying for (see
 *  app/page.tsx). Every kid's data is independent, so fetch them all at
 *  once. */
export async function listKids(supabase: Client): Promise<KidProfile[]> {
  const { data: kids, error } = await supabase.from("kids").select("*");
  if (error || !kids) return [];

  const full = await Promise.all(kids.map((k) => getKid(supabase, k.id as string)));
  return full.filter((k): k is KidProfile => k !== null);
}

export async function getKid(supabase: Client, id: string): Promise<KidProfile | null> {
  // The kids-row and subject_profiles queries don't depend on each other —
  // only the RESULT does (a kid that doesn't exist has no profiles to
  // report). Running them concurrently means a missing/errored kid pays
  // for one wasted profiles query instead of every real kid paying for
  // two round trips in series.
  const [kidResult, profilesResult] = await Promise.all([
    supabase.from("kids").select("*").eq("id", id).single(),
    supabase.from("subject_profiles").select("*").eq("kid_id", id),
  ]);
  const { data: kid, error } = kidResult;
  if (error || !kid) return null;
  const { data: profiles } = profilesResult;

  const subjects: Partial<Record<Subject, SubjectProfile>> = {};
  for (const row of profiles ?? []) {
    subjects[row.subject as Subject] = rowToProfile(row as DbSubjectProfileRow);
  }

  return {
    id: kid.id as string,
    name: kid.name as string,
    avatarId: (kid.avatar_id as string) ?? null,
    grade: toGrade(kid.grade),
    gender: toGender(kid.gender),
    createdAt: kid.created_at as string,
    subjects,
  };
}

export async function createKid(
  supabase: Client,
  parentId: string,
  name: string,
  avatarId: string | null,
  grade: Grade | null,
  gender: KidGender | null
): Promise<KidProfile> {
  const { data, error } = await supabase
    .from("kids")
    .insert({ name, avatar_id: avatarId, parent_id: parentId, grade, gender })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to create kid: ${error?.message}`);

  return {
    id: data.id as string,
    name: data.name as string,
    avatarId: (data.avatar_id as string) ?? null,
    grade: toGrade(data.grade),
    gender: toGender(data.gender),
    createdAt: data.created_at as string,
    subjects: {},
  };
}

export async function setKidGrade(supabase: Client, id: string, grade: Grade): Promise<boolean> {
  const { error } = await supabase.from("kids").update({ grade }).eq("id", id);
  return !error;
}

export async function setKidGender(supabase: Client, id: string, gender: KidGender): Promise<boolean> {
  const { error } = await supabase.from("kids").update({ gender }).eq("id", id);
  return !error;
}

export async function setKidAvatar(
  supabase: Client,
  id: string,
  avatarId: string
): Promise<KidProfile | null> {
  const { error } = await supabase.from("kids").update({ avatar_id: avatarId }).eq("id", id);
  if (error) return null;
  return getKid(supabase, id);
}

export async function getSubjectProfile(
  supabase: Client,
  kidId: string,
  subject: Subject
): Promise<SubjectProfile | null> {
  const { data, error } = await supabase
    .from("subject_profiles")
    .select("*")
    .eq("kid_id", kidId)
    .eq("subject", subject)
    .maybeSingle();
  if (error || !data) return null;
  return rowToProfile(data as DbSubjectProfileRow);
}

/** Upserts a subject profile. `patch` fields, when provided, replace the
 *  corresponding field (arrays are replaced wholesale by the caller, which
 *  is expected to have already merged/deduped/truncated them). */
export async function updateSubjectProfile(
  supabase: Client,
  kidId: string,
  subject: Subject,
  patch: Partial<SubjectProfile>
): Promise<SubjectProfile | null> {
  const current = (await getSubjectProfile(supabase, kidId, subject)) ?? emptySubjectProfile();
  const next: SubjectProfile = {
    ...current,
    ...patch,
    sessionCount: current.sessionCount + 1,
    lastUpdated: new Date().toISOString(),
  };

  const { error } = await supabase.from("subject_profiles").upsert({
    kid_id: kidId,
    subject,
    estimated_level: next.estimatedLevel,
    topics_covered: next.topicsCovered,
    error_patterns: next.errorPatterns,
    emotional_signals: next.emotionalSignals,
    recent_summary: next.recentSummary,
    session_count: next.sessionCount,
    last_updated: next.lastUpdated,
  });
  if (error) {
    console.error("[memory-store] failed to upsert subject profile:", error);
    return null;
  }
  return next;
}
