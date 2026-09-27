/**
 * Recovery in the exercise flow (lib/practice/recovery.ts and its wiring):
 * no raw error in front of the child, the verdict never replaced, the
 * question never re-asked by an error, progress kept.
 *
 * The QA report (2026-09-26, grade ב משחקים במילים): after a CORRECT
 * answer the screen showed "משהו השתבש"; its retry repeated the same
 * question, then worked.
 *
 * Run: npx tsx tests/exercise-recovery.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkWithRecovery, nextWithRetry } from "../lib/practice/recovery";
import { couldNotCheck, couldNotBuild, somethingBroke } from "../lib/guide/lines";
import { violatesConstitution } from "../lib/feedback/constitution";

let passed = 0;
const failures: string[] = [];
async function at(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}

/** A fake answer check: each call plays one scripted outcome. "verdict-then-cut" delivers the verdict, then the stream breaks. */
type Step = "ok" | "fail" | "verdict-then-cut";
function scripted(steps: Step[]) {
  let calls = 0;
  let sawVerdict = false;
  const shown: string[] = [];
  const check = async () => {
    const step = steps[Math.min(calls++, steps.length - 1)];
    if (step === "fail") throw new Error("503");
    sawVerdict = true;
    shown.push("verdict: correct");
    if (step === "verdict-then-cut") throw new Error("stream cut after the verdict");
  };
  return { check, calls: () => calls, sawVerdict: () => sawVerdict, shown };
}
const run = (s: ReturnType<typeof scripted>, stillCurrent = () => true) =>
  checkWithRecovery(s.check, { sawVerdict: s.sawVerdict, stillCurrent, retryMs: 5 });

console.log("checking an answer");
await at("QA repro: the verdict arrives, then the stream is cut → the verdict stands, no error, nothing re-asked", async () => {
  const s = scripted(["verdict-then-cut"]);
  assert.equal(await run(s), "verdict-kept");
  assert.equal(s.calls(), 1, "the answer is not sent again");
  assert.deepEqual(s.shown, ["verdict: correct"]);
});
await at("a check that fails before any verdict is retried once, quietly, with the same answer", async () => {
  const s = scripted(["fail", "ok"]);
  assert.equal(await run(s), "ok");
  assert.equal(s.calls(), 2);
});
await at("failing twice before any verdict → 'unchecked' (the answer is kept, never judged wrong)", async () => {
  const s = scripted(["fail", "fail"]);
  assert.equal(await run(s), "unchecked");
  assert.equal(s.calls(), 2, "exactly one quiet retry");
});
await at("the retry that delivers a verdict and then breaks still keeps that verdict", async () => {
  const s = scripted(["fail", "verdict-then-cut"]);
  assert.equal(await run(s), "verdict-kept");
});
await at("a child who moved on during the wait is not retried for", async () => {
  const s = scripted(["fail", "ok"]);
  assert.equal(await run(s, () => false), "superseded");
  assert.equal(s.calls(), 1);
});
await at("the healthy path is one call", async () => {
  const s = scripted(["ok"]);
  assert.equal(await run(s), "ok");
  assert.equal(s.calls(), 1);
});

console.log("\nfetching the next exercise");
const fetches = (kinds: string[]) => {
  let n = 0;
  return { fn: async () => ({ kind: kinds[Math.min(n++, kinds.length - 1)] }), calls: () => n };
};
await at("a failed fetch gets one quiet retry, and its exercise is shown", async () => {
  const f = fetches(["failed", "ok"]);
  assert.equal((await nextWithRetry(f.fn, 5)).kind, "ok");
  assert.equal(f.calls(), 2);
});
await at("failed twice → 'failed' (the calm retry state)", async () => {
  const f = fetches(["failed", "failed"]);
  assert.equal((await nextWithRetry(f.fn, 5)).kind, "failed");
  assert.equal(f.calls(), 2);
});
await at("the server's honest answers are not retried: no_content and try_again (it already retried)", async () => {
  for (const kind of ["none", "not_ready", "ok"]) {
    const f = fetches([kind]);
    assert.equal((await nextWithRetry(f.fn, 5)).kind, kind);
    assert.equal(f.calls(), 1, kind);
  }
});

console.log("\nwhat the child sees and hears");
await at("couldNotCheck (UDI REVIEW) obeys the feedback constitution and is not 'something broke'", () => {
  const l = couldNotCheck("נועה");
  assert.equal(violatesConstitution(l.text), null);
  assert.notEqual(l.text, somethingBroke("נועה").text);
  assert.notEqual(l.text, couldNotBuild("נועה").text);
});
const screen = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");
await at("the exercise screen never shows or says the generic 'something broke'", () => {
  assert.ok(!/somethingBroke/.test(screen));
});
await at("the screen's failure paths go through the recovery module", () => {
  assert.match(screen, /const outcome = await checkWithRecovery\(check, \{\s*sawVerdict: \(\) => sawVerdict,\s*stillCurrent: \(\) => gen === proseGenRef\.current,/);
  assert.match(screen, /const next = await nextWithRetry\(fetchNext, NEXT_RETRY_MS\);/);
});
await at("a failed check is never turned into a wrong answer; its retry checks the SAME answer", () => {
  assert.ok(!/setEvaluation\(\{ correct: false, feedback: lines\./.test(screen), "an error must not become a wrong-answer evaluation");
  assert.match(screen, /if \(outcome === "unchecked"\) \{[\s\S]{0,300}lastAnswerRef\.current = \{ value, opts \};[\s\S]{0,80}setCheckFailed\(true\);/);
  assert.match(screen, /const last = lastAnswerRef\.current;\s*if \(last\) void submitAnswer\(last\.value, last\.opts\);/);
});
await at("a failed load shows the calm 'couldn't build' line with a retry, spoken and shown", () => {
  assert.equal((screen.match(/loadFailed \? lines\.couldNotBuild\(kidName\) : lines\.noContent\(kidName\)/g) ?? []).length, 2);
  assert.match(screen, /\{loadFailed && \(\s*<button onClick=\{\(\) => loadNextExercise\(\)\}/);
});

console.log("\nthe server: nothing after the verdict can cut the stream");
const route = readFileSync(new URL("../app/api/tutor/route.ts", import.meta.url), "utf8");
await at("a failed kid lookup after the verdict is caught", () => {
  assert.match(route, /const kid = await kidPromise\.catch\(/);
});
await at("the after-verdict step falls back to the deterministic line instead of throwing", () => {
  assert.match(route, /await Promise\.all\(\[practicePromise, prosePromise\]\)\.catch\(/);
  assert.match(route, /return \[\{ practice: undefined, justFinishedTopic: false, kid: null \}, deterministic\(\)\] as const;/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
