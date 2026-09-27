/**
 * Hebrew topic-boundary audit — READ-ONLY.
 *
 * Reports, per Hebrew topic, how many of its rows carry a question that is
 * also filed under a DIFFERENT topic. An identical question cannot belong
 * to two topics, so every one of those rows is a proven mis-filing — with
 * no vocabulary list and no opinion about what a topic is "about". See
 * lib/exercises/hebrew-topic-evidence.ts for why Hebrew cannot use the
 * anchor approach that lib/exercises/topic-fit.ts uses for maths.
 *
 * It writes nothing. It is a measurement, and the decision about what to
 * do with a flagged row (which of its filings is the right one) is not one
 * this script can make.
 *
 * Run: npx tsx scripts/audit-hebrew-topic-fit.ts --dump <exercises.json>
 * Same --dump convention as scripts/audit-topic-fit.ts: export the
 * exercises table to JSON first, because RLS gives a plain script no read
 * access. Exits 1 when anything is flagged.
 */
import { existsSync, readFileSync } from "node:fs";
import { auditHebrewTopics, subtypeSpread } from "../lib/exercises/hebrew-topic-evidence";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const DUMP_PATH = arg("dump", "/tmp/bank-full-dump.json")!;
if (!existsSync(DUMP_PATH)) {
  console.error(`No dump file at ${DUMP_PATH}. Export the exercises table to JSON and pass --dump <path>.`);
  process.exit(2);
}

interface RawRow {
  id: string;
  subject: string;
  topic_id: string | null;
  question: string;
  subtype: string | null;
  type: string;
}

const all: RawRow[] = JSON.parse(readFileSync(DUMP_PATH, "utf8"));
const hebrew = all
  .filter((r) => r.subject === "hebrew")
  .map((r) => ({ id: r.id, question: r.question, topicId: r.topic_id, subtype: r.subtype, type: r.type }));

console.log(`[hebrew-audit] ${hebrew.length} Hebrew rows from ${DUMP_PATH}\n`);

const audit = auditHebrewTopics(hebrew);

console.log("Per topic — rows whose question is also filed under another topic:");
for (const t of audit.byTopic) {
  const pct = Math.round(t.ratio * 100);
  console.log(`  ${t.topicId.padEnd(42)} ${String(t.shared).padStart(3)} / ${String(t.total).padStart(3)}  (${String(pct).padStart(3)}%)`);
}

console.log(`\nThe most-shared questions (a question under N topics belongs to at most one):`);
for (const g of audit.groups.slice(0, 12)) {
  console.log(`  [${g.topics.length} topics] ${g.question.slice(0, 68)}`);
  console.log(`      ${g.topics.join(", ")}`);
}

console.log(`\nDoes exercise KIND separate the topics at all?`);
for (const s of subtypeSpread(hebrew)) {
  console.log(`  ${s.subtype.padEnd(26)} appears under ${s.topics} topic(s)`);
}

console.log(
  `\n[hebrew-audit] ${audit.flaggedRows} of ${audit.rows} rows (${Math.round((audit.flaggedRows / audit.rows) * 100)}%) share a question with another topic, across ${audit.duplicateQuestions} distinct questions.`
);
console.log("This is a LOWER BOUND: only exact duplicates are visible to it.");
process.exit(audit.flaggedRows > 0 ? 1 : 0);
