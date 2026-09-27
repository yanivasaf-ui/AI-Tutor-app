/**
 * The guarded format cleanup script (scripts/format-cleanup.ts): the id list
 * is exactly the audited one, and the transaction can only delete those
 * rows, only all of them, and only if no child's attempt history would go
 * with them.
 *
 * Run: npx tsx tests/format-cleanup.test.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CLEANUP_IDS, EXPECTED_ROWS, IDS_FINGERPRINT, cleanupSql, dashed, precheckSql, readbackSql } from "../scripts/format-cleanup";
import { CONTENT_FIXES } from "../scripts/bank-content-fixes";

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
const ids = CLEANUP_IDS.map(dashed);

console.log("the id list");
t(`${EXPECTED_ROWS} distinct, well-formed ids, sorted`, () => {
  assert.equal(ids.length, EXPECTED_ROWS);
  assert.equal(new Set(ids).size, EXPECTED_ROWS);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual([...ids].sort(), ids);
});
t("its md5 is the fingerprint the database computed for the fresh selection", () => {
  assert.equal(createHash("md5").update(ids.join(",")).digest("hex"), IDS_FINGERPRINT);
});
t("includes the rows the reports name (the clock row, the 11 G5 number lines); excludes rows that stay", () => {
  for (const id of ["f55c6c4b-5db0-4b8d-8c09-bd86aa90f76b", "24def940-0846-4f9c-9952-1c3153522551", "8eacaab3-a047-4985-960a-7ceb6539a695"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("311e3b11-70d8-4e6c-9302-d8d32448bb72"), "6×4 cubes is allowed");
  assert.ok(!ids.some((id) => id.startsWith("0189baee")), "the ×÷ number line that passes G5 stays");
  for (const f of CONTENT_FIXES) assert.ok(!ids.includes(f.id), `${f.id} is served (fixed, not removed)`);
});

console.log("\nthe transaction");
const sql = cleanupSql();
t("one transaction; the only DELETE is by the materialized id list", () => {
  assert.equal((sql.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((sql.match(/^commit;$/gm) ?? []).length, 1);
  const deletes = (sql.match(/^\s*delete\s+from\b[^;]*;/gim) ?? []).map((d) => d.trim());
  assert.deepEqual(deletes, ["delete from exercises e using cleanup_ids c where e.id = c.id;"]);
  assert.ok(!/\b(update|drop|truncate|alter)\s/i.test(sql.replace(/on commit drop/, "")), "nothing else is changed");
});
t("every guard raises (which rolls the whole transaction back) before or after the DELETE", () => {
  const guards = [
    /if fp is distinct from '5150c3b5300b11ae995146ec1890dea6' then raise exception/,
    /if n_rows <> 688 then raise exception/,
    /if n_violating <> 688 then raise exception/,
    /if n_attempts <> 0 then raise exception .*ON DELETE CASCADE/,
    /get diagnostics n_deleted = row_count;\s*if n_deleted <> 688 then raise exception/,
  ];
  for (const g of guards) assert.match(sql, g);
  assert.ok(sql.indexOf("n_attempts <> 0") < sql.indexOf("delete from exercises"), "the cascade guard runs before the DELETE");
});
t("all 688 ids go into the transaction's list", () => {
  for (const id of ids) assert.ok(sql.includes(`'${id}'::uuid`), id);
});

console.log("\nthe read-only companions");
t("--precheck and --readback are single SELECTs over the same list", () => {
  for (const q of [precheckSql(), readbackSql()]) {
    assert.match(q, /^with ids\(id\) as \(values/);
    assert.ok(!/\b(delete|update|insert|drop|truncate|alter|begin|commit)\b/i.test(q));
    assert.equal((q.match(/::uuid\)/g) ?? []).length, EXPECTED_ROWS);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
