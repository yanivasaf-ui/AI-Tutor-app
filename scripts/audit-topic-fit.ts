/**
 * Topic-fit audit (BUG B) — READ-ONLY. Re-runs lib/exercises/topic-fit.ts's
 * topicFit() over every row of the `exercises` bank and reports, per topic,
 * how many rows are correctly tagged but not actually about their topic, with
 * the offending questions. It writes nothing anywhere: rows it flags are
 * already kept from kids by the serving filter in store.ts, and removing them
 * from the table is a separate decision for whoever owns the data.
 *
 * Run: npx tsx scripts/audit-topic-fit.ts --dump <path-to-exercises.json>
 * Same `--dump` convention as scripts/guard-sweep.ts: export the `exercises`
 * table to JSON first (this app's RLS gives a plain script no read access).
 * Exits 1 when anything is flagged, so it can gate a re-seed.
 */
import { existsSync, readFileSync } from "node:fs";
import { topicFit } from "../lib/exercises/topic-fit";
import type { Exercise } from "../lib/exercises/types";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const DUMP_PATH = arg("dump", "/tmp/bank-full-dump.json")!;
if (!existsSync(DUMP_PATH)) {
  console.error(`No dump file at ${DUMP_PATH}. Export the exercises table to JSON and pass --dump <path>.`);
  process.exit(2);
}

interface Row {
  id: string;
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  type: Exercise["type"];
  subtype: Exercise["subtype"] | null;
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
console.log(`[topic-fit] loaded ${rows.length} rows from ${DUMP_PATH}`);

interface Agg {
  total: number;
  checked: number;
  flagged: { id: string; subtype: string; question: string }[];
}
const byTopic = new Map<string, Agg>();
for (const row of rows) {
  const key = row.topic_id ?? "(no topic_id)";
  const agg = byTopic.get(key) ?? { total: 0, checked: 0, flagged: [] };
  const fit = topicFit(rowToExercise(row), row.topic_id ?? undefined);
  agg.total++;
  if (fit.checked) agg.checked++;
  if (!fit.ok) agg.flagged.push({ id: row.id, subtype: row.subtype ?? row.type, question: row.question });
  byTopic.set(key, agg);
}

let flaggedTotal = 0;
for (const [topic, agg] of [...byTopic].sort()) {
  flaggedTotal += agg.flagged.length;
  const note = agg.checked === 0 ? "  (no fit rule — not checked)" : "";
  console.log(`${topic.padEnd(34)} total ${String(agg.total).padStart(3)}  checked ${String(agg.checked).padStart(3)}  off-topic ${String(agg.flagged.length).padStart(3)}${note}`);
  for (const f of agg.flagged) console.log(`    ${f.id}  [${f.subtype}]  ${f.question.replace(/\s+/g, " ").slice(0, 90)}`);
}
console.log(`\n[topic-fit] ${flaggedTotal} of ${rows.length} rows are correctly tagged but not about their topic.`);
process.exit(flaggedTotal > 0 ? 1 : 0);
