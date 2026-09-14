import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getTopicById } from "@/lib/map/topics";
import { parseComputation } from "./arithmetic";
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
  topic_id?: string | null;
  passage: string | null;
  question: string;
  choices: string[] | null;
  number_line: unknown;
  tiles: unknown;
  grouping: unknown;
  correct_answer: string;
  difficulty?: number | null;
  computation?: unknown;
}

function rowToExercise(row: DbExerciseRow): Exercise {
  const d = row.difficulty;
  return {
    id: row.id,
    subject: row.subject as "math" | "hebrew",
    grade: row.grade as Grade,
    type: row.type as ExerciseType,
    subtype: (row.subtype as ExerciseSubtype | null) ?? undefined,
    topic: row.topic,
    topicId: row.topic_id ?? undefined,
    passage: row.passage ?? undefined,
    question: row.question,
    choices: row.choices ?? undefined,
    numberLine: (row.number_line as NumberLineData | null) ?? undefined,
    tiles: (row.tiles as TileOrderData | null) ?? undefined,
    grouping: (row.grouping as GroupingData | null) ?? undefined,
    correctAnswer: row.correct_answer,
    // Re-validated on the way out, not trusted because it's in our own
    // table: a spec that no longer parses means the exercise falls back to
    // the non-computation path rather than grading against a bad number.
    computation: parseComputation(row.computation) ?? undefined,
    difficulty: d === 1 || d === 2 || d === 3 ? d : undefined,
  };
}

/** How many unseen candidates to pull before picking one — the pre-
 *  generated bank (2026-09-14) targets 10 per topic+level, so this
 *  comfortably covers a whole slot without a second round trip; the
 *  random pick among them is what makes serving feel like "a bank",
 *  not "the same three questions in rotation". */
const REUSE_CANDIDATE_LIMIT = 20;

/** Looks for an existing bank exercise this kid hasn't already attempted,
 *  and returns a RANDOM one among the matches — not the least-used one.
 *  (2026-09-14: was `order("times_used").limit(1)`, which serves the
 *  bank round-robin; a kid doing several in a row would notice the
 *  pattern. PostgREST's JS client has no supported "order by random()",
 *  so this pulls a candidate page and picks client-side instead — cheap
 *  at the bank's actual scale, ~10-20 rows per slot.) Returns null when
 *  nothing fits — the caller falls back to generating a fresh one.
 *
 *  `topicId` (feat: topic-scoped exercise generation) narrows reuse to
 *  this exact map node — matched on the stable topic_id column
 *  (2026-09-14: added alongside the pre-generated bank) when the row has
 *  one, falling back to the long curriculum `topic` string for older
 *  rows that predate it. Without this, a kid tapping one topic node could
 *  get served a reused exercise from a completely different topic in the
 *  same subject+grade. An unresolvable topicId is treated the same as no
 *  topicId — falls back to subject+grade reuse rather than refusing to
 *  serve anything.
 *
 *  `difficulty` (adaptive levels, lib/practice/state.ts) narrows reuse to
 *  exercises built at that level, so a kid who just dropped a level isn't
 *  handed a banked exercise from the level they struggled at. Exercises
 *  banked before levels existed have no difficulty and count as level 2,
 *  the level every exercise was implicitly built at back then. */
export async function findReusableExercise(
  supabase: Client,
  subject: "math" | "hebrew",
  grade: Grade,
  kidId: string | null,
  topicId?: string,
  difficulty?: 1 | 2 | 3
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
    .limit(REUSE_CANDIDATE_LIMIT);

  const topic = topicId ? getTopicById(topicId) : undefined;
  const topicScoped = topic && topic.subject === subject && topic.grade === grade;
  if (topicScoped) {
    // Rows from before topic_id existed have it NULL but do carry the
    // matching `topic` string — the `or` keeps them servable instead of
    // orphaning them the moment this column shipped.
    query = query.or(`topic_id.eq.${topic!.id},and(topic_id.is.null,topic.eq.${topic!.topic})`);
  }

  if (difficulty === 2) {
    query = query.or("difficulty.eq.2,difficulty.is.null");
  } else if (difficulty) {
    query = query.eq("difficulty", difficulty);
  }

  if (attemptedIds.length > 0) {
    query = query.not("id", "in", `(${attemptedIds.join(",")})`);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;
  const pick = data[Math.floor(Math.random() * data.length)];
  return rowToExercise(pick as DbExerciseRow);
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
      topic_id: exercise.topicId ?? null,
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
      computation: (exercise.computation as unknown as Database["public"]["Tables"]["exercises"]["Insert"]["computation"]) ?? null,
      difficulty: exercise.difficulty ?? null,
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
    /** The kid's actual submitted answer and the exercise's correct
     *  answer, logged verbatim on the attempt — previously only
     *  reconstructable (correctAnswer) via a join, or not captured at all
     *  (kidAnswer). Asaf asked for this directly: "log the right answers
     *  too," alongside the existing correct/incorrect + errorNote. */
    kidAnswer: string;
    correctAnswer: string;
  }
): Promise<void> {
  await supabase.from("exercise_attempts").insert({
    kid_id: opts.kidId,
    exercise_id: opts.exerciseId,
    subject: opts.subject,
    correct: opts.correct,
    error_note: opts.errorNote ?? null,
    kid_answer: opts.kidAnswer,
    correct_answer: opts.correctAnswer,
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
