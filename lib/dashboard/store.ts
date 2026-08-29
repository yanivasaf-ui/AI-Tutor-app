import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { Subject } from "../memory/types";
import { ParentFlag, RecentAttempt, SubjectStats } from "./types";

type Client = SupabaseClient<Database>;

/** Persists a real "flag to parent" event — the half of the locked
 *  off-curriculum/emotional decision (M-memory/decisions.md) that was
 *  only ever console.logged until now. Called from the chat handler in
 *  app/api/tutor/route.ts whenever looksOffCurriculumOrEmotional fires. */
export async function saveParentFlag(
  supabase: Client,
  opts: { kidId: string; subject: Subject; grade: string; message: string }
): Promise<void> {
  const { error } = await supabase.from("parent_flags").insert({
    kid_id: opts.kidId,
    subject: opts.subject,
    grade: opts.grade,
    message: opts.message,
  });
  if (error) console.error("[dashboard-store] failed to save parent flag:", error);
}

export async function getParentFlags(supabase: Client, kidId: string, limit = 20): Promise<ParentFlag[]> {
  const { data, error } = await supabase
    .from("parent_flags")
    .select("*")
    .eq("kid_id", kidId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    kidId: row.kid_id,
    subject: (row.subject as Subject) ?? null,
    grade: row.grade,
    message: row.message,
    createdAt: row.created_at ?? "",
  }));
}

/** Recent attempts enriched with the exercise's question/topic — fetched
 *  in two steps (attempts, then the exercises they reference) since
 *  Supabase's client-side query builder doesn't do arbitrary joins. */
export async function getRecentAttempts(supabase: Client, kidId: string, limit = 10): Promise<RecentAttempt[]> {
  const { data: attempts, error } = await supabase
    .from("exercise_attempts")
    .select("id, subject, exercise_id, correct, kid_answer, correct_answer, created_at")
    .eq("kid_id", kidId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !attempts || attempts.length === 0) return [];

  const exerciseIds = attempts.map((a) => a.exercise_id);
  const { data: exercises } = await supabase
    .from("exercises")
    .select("id, question, topic, correct_answer")
    .in("id", exerciseIds);

  const byId = new Map((exercises ?? []).map((e) => [e.id, e]));

  return attempts.map((a) => {
    const exercise = byId.get(a.exercise_id);
    return {
      id: a.id,
      subject: a.subject as Subject,
      question: exercise?.question ?? "",
      topic: exercise?.topic ?? "",
      correct: a.correct,
      // Falls back to the exercise's own correct_answer for rows logged
      // before this column existed; kidAnswer has no such fallback since
      // it was never captured anywhere before now.
      kidAnswer: a.kid_answer ?? "",
      correctAnswer: a.correct_answer ?? exercise?.correct_answer ?? "",
      createdAt: a.created_at ?? "",
    };
  });
}

/** Per-subject accuracy from the FULL attempt history, not just the
 *  recent-activity slice above — aggregated client-side since this app's
 *  attempt volume is small enough that a raw SQL aggregate function isn't
 *  worth the extra moving part yet. */
export async function getSubjectStats(supabase: Client, kidId: string): Promise<SubjectStats[]> {
  const { data, error } = await supabase
    .from("exercise_attempts")
    .select("subject, correct")
    .eq("kid_id", kidId);
  if (error || !data) return [];

  const bySubject = new Map<Subject, SubjectStats>();
  for (const row of data) {
    const subject = row.subject as Subject;
    const stats = bySubject.get(subject) ?? { subject, totalAttempts: 0, correctAttempts: 0 };
    stats.totalAttempts += 1;
    if (row.correct) stats.correctAttempts += 1;
    bySubject.set(subject, stats);
  }
  return [...bySubject.values()];
}
