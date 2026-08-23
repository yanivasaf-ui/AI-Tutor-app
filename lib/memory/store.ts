import { getSupabase } from "@/lib/supabase/client";
import { KidProfile, Subject, SubjectProfile, emptySubjectProfile } from "./types";

/**
 * Supabase-backed kid profile store. Replaces the earlier JSON-file store
 * (first on process.cwd()/data — crashed outright in production, EROFS on
 * Vercel's read-only /var/task; then on os.tmpdir() — didn't crash, but
 * didn't persist across instances/cold-starts either, confirmed directly
 * in production). This is the real fix, not another stopgap: a kid's
 * profile now survives the way the locked "derived from real exercise
 * performance, session by session" decision actually requires.
 */

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

export async function listKids(): Promise<KidProfile[]> {
  const supabase = getSupabase();
  const { data: kids, error } = await supabase.from("kids").select("*");
  if (error || !kids) return [];

  const result: KidProfile[] = [];
  for (const k of kids) {
    result.push(await getKid(k.id as string).then((kp) => kp!));
  }
  return result;
}

export async function getKid(id: string): Promise<KidProfile | null> {
  const supabase = getSupabase();
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

export async function createKid(name: string, avatarId: string | null): Promise<KidProfile> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("kids")
    .insert({ name, avatar_id: avatarId })
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

export async function setKidAvatar(id: string, avatarId: string): Promise<KidProfile | null> {
  const supabase = getSupabase();
  const { error } = await supabase.from("kids").update({ avatar_id: avatarId }).eq("id", id);
  if (error) return null;
  return getKid(id);
}

export async function getSubjectProfile(
  kidId: string,
  subject: Subject
): Promise<SubjectProfile | null> {
  const supabase = getSupabase();
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
  kidId: string,
  subject: Subject,
  patch: Partial<SubjectProfile>
): Promise<SubjectProfile | null> {
  const supabase = getSupabase();
  const current = (await getSubjectProfile(kidId, subject)) ?? emptySubjectProfile();
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
