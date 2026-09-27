/**
 * READ-ONLY audit: every bank row that violates the allowed-format table
 * (lib/map/topic-formats.ts), grouped by topic, with counts. Deletes nothing,
 * writes nothing — the cleanup is a separate, reviewed script.
 *
 * Two steps, so the database is only ever read with a plain SELECT (run it
 * with any read-only client, e.g. the Supabase SQL editor or connector):
 *
 *   1. npx tsx scripts/audit-format-fit.ts --sql
 *        prints three SELECTs, generated from the table:
 *        A. row counts per (topic_id, subtype, has computation) — exact for
 *           format membership, which depends on nothing else;
 *        B. the full rows that are number lines in a topic with the G5
 *           condition — those need the text, so they are judged row by row;
 *        C. the rows that fail on format, by id (the cleanup's selection).
 *   2. npx tsx scripts/audit-format-fit.ts --report counts.json nl-rows.json
 *        judges both results with formatFit (the same code serving uses) and
 *        prints the report as Markdown.
 */
import { readFileSync } from "node:fs";
import { TOPICS } from "../lib/map/topics";
import { TOPIC_FORMATS, allowedFormats, hasCondition, isServedTopic } from "../lib/map/topic-formats";
import { effectiveFormat, formatFit } from "../lib/exercises/format-fit";
import type { Exercise, ExerciseSubtype } from "../lib/exercises/types";

const CONDITIONED = Object.keys(TOPIC_FORMATS).filter((id) => hasCondition(id, "number-line-needs-operation"));
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** SQL for a row's format: its subtype, else "fill_in_blank" when it has a
 *  computation (effectiveFormat in format-fit.ts). */
const FORMAT_SQL = "coalesce(subtype, case when computation is not null then 'fill_in_blank' end)";

export function auditSql(): { counts: string; nlRows: string; violatingIds: string } {
  const allowedPairs = Object.keys(TOPIC_FORMATS)
    .filter(isServedTopic)
    .flatMap((id) => allowedFormats(id).map((f) => `(${q(id)}, ${q(f)})`));
  return {
    violatingIds: `-- Every row whose FORMAT the table does not allow (unserved topics allow
-- none). The G5 number-line rows are listed by step B, judged in code.
select id, topic_id, ${FORMAT_SQL} as format
from exercises
where topic_id is not null
  and (topic_id, ${FORMAT_SQL}) not in (values ${allowedPairs.join(", ")})
order by topic_id, format, id;`,
    counts: `select topic_id, subtype, (computation is not null) as has_computation, count(*)::int as n
from exercises
group by 1, 2, 3
order by 1, 2, 3;`,
    nlRows: `select id, subject, grade, type, subtype, topic_id, passage, question, choices, number_line, tiles, grouping, correct_answer, computation
from exercises
where subtype = 'number_line_placement' and topic_id in (${CONDITIONED.map(q).join(", ")})
order by topic_id, id;`,
  };
}

interface CountRow { topic_id: string | null; subtype: ExerciseSubtype | null; has_computation: boolean; n: number }
interface DbRow {
  id: string; subject: Exercise["subject"]; grade: Exercise["grade"]; type: Exercise["type"]; subtype: ExerciseSubtype | null; topic_id: string | null;
  passage: string | null; question: string; choices: string[] | null; number_line: Exercise["numberLine"] | null; tiles: Exercise["tiles"] | null;
  grouping: Exercise["grouping"] | null; correct_answer: string; computation: Exercise["computation"] | null;
}
const toExercise = (r: DbRow): Exercise => ({
  id: r.id, subject: r.subject, grade: r.grade, type: r.type, subtype: r.subtype ?? undefined, topic: "t", topicId: r.topic_id ?? undefined,
  passage: r.passage ?? undefined, question: r.question, choices: r.choices ?? undefined, numberLine: r.number_line ?? undefined,
  tiles: r.tiles ?? undefined, grouping: r.grouping ?? undefined, correctAnswer: r.correct_answer, computation: r.computation ?? undefined,
});

export interface TopicAudit {
  topicId: string;
  total: number;
  violations: number;
  /** format → count, for rows whose format the table does not allow (or "unserved topic"). */
  byFormat: Record<string, number>;
  /** Number lines refused by the G5 condition (placement with no operation). */
  nlNoOperation: number;
}

