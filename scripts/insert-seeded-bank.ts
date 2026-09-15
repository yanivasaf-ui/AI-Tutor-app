/**
 * Inserts scripts/seed-exercise-bank.ts's JSON output into the live
 * `exercises` table, authenticated as the throwaway QA account (RLS:
 * "authenticated inserts exercises" — auth.uid() IS NOT NULL, no other
 * restriction) rather than a service-role key, since none is configured
 * for this project yet (see the seed script's own header and the top-up
 * GitHub Actions workflow, which DOES expect one once added). This is a
 * one-off operator step for this session's initial seed, run through the
 * exact same insert path lib/exercises/store.ts's saveExercise uses.
 *
 * Run: npx tsx scripts/insert-seeded-bank.ts --in /tmp/bank-seed-full.json
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import type { Exercise } from "../lib/exercises/types";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const IN_PATH = arg("in", "/tmp/bank-seed-full.json")!;
if (!existsSync(IN_PATH)) {
  console.error(`No input file at ${IN_PATH}.`);
  process.exit(1);
}

async function main() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
    email: "loki.qa.test.20260824@gmail.com",
    password: process.env.QA_ACCOUNT_PASSWORD!,
  });
  if (authError || !auth.user) throw new Error(`Sign-in failed: ${authError?.message}`);
  console.log(`[insert] signed in as ${auth.user.email} (${auth.user.id})`);

  const exercises: Exercise[] = JSON.parse(readFileSync(IN_PATH, "utf8"));
  console.log(`[insert] ${exercises.length} exercises to insert from ${IN_PATH}`);

  const rows = exercises.map((ex) => ({
    subject: ex.subject,
    grade: ex.grade,
    type: ex.type,
    subtype: ex.subtype ?? null,
    topic: ex.topic,
    topic_id: ex.topicId ?? null,
    passage: ex.passage ?? null,
    question: ex.question,
    choices: ex.choices ?? null,
    number_line: (ex.numberLine as unknown as Database["public"]["Tables"]["exercises"]["Insert"]["number_line"]) ?? null,
    tiles: (ex.tiles as unknown as Database["public"]["Tables"]["exercises"]["Insert"]["tiles"]) ?? null,
    grouping: (ex.grouping as unknown as Database["public"]["Tables"]["exercises"]["Insert"]["grouping"]) ?? null,
    correct_answer: ex.correctAnswer,
    computation: (ex.computation as unknown as Database["public"]["Tables"]["exercises"]["Insert"]["computation"]) ?? null,
    difficulty: ex.difficulty ?? null,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await supabase.from("exercises").insert(batch);
    if (error) throw new Error(`Insert failed at batch starting ${i}: ${error.message}`);
    inserted += batch.length;
    console.log(`[insert] ${inserted}/${rows.length}`);
  }
  console.log(`[insert] done: ${inserted} exercises inserted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
