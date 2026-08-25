import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { Exercise, ExerciseSubtype, ExerciseType, NumberLineData, TileOrderData, GroupingData, Grade } from "./types";

type Client = SupabaseClient<Database>;

/**
 * The shared exercise bank + per-kid attempt log Asaf asked for directly:
 * "every exercise that's generated should be logged and reused rather than
 * making a new one every time... for every kid, it needs to know which
 * exercise he answered and if he succeeded or not." Generation cost (an
 * LLM call) gets paid once per exercise and amortized across every kid who
 * sees it afterward, instead of once per kid per exercise.
 */

interface DbExerciseRow {
  id: string;
  subject: string;
  grade: string;
  type: string;
  subtype: string | null;
  topic: string;
  passage: string | null;
  question: string;
  choices: string[] | null;
  number_line: unknown;
  tiles: unknown;
  grouping: unknown;
  correct_answer: string;
}

function rowToExercise(row: DbExerciseRow): Exercise {
  return {
    id: row.id,
    subject: row.subject as "math" | "hebrew",
    grade: row.grade as Grade,
    type: row.type as ExerciseType,
    subtype: (row.subtype as ExerciseSubtype | null) ?? undefined,
    topic: row.topic,
    passage: row.passage ?? undefined,
    question: row.question,
    choices: row.choices ?? undefined,
    numberLine: (row.number_line as NumberLineData | null) ?? undefined,
    tiles: (row.tiles as TileOrderData | null) ?? undefined,
    grouping: (row.grouping as GroupingData | null) ?? undefined,
    correctAnswer: row.correct_answer,
  };
}

/** Looks for an existing bank exercise this kid hasn't already attempted.
 *  Prefers less-used exercises so reuse spreads across the bank rather than
 *  hammering the same one. Returns null when nothing fits — the caller
 *  should fall back to generating a fresh one. */
export async function findReusableExercise(
  supabase: Client,
  subject: "math" | "hebrew",
  grade: Grade,
  kidId: string | null
): Promise<Exercise | null> {
  let attemptedIds: string[] = [];
  if (kidId) {
    const { data: attempts } = await supabase
      .from("exercise_attempts")
      .select("exercise_id")
      .eq("kid_id", kidId);
    attemptedIds = (attempts ?? []).map((a) => a.exercise_id as string);
  }

  let query = supabase
    .from("exercises")
    .select("*")
    .eq("subject", subject)
    .eq("grade", grade)
    .order("times_used", { ascending: true })
    .limit(1);

  if (attemptedIds.length > 0) {
    query = query.not("id", "in", `(${attemptedIds.join(",")})`);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return rowToExercise(data as DbExerciseRow);
}

/** Saves a freshly-generated exercise to the bank, returning it with the
 *  real DB-assigned id (replaces the caller's throwaway client-side id). */
export async function saveExercise(
  supabase: Client,
  exercise: Omit<Exercise, "id">
): Promise<Exercise> {
  const { data, error } = await supabase
    .from("exercises")
    .insert({
      subject: exercise.subject,
      grade: exercise.grade,
      type: exercise.type,
      subtype: exercise.subtype ?? null,
      topic: exercise.topic,
      passage: exercise.passage ?? null,
      question: exercise.question,
      choices: exercise.choices ?? null,
      // Cast: NumberLineData/TileOrderData are plain JSON-serializable
      // objects, but TS's Json type requires a string index signature that
      // a named interface doesn't structurally have.
      number_line: (exercise.numberLine as unknown as Database["public"]["Tables"]["exercises"]["Insert"]["number_line"]) ?? null,
      tiles: (exercise.tiles as unknown as Database["public"]["Tables"]["exercises"]["Insert"]["tiles"]) ?? null,
      grouping: (exercise.grouping as unknown as Database["public"]["Tables"]["exercises"]["Insert"]["grouping"]) ?? null,
      correct_answer: exercise.correctAnswer,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to save exercise: ${error?.message}`);
  return rowToExercise(data as DbExerciseRow);
}

/** Logs one kid's attempt at one exercise, and updates the exercise's
 *  aggregate times_used/times_correct — the real, exact per-kid record
 *  Asaf asked for, distinct from the free-text SubjectProfile summary. */
export async function recordAttempt(
  supabase: Client,
  opts: {
    kidId: string;
    exerciseId: string;
    subject: string;
    correct: boolean;
    errorNote?: string;
  }
): Promise<void> {
  await supabase.from("exercise_attempts").insert({
    kid_id: opts.kidId,
    exercise_id: opts.exerciseId,
    subject: opts.subject,
    correct: opts.correct,
    error_note: opts.errorNote ?? null,
  });

  const { data: current } = await supabase
    .from("exercises")
    .select("times_used, times_correct")
    .eq("id", opts.exerciseId)
    .single();

  await supabase
    .from("exercises")
    .update({
      times_used: (current?.times_used ?? 0) + 1,
      times_correct: (current?.times_correct ?? 0) + (opts.correct ? 1 : 0),
    })
    .eq("id", opts.exerciseId);
}
