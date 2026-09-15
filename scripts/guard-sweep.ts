/**
 * Guard sweep (2026-09-14) — the bank's own audit, independent of seeding.
 * Reads every row in `exercises`, re-runs lib/exercises/bank-guard.ts's
 * verifyExercise() against each, and reports a table per subject/subtype
 * and per topic: total / passed / failed. Also reports duplicate specs
 * (same topic_id+difficulty+fingerprint) — the seed script prevents these
 * going forward, but the sweep is the independent check that it worked.
 *
 * Run: npx tsx scripts/guard-sweep.ts [--project <id>]
 * Reads directly via the Supabase MCP-equivalent path isn't available to
 * a plain script (no service key), so this expects a JSON dump of the
 * `exercises` table at --dump (see scripts/README or the seed report for
 * how it's produced) OR falls back to querying with the anon key for
 * publicly-readable rows if RLS allows — this app's RLS requires auth,
 * so the practical path this session is `--dump`.
 */
import { readFileSync, existsSync } from "node:fs";
import { verifyExercise, specFingerprint } from "../lib/exercises/bank-guard";
import type { Exercise, ExerciseSubtype } from "../lib/exercises/types";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const DUMP_PATH = arg("dump", "/tmp/bank-full-dump.json")!;
if (!existsSync(DUMP_PATH)) {
  console.error(`No dump file at ${DUMP_PATH}. Produce one first (see scripts/seed-exercise-bank.ts's report, or export the exercises table to JSON) and pass --dump <path>.`);
  process.exit(1);
}

interface Row {
  id: string;
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  type: Exercise["type"];
  subtype: ExerciseSubtype | null;
  topic: string;
  topic_id: string | null;
  passage: string | null;
  question: string;
  choices: string[] | null;
  number_line: Exercise["numberLine"] | null;
  tiles: Exercise["tiles"] | null;
  grouping: Exercise["grouping"] | null;
  correct_answer: string;
  computation: Exercise["computation"] | null;
  difficulty: number | null;
}

function rowToExercise(row: Row): Exercise {
  return {
    id: row.id,
    subject: row.subject,
    grade: row.grade,
    type: row.type,
    subtype: row.subtype ?? undefined,
    topic: row.topic,
    topicId: row.topic_id ?? undefined,
    passage: row.passage ?? undefined,
    question: row.question,
    choices: row.choices ?? undefined,
    numberLine: row.number_line ?? undefined,
    tiles: row.tiles ?? undefined,
    grouping: row.grouping ?? undefined,
    correctAnswer: row.correct_answer,
    computation: row.computation ?? undefined,
    difficulty: (row.difficulty as 1 | 2 | 3) ?? undefined,
  };
}

const rows: Row[] = JSON.parse(readFileSync(DUMP_PATH, "utf8"));
console.log(`[sweep] loaded ${rows.length} rows from ${DUMP_PATH}`);

interface Agg {
  total: number;
  passed: number;
  failed: number;
  failReasons: string[];
}
const bySubtype = new Map<string, Agg>();
const byTopic = new Map<string, Agg>();
function bump(map: Map<string, Agg>, key: string, ok: boolean, reason?: string) {
  const a = map.get(key) ?? { total: 0, passed: 0, failed: 0, failReasons: [] };
  a.total++;
  if (ok) a.passed++;
  else {
    a.failed++;
    if (reason) a.failReasons.push(reason);
  }
  map.set(key, a);
}

const fingerprints = new Map<string, string[]>(); // "topicId:difficulty:fingerprint" -> [exerciseId,...]

for (const row of rows) {
  const ex = rowToExercise(row);
  const result = verifyExercise(ex);
  bump(bySubtype, `${row.subject}/${row.subtype ?? "(none)"}`, result.ok, result.reason);
  bump(byTopic, row.topic_id ?? `(no topic_id: ${row.topic})`, result.ok, result.reason);

  if (result.ok && row.topic_id && row.difficulty) {
    const fp = `${row.topic_id}:${row.difficulty}:${specFingerprint(ex)}`;
    const list = fingerprints.get(fp) ?? [];
    list.push(row.id);
    fingerprints.set(fp, list);
  }
}

console.log("\n=== Guard sweep: per subject/subtype ===");
const subtypeTable = [...bySubtype.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([key, a]) => ({ subtype: key, total: a.total, passed: a.passed, failed: a.failed }));
console.table(subtypeTable);

console.log("\n=== Guard sweep: per topic ===");
const topicTable = [...byTopic.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([key, a]) => ({ topic: key, total: a.total, passed: a.passed, failed: a.failed }));
console.table(topicTable);

const totalFailed = rows.length - [...bySubtype.values()].reduce((s, a) => s + a.passed, 0);
console.log(`\n[sweep] TOTAL: ${rows.length} rows, ${rows.length - totalFailed} passed, ${totalFailed} failed.`);
if (totalFailed > 0) {
  console.log("\n[sweep] failure samples:");
  for (const [key, a] of bySubtype) {
    if (a.failReasons.length > 0) console.log(`  ${key}: ${a.failReasons.slice(0, 3).join(" | ")}`);
  }
}

const dupes = [...fingerprints.entries()].filter(([, ids]) => ids.length > 1);
console.log(`\n[sweep] duplicate specs (same topic+level+fingerprint): ${dupes.length}`);
for (const [key, ids] of dupes.slice(0, 20)) {
  console.log(`  ${key}: ${ids.join(", ")}`);
}

process.exit(totalFailed > 0 || dupes.length > 0 ? 1 : 0);
