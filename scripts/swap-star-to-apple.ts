/**
 * Star -> apple migration for the group-division bank rows. DOES NOT TOUCH
 * A DATABASE: it reads a JSON dump, prints what would change, and writes
 * SQL files for a person to review and run.
 *
 * STATUS: APPLIED to production on 2026-09-24 (19 rows). See
 * docs/investigations/star-to-apple/APPLIED.md. The commit that introduced
 * this script says "not yet applied"; that was true then. The query below
 * can no longer regenerate the dump, because no star rows remain — the
 * committed docs/investigations/star-to-apple/rows-before.json is the
 * preserved input, and rollback.sql beside it is the undo.
 *
 * Run: npx tsx scripts/swap-star-to-apple.ts --dump <rows.json> \
 *        [--emit-sql <apply.sql>] [--rollback-sql <undo.sql>]
 *
 * The dump is the result of:
 *   select id, topic_id, question, grouping from public.exercises
 *   where type = 'grouping' and grouping::text like '%⭐%';
 * (Same --dump convention as scripts/audit-topic-fit.ts: RLS gives a plain
 * script no read access, so the rows are exported first.)
 *
 * Every UPDATE is guarded on the row's OLD question text, so a stale
 * migration is a no-op on any row edited since the dump. Exits 1 on any
 * row it will not swap, having written nothing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { OVERRIDES, SwapError, rollbackSql, swapRow, updateSql, type BankRow } from "../lib/exercises/starSwap";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dumpPath = arg("dump");
if (!dumpPath || !existsSync(dumpPath)) {
  console.error("Pass --dump <rows.json> (see the header for the query that produces it).");
  process.exit(2);
}

const rows: BankRow[] = JSON.parse(readFileSync(dumpPath, "utf8"));
const changes: { before: BankRow; after: BankRow; overridden: boolean }[] = [];
const problems: string[] = [];

for (const before of rows) {
  try {
    const out = swapRow(before);
    if (out) changes.push({ before, after: out.row, overridden: out.overridden });
  } catch (e) {
    if (e instanceof SwapError) problems.push(e.message);
    else throw e;
  }
}

console.log(`[star-swap] ${rows.length} rows in dump, ${changes.length} to change, ${problems.length} refused\n`);
for (const { before, after, overridden } of changes) {
  console.log(`${before.id}  ${before.topic_id ?? "(no topic)"}${overridden ? "   ** HAND-WRITTEN OVERRIDE **" : ""}`);
  console.log(`  - ${before.question}`);
  console.log(`  + ${after.question}`);
  console.log(`    items: ${before.grouping.items.length} × ${before.grouping.items[0]} -> ${after.grouping.items.length} × ${after.grouping.items[0]}, groupCount ${after.grouping.groupCount} (unchanged)`);
}

if (problems.length > 0) {
  console.error(`\n[star-swap] REFUSED — nothing written:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const applyPath = arg("emit-sql");
const undoPath = arg("rollback-sql");
if (applyPath) {
  writeFileSync(applyPath, changes.map((c) => updateSql(c.before, c.after)).join("\n") + "\n");
  console.log(`\n[star-swap] wrote ${changes.length} guarded UPDATEs to ${applyPath}`);
}
if (undoPath) {
  writeFileSync(undoPath, changes.map((c) => rollbackSql(c.before, c.after)).join("\n") + "\n");
  console.log(`[star-swap] wrote the inverse to ${undoPath}`);
}
if (!applyPath && !undoPath) console.log("\n[star-swap] dry run — pass --emit-sql / --rollback-sql to write the SQL.");
console.log(`[star-swap] hand-written overrides in play: ${Object.keys(OVERRIDES).length}. Nothing was executed.`);
