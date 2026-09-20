/**
 * feat: local UX wins item 5, server half. The overlap-turns prefetch asks
 * for the next exercise while the current one is still on screen. The
 * server's own "already attempted" exclusion cannot see an unanswered
 * exercise, so without help it can hand the kid the SAME question twice in
 * a row. The client now sends the ids it has shown; these tests prove the
 * server honours them and treats the list as the untrusted input it is.
 *
 * A fake Supabase client stands in for the find_reusable_exercise RPC:
 * this is about what happens to the rows it returns.
 *
 * Run: npx tsx tests/exercise-exclude.test.mts
 */
import assert from "node:assert/strict";
import { MAX_EXCLUDE_IDS, findReusableExercise, sanitizeExcludeIds } from "../lib/exercises/store";

let passed = 0;
const failures: string[] = [];
async function at(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}
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

const row = (id: string) => ({
  id,
  subject: "math",
  grade: "ב",
  type: "multiple_choice",
  subtype: null,
  topic: "חיבור",
  topic_id: "math-b-addition",
  passage: null,
  question: `שאלה ${id}`,
  choices: ["1", "2"],
  number_line: null,
  tiles: null,
  grouping: null,
  correct_answer: "1",
  difficulty: 2,
});

function client(rows: ReturnType<typeof row>[], opts?: { error?: boolean }) {
  return {
    rpc: async () => (opts?.error ? { data: null, error: { message: "boom" } } : { data: rows, error: null }),
  } as never;
}

const find = (rows: ReturnType<typeof row>[], exclude?: string[]) =>
  findReusableExercise(client(rows), "math", "ב", "kid-1", undefined, 2, exclude);

console.log("sanitizing the client's list");

t("junk is dropped: non-arrays, non-strings, empties, oversized strings", () => {
  assert.equal(sanitizeExcludeIds(undefined), undefined);
  assert.equal(sanitizeExcludeIds(null), undefined);
  assert.equal(sanitizeExcludeIds("not-an-array"), undefined);
  assert.equal(sanitizeExcludeIds({ 0: "a", length: 1 }), undefined);
  assert.deepEqual(sanitizeExcludeIds(["ok", 5, null, {}, [], "", "x".repeat(65)]), ["ok"]);
});

t("an empty or all-junk list means 'no exclusion', so behaviour stays exactly as before", () => {
  assert.equal(sanitizeExcludeIds([]), undefined);
  assert.equal(sanitizeExcludeIds([1, 2, 3]), undefined);
});

t("duplicates collapse and the list is capped, so a hostile client cannot send a huge one", () => {
  assert.deepEqual(sanitizeExcludeIds(["a", "a", "b"]), ["a", "b"]);
  const many = Array.from({ length: 500 }, (_, i) => `id-${i}`);
  assert.equal(sanitizeExcludeIds(many)?.length, MAX_EXCLUDE_IDS);
});

t("odd-but-harmless strings pass through as plain ids and never as code", () => {
  const weird = ["__proto__", "constructor", "'; drop table exercises;--", "a b"];
  assert.deepEqual(sanitizeExcludeIds(weird), weird);
});

console.log("\nserving");

await at("an excluded exercise is NEVER returned, however many times we ask", async () => {
  const rows = [row("A"), row("B"), row("C")];
  for (let i = 0; i < 300; i++) {
    const got = await find(rows, ["A"]);
    assert.ok(got && got.id !== "A", `handed back the excluded exercise on draw ${i}`);
  }
});

await at("the exercise on screen plus earlier ones can all be excluded at once", async () => {
  const rows = [row("A"), row("B"), row("C"), row("D")];
  for (let i = 0; i < 200; i++) {
    const got = await find(rows, ["A", "B", "C"]);
    assert.equal(got?.id, "D");
  }
});

await at("when EVERY candidate is excluded there is nothing reusable — null, so the caller generates one", async () => {
  assert.equal(await find([row("A"), row("B")], ["A", "B"]), null);
});

await at("without an exclusion list any candidate can be served: behaviour is unchanged", async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add((await find([row("A"), row("B"), row("C")]))!.id);
  assert.deepEqual([...seen].sort(), ["A", "B", "C"]);
});

await at("an empty exclusion list is the same as none", async () => {
  const got = await find([row("A")], []);
  assert.equal(got?.id, "A");
});

await at("an RPC error or an empty page is still simply 'nothing reusable'", async () => {
  assert.equal(await findReusableExercise(client([], { error: true }), "math", "ב", "k", undefined, 2, ["A"]), null);
  assert.equal(await find([], ["A"]), null);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
