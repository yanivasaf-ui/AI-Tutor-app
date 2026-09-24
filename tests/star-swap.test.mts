/**
 * Star -> apple migration for the group-division bank rows.
 *
 * Fixtures are the 19 REAL rows read from the production exercises table on
 * 2026-09-24 (question text verbatim; items rebuilt from their counts).
 * The properties that matter: nothing star-shaped survives, the mechanic is
 * untouched (same item count, same groups, so the answer cannot move), the
 * one row that needs a person is the one that gets an override, and a row
 * the migration does not understand is REFUSED rather than guessed at.
 *
 * Run: npx tsx tests/star-swap.test.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OVERRIDES, SwapError, rollbackSql, swapRow, updateSql, type BankRow } from "../lib/exercises/starSwap";

let passed = 0;
const failures: string[] = [];
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}

const row = (id: string, topic: string, question: string, n: number, groups: number): BankRow => ({
  id, topic_id: topic, question, grouping: { items: Array(n).fill("⭐"), groupCount: groups },
});

const REAL: BankRow[] = [
  row("d674eee4-d774-41e6-80e3-02de2b83c5b9", "math-a-addition-subtraction", "לאורה יש כוכבים. עליה לחלק אותם ל-3 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 12, 3),
  row("121fa759-a7f7-4bbc-8f3a-997836c2964b", "math-a-numbers-0-100", "חלקו את כל הכוכבים ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 12, 4),
  row("85457cdf-f0b1-4e8c-841a-5f89982a3f9e", "math-a-numbers-0-100", "חלקו את הכוכבים ל-2 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 10, 2),
  row("5b22a03b-7c64-43ed-9ccc-ba744e7c038b", "math-a-time", "לאורי יש 12 כוכבים ⭐. הוא רוצה לחלק אותם ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 12, 4),
  row("5825bed1-f1a3-4c9d-b36f-67d054102311", "math-b-arithmetic", "חלקו את הכוכבים ל-3 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 12, 3),
  row("66e0f0c9-bbe7-47a9-a20e-6f4162d1f83e", "math-b-arithmetic", "חלקו את הכוכבים ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 12, 4),
  row("4ee090c4-d47a-4f49-98d7-9a2fda07bbd5", "math-b-numbers-0-1000", "לאורי יש 12 כוכבים. הוא רוצה לחלק אותם ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 12, 4),
  row("830cac2a-b22c-44fb-b5f9-b21e6ba87c3c", "math-b-numbers-0-1000", "לרוני יש 10 כוכבים. היא רוצה לחלק אותם ל-5 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 10, 5),
  row("cdcb4f8e-d24a-48f2-8b93-007b0fc95c06", "math-b-numbers-0-1000", "חלקו את הכוכבים ל-2 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 10, 2),
  row("f835d2ba-86ab-4749-9f5b-be7d52ce083f", "math-b-numbers-0-1000", "חלקו את הכוכבים ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 12, 4),
  row("0ab6ad55-7ab8-4fa5-9839-f5a203f8d778", "math-g-arithmetic", "חלקו את הכוכבים ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 12, 4),
  row("40f9b8dc-3f84-4edf-9de5-a23bb10b3ade", "math-g-gematria", "רונית כתבה את האות ו' (שערכה 6) 3 פעמים ברצף. חלקי את כל הכוכבים שמייצגים את הערך הכולל ל-3 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 18, 3),
  row("c89ad2fa-9045-4da2-bae9-a57daa90b1a9", "math-g-gematria", "לפניך 15 כוכבים. חלקי אותם ל-3 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 15, 3),
  row("5d320279-92a3-45f5-9519-cc458fa25ae2", "math-g-multiplication-division", "חלקו את הכוכבים ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 20, 4),
  row("a8246147-8c61-44bc-9766-8c1b307464bc", "math-g-multiplication-division", "בחנות צעצועים יש 18 כוכבים נוצצים. המוכרת צריכה לחלק אותם באופן שווה ל-6 קופסאות מתנה. כמה כוכבים יהיו בכל קופסה?", 18, 6),
  row("dd418ca1-c66b-42d0-9a00-f01f29a4b1b1", "math-g-multiplication-division", "חלקי את הכוכבים ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 12, 4),
  row("5be99c5c-0bfc-4f66-b88b-8a5e3e7eec91", "math-g-numbers-0-10000", "חלקו את הכוכבים ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 16, 4),
  row("bbbb71ef-5cff-49bf-9b55-282d51bf3af0", "math-g-numbers-0-10000", "חלקו את הכוכבים ל-4 קבוצות שוות. כמה כוכבים יהיו בכל קבוצה?", 20, 4),
  row("e264b428-98e7-49b0-81e3-537087c6f851", "math-g-numbers-0-10000", "חלקו את הכוכבים ל-4 קבוצות שוות. כמה כוכבים יש בכל קבוצה?", 12, 4),
];

console.log("all 19 real rows");

t("there are 19 fixtures, and every one has something to swap", () => {
  assert.equal(REAL.length, 19);
  for (const r of REAL) assert.ok(swapRow(r), `${r.id} was skipped`);
});

t("nothing star-shaped survives — not the word, not the emoji, in text or items", () => {
  for (const r of REAL) {
    const { row: out } = swapRow(r)!;
    assert.ok(!/כוכב/.test(out.question), `${r.id}: ${out.question}`);
    assert.ok(!out.question.includes("⭐"), r.id);
    assert.ok(!out.grouping.items.includes("⭐"), r.id);
    assert.ok(out.grouping.items.every((i) => i === "🍎"), `${r.id}: items must all be apples`);
  }
});

t("the MECHANIC is untouched: same item count and same groups, so the answer cannot move", () => {
  for (const r of REAL) {
    const { row: out } = swapRow(r)!;
    assert.equal(out.grouping.items.length, r.grouping.items.length, r.id);
    assert.equal(out.grouping.groupCount, r.grouping.groupCount, r.id);
    assert.equal(out.grouping.items.length % out.grouping.groupCount, 0, `${r.id} must still divide evenly`);
  }
});

t("only question and grouping change — id, topic and everything else pass through", () => {
  for (const r of REAL) {
    const { row: out } = swapRow(r)!;
    assert.equal(out.id, r.id);
    assert.equal(out.topic_id, r.topic_id);
  }
});

console.log("\nthe Hebrew");

t("the word swaps with its prefix intact: הכוכבים -> התפוחים", () => {
  const { row: out } = swapRow(REAL[2])!;
  assert.equal(out.question, "חלקו את התפוחים ל-2 קבוצות שוות. כמה תפוחים יהיו בכל קבוצה?");
});

t("the inline emoji in the one row that has it is swapped too", () => {
  const { row: out } = swapRow(REAL[3])!;
  assert.equal(out.question, "לאורי יש 12 תפוחים 🍎. הוא רוצה לחלק אותם ל-4 קבוצות שוות. כמה תפוחים יהיו בכל קבוצה?");
});

t("numerals, names and the rest of the sentence are left exactly as they were", () => {
  const { row: out } = swapRow(REAL[7])!;
  assert.equal(out.question, "לרוני יש 10 תפוחים. היא רוצה לחלק אותם ל-5 קבוצות שוות. כמה תפוחים יהיו בכל קבוצה?");
});

t("a row with no numeral and a preposition swaps cleanly", () => {
  assert.equal(swapRow(REAL[0])!.row.question, "לאורה יש תפוחים. עליה לחלק אותם ל-3 קבוצות שוות. כמה תפוחים יהיו בכל קבוצה?");
});

console.log("\nthe one row that needs a person");

t("the sparkling-stars row gets its hand-written override, and only that row", () => {
  const overridden = REAL.filter((r) => swapRow(r)!.overridden).map((r) => r.id);
  assert.deepEqual(overridden, ["a8246147-8c61-44bc-9766-8c1b307464bc"]);
  assert.deepEqual(Object.keys(OVERRIDES), overridden, "no unused overrides lying around");
});

t("the override reads as coherent Hebrew about apples — no star, no sparkle, no toy shop", () => {
  const q = swapRow(REAL[14])!.row.question;
  assert.equal(q, OVERRIDES["a8246147-8c61-44bc-9766-8c1b307464bc"]);
  assert.ok(!/נוצצ|צעצוע|כוכב/.test(q), q);
  assert.match(q, /18 תפוחים/, "the count in the text still matches the 18 items");
});

t("without the override that row FAILS CLOSED instead of shipping 'sparkling apples'", () => {
  const saved = { ...OVERRIDES };
  for (const k of Object.keys(OVERRIDES)) delete (OVERRIDES as Record<string, string>)[k];
  try {
    assert.throws(() => swapRow(REAL[14]), SwapError);
    assert.throws(() => swapRow(REAL[14]), /נוצצ/);
  } finally {
    Object.assign(OVERRIDES as Record<string, string>, saved);
  }
});

console.log("\nrefusing what it does not understand");

t("a SINGULAR star the plural swap does not reach is caught, not shipped", () => {
  // "כוכב" (one star) is not "כוכבים", so the mechanical rule leaves it
  // behind. The surviving-star check is what stops that row being written.
  const singular: BankRow = row("z", "t", "יש כוכב אחד ועוד כוכבים. חלקו ל-2 קבוצות שוות.", 4, 2);
  assert.throws(() => swapRow(singular), /a star survived the swap/);
});

t("a row mixing stars with another object is refused, not guessed at", () => {
  const mixed: BankRow = { ...REAL[1], grouping: { items: ["⭐", "🍎", "⭐", "🍎"], groupCount: 2 } };
  assert.throws(() => swapRow(mixed), /refusing to guess/);
});

t("a row with nothing to swap is left alone (returns null)", () => {
  const apples: BankRow = { id: "x", topic_id: "t", question: "חלקו את התפוחים ל-2 קבוצות", grouping: { items: ["🍎", "🍎"], groupCount: 2 } };
  assert.equal(swapRow(apples), null);
});

t("running it twice changes nothing the second time (idempotent)", () => {
  for (const r of REAL) {
    const once = swapRow(r)!.row;
    assert.equal(swapRow(once), null, `${r.id} is not stable under a second run`);
  }
});

console.log("\nthe SQL");

t("every UPDATE is guarded on the OLD question, so a stale migration cannot clobber a newer edit", () => {
  for (const r of REAL) {
    const sql = updateSql(r, swapRow(r)!.row);
    assert.ok(sql.includes(`where id = '${r.id}' and question = $q$${r.question}$q$`), sql);
    assert.ok(sql.startsWith("update public.exercises set question = "));
    assert.ok(sql.endsWith(";"));
  }
});

t("the rollback is the exact inverse: guarded on the NEW text, restoring the old", () => {
  const before = REAL[3];
  const after = swapRow(before)!.row;
  const undo = rollbackSql(before, after);
  assert.ok(undo.includes(`set question = $q$${before.question}$q$`));
  assert.ok(undo.includes(`and question = $q$${after.question}$q$`), "guarded on the swapped text");
  assert.ok(undo.includes("⭐"), "the stars come back");
});

t("it writes only question and grouping — never id, topic, answer or counters", () => {
  const sql = updateSql(REAL[0], swapRow(REAL[0])!.row);
  const setClause = sql.slice(sql.indexOf(" set ") + 5, sql.indexOf(" where "));
  assert.deepEqual(
    setClause.split(/, (?=[a-z_]+ = )/).map((p) => p.split(" = ")[0]),
    ["question", "grouping"]
  );
  for (const forbidden of ["correct_answer", "times_used", "times_correct", "topic_id", "difficulty", "subtype"]) {
    assert.ok(!setClause.includes(forbidden), `the UPDATE sets ${forbidden}`);
  }
});

t("a dollar sign inside a question cannot break out of its quoting", () => {
  const nasty: BankRow = { id: "y", topic_id: "t", question: "כמה $q$ כוכבים", grouping: { items: ["⭐", "⭐"], groupCount: 2 } };
  const sql = updateSql(nasty, swapRow(nasty)!.row);
  assert.ok(sql.includes("$qq$"), "the tag must be widened when the text contains the default one");
});

console.log("\nthe script: dry run, and it never executes anything");

t("the CLI reports 19 changes, 1 override, writes both SQL files, and touches no database", () => {
  const dir = mkdtempSync(join(tmpdir(), "starswap-"));
  const dump = join(dir, "rows.json");
  const apply = join(dir, "apply.sql");
  const undo = join(dir, "undo.sql");
  writeFileSync(dump, JSON.stringify(REAL));
  const out = execFileSync(
    "npx",
    ["tsx", "scripts/swap-star-to-apple.ts", "--dump", dump, "--emit-sql", apply, "--rollback-sql", undo],
    { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname }
  );
  assert.match(out, /19 rows in dump, 19 to change, 0 refused/);
  assert.match(out, /HAND-WRITTEN OVERRIDE/);
  assert.match(out, /Nothing was executed/);
  assert.equal(readFileSync(apply, "utf8").trim().split("\n").length, 19);
  assert.equal(readFileSync(undo, "utf8").trim().split("\n").length, 19);
});

t("the script has no way to reach a database, a network or an env secret", () => {
  for (const rel of ["scripts/swap-star-to-apple.ts", "lib/exercises/starSwap.ts"]) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    for (const sink of ["fetch(", "supabase", "createClient", "process.env", "XMLHttpRequest", "WebSocket"]) {
      assert.ok(!src.includes(sink), `${rel} reaches ${sink}`);
    }
  }
});

t("no mechanic or reward code is touched by this change", () => {
  const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname });
  // The migration is new files only; the widget stays exactly as it was.
  assert.equal(git(["diff", "--name-only", "HEAD", "--", "components/exercises/GroupingWidget.tsx"]).trim(), "");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
