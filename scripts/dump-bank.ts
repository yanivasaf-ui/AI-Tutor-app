/**
 * READ-ONLY dump of the exercise bank to one JSON file (feeds external QA).
 * It only ever SELECTs.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/dump-bank.ts --out bank.json
 *   npx tsx scripts/dump-bank.ts --sql     the same read as one SELECT, for the SQL editor
 *
 * The bank is behind row-level security, so the public (publishable) key
 * reads nothing; the service-role key is read from the environment and never
 * printed. Without it, use --sql.
 *
 * Fields per row: id, subject, grade, topic_id, topic, subtype, format (the
 * subtype, or "fill_in_blank" for an untyped row with a computation — as
 * serving reads it), question, choices, correct_answer, created_at.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const COLUMNS = "id, subject, grade, topic_id, topic, subtype, computation, question, choices, correct_answer, created_at";

export const DUMP_SQL = `select coalesce(json_agg(json_build_object(
  'id', id, 'subject', subject, 'grade', grade, 'topic_id', topic_id, 'topic', topic,
  'subtype', subtype, 'format', coalesce(subtype, case when computation is not null then 'fill_in_blank' end),
  'question', question, 'choices', choices, 'correct_answer', correct_answer, 'created_at', created_at
) order by topic_id, subtype, id), '[]'::json) as bank from exercises;`;

interface Row {
  id: string;
  subject: string;
  grade: string;
  topic_id: string | null;
  topic: string;
  subtype: string | null;
  computation: unknown;
  question: string;
  choices: string[] | null;
  correct_answer: string;
  created_at: string;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--sql") {
    console.log(DUMP_SQL);
    return;
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[dump-bank] needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (the public key reads nothing under RLS). Or use --sql.");
    process.exit(1);
  }
  const out = args[args.indexOf("--out") + 1];
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("exercises").select(COLUMNS).order("id").range(from, from + 999);
    if (error) throw new Error(`read failed at ${from}: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const bank = rows.map(({ computation, ...r }) => ({ ...r, format: r.subtype ?? (computation ? "fill_in_blank" : null) }));
  const json = JSON.stringify(bank, null, 1);
  if (args.includes("--out") && out) {
    writeFileSync(out, json);
    console.error(`[dump-bank] ${bank.length} rows -> ${out}`);
  } else {
    console.log(json);
  }
}

if (process.argv[1]?.endsWith("dump-bank.ts")) {
  main().catch((err) => {
    console.error("[dump-bank]", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