export function audit(counts: CountRow[], nlRows: DbRow[]): { topics: TopicAudit[]; bankTotal: number; unknownTopic: number; noTopic: number } {
  const byTopic = new Map<string, TopicAudit>();
  const get = (id: string) => {
    if (!byTopic.has(id)) byTopic.set(id, { topicId: id, total: 0, violations: 0, byFormat: {}, nlNoOperation: 0 });
    return byTopic.get(id)!;
  };
  let bankTotal = 0, unknownTopic = 0, noTopic = 0;
  for (const c of counts) {
    bankTotal += c.n;
    if (!c.topic_id) { noTopic += c.n; continue; }
    if (!TOPIC_FORMATS[c.topic_id]) { unknownTopic += c.n; continue; }
    const a = get(c.topic_id);
    a.total += c.n;
    // Membership — formatFit's first three refusals — needs only the
    // format (subtype, else a computation). The G5 condition is step B.
    const format = effectiveFormat({ subtype: c.subtype ?? undefined, computation: c.has_computation ? { operands: [], operators: [] } : undefined });
    const key = !isServedTopic(c.topic_id) ? `(unserved topic) ${format ?? "no format"}` : !format ? "no format" : allowedFormats(c.topic_id).includes(format) ? null : format;
    if (key) {
      a.byFormat[key] = (a.byFormat[key] ?? 0) + c.n;
      a.violations += c.n;
    }
  }
  for (const r of nlRows) {
    if (!r.topic_id || !TOPIC_FORMATS[r.topic_id]) continue;
    if (!formatFit(toExercise(r), r.topic_id).ok) {
      const a = get(r.topic_id);
      a.nlNoOperation++;
      a.violations++;
    }
  }
  const order = TOPICS.map((t) => t.id);
  return { topics: [...byTopic.values()].sort((x, y) => order.indexOf(x.topicId) - order.indexOf(y.topicId)), bankTotal, unknownTopic, noTopic };
}

export function renderReport(r: ReturnType<typeof audit>): string {
  const bad = r.topics.filter((t) => t.violations > 0);
  const total = bad.reduce((s, t) => s + t.violations, 0);
  const nl = r.topics.reduce((s, t) => s + t.nlNoOperation, 0);
  const lines = [
    `# Bank audit against the allowed-format table (read-only)`,
    ``,
    `Bank: ${r.bankTotal} rows. Violating: **${total}** (${((100 * total) / Math.max(1, r.bankTotal)).toFixed(1)}%) in ${bad.length} of ${r.topics.length} topics.` +
      (r.noTopic || r.unknownTopic ? ` Rows with no topic: ${r.noTopic}; with an unknown topic id: ${r.unknownTopic}.` : ""),
    `Of these, ${total - nl} fail on format membership (the rows query C lists by id) and ${nl} are number lines with no operation in an operations topic (G5; query B).`,
    ``,
    `| topic | rows | violating | servable after | by format |`,
    `|---|---:|---:|---:|---|`,
    ...r.topics.map((t) => {
      const parts = Object.entries(t.byFormat).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`);
      if (t.nlNoOperation) parts.push(`number line with no operation (G5) ${t.nlNoOperation}`);
      return `| ${t.topicId} | ${t.total} | ${t.violations} | ${t.total - t.violations} | ${parts.join(", ") || "—"} |`;
    }),
    ``,
  ];
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("audit-format-fit.ts")) {
  const [flag, a, b] = process.argv.slice(2);
  if (flag === "--sql") {
    const s = auditSql();
    console.log(`-- A. counts\n${s.counts}\n\n-- B. number lines under the G5 condition\n${s.nlRows}\n\n-- C. the violating rows by id (format membership)\n${s.violatingIds}`);
  } else if (flag === "--report" && a && b) {
    const parse = (p: string) => JSON.parse(readFileSync(p, "utf8"));
    console.log(renderReport(audit(parse(a), parse(b))));
  } else {
    console.error("usage: --sql | --report counts.json nl-rows.json");
    process.exit(1);
  }
}
