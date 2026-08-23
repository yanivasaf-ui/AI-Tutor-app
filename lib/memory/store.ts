import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { KidProfile, Subject, SubjectProfile, emptySubjectProfile } from "./types";

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
  };
}

export async function listKids(supabase: Client): Promise<KidProfile[]> {
  const { data: kids, error } = await supabase.from("kids").select("*");
  if (error || !kids) return [];

  const result: KidProfile[] = [];
  for (const k of kids) {
    const full = await getKid(supabase, k.id as string);
    if (full) result.push(full);
  }
  return result;
}

export async function getKid(supabase: Client, id: string): Promise<KidProfile | null> {
  const { data: kid, error } = await supabase.from("kids").select("*").eq("id", id).single();
  if (error || !kid) return null;

  const { data: profiles } = await supabase
    .from("subject_profiles")
    .select("*")
    .eq("kid_id", id);

  const subjects: Partial<Record<Subject, SubjectProfile>> = {};
  for (const row of profiles ?? []) {
    subjects[row.subject as Subject] = rowToProfile(row as DbSubjectProfileRow);
  }

  return {
    id: kid.id as string,
    name: kid.name as string,
    avatarId: (kid.avatar_id as string) ?? null,
    createdAt: kid.created_at as string,
    subjects,
  };
}

export async function createKid(
  supabase: Client,
  parentId: string,
  name: string,
  avatarId: string | null
): Promise<KidProfile> {
  const { data, error } = await supabase
    .from("kids")
    .insert({ name, avatar_id: avatarId, parent_id: parentId })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to create kid: ${error?.message}`);

  return {
    id: data.id as string,
    name: data.name as string,
    avatarId: (data.avatar_id as string) ?? null,
    createdAt: data.created_at as string,
    subjects: {},
  };
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
