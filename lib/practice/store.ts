import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { Subject } from "@/lib/memory/types";
import { parsePracticeState, type PracticeState } from "./state";

type Client = SupabaseClient<Database>;

/**
 * Reads and writes `subject_profiles.practice_state` (see ./state.ts).
 * Only this column is touched: the upsert names practice_state alone, so
 * the LLM-written profile columns on the same row are left as they are —
 * and lib/memory/store.ts's updateSubjectProfile() upserts only its own
 * columns in turn. A missing row is created with column defaults.
 *
 * Callers must already have checked the kid belongs to the signed-in
 * parent (getKid() under the parent's RLS): subject_profiles' own policies
 * don't check ownership.
 */

export async function getPracticeState(supabase: Client, kidId: string, subject: Subject): Promise<PracticeState> {
  const { data, error } = await supabase
    .from("subject_profiles")
    .select("practice_state")
    .eq("kid_id", kidId)
    .eq("subject", subject)
    .maybeSingle();
  // A failed read must not become an empty state that the next write
  // saves over the real one.
  if (error) throw new Error(`Failed to read practice state: ${error.message}`);
  return parsePracticeState(data?.practice_state);
}

export async function savePracticeState(
  supabase: Client,
  kidId: string,
  subject: Subject,
  state: PracticeState
): Promise<void> {
  const { error } = await supabase
    .from("subject_profiles")
    .upsert({ kid_id: kidId, subject, practice_state: state as unknown as Json }, { onConflict: "kid_id,subject" });
  if (error) throw new Error(`Failed to save practice state: ${error.message}`);
}

/** Read-modify-write. Answers arrive one at a time from one kid's screen,
 *  so the window for two writes to interleave is small; not a lock. */
export async function updatePracticeState(
  supabase: Client,
  kidId: string,
  subject: Subject,
  update: (current: PracticeState) => PracticeState
): Promise<PracticeState> {
  const next = update(await getPracticeState(supabase, kidId, subject));
  await savePracticeState(supabase, kidId, subject, next);
  return next;
}
