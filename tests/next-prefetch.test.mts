/**
 * feat: local UX wins item 5 — fetch the next exercise while the kid works
 * on the current one.
 *
 * The speed-up is easy. What is under test is that it can never make an
 * answer path WRONG:
 *  - an exercise built for a level the kid has since left is never used;
 *  - the exercise already on screen (or any already shown) is never
 *    handed back as "the next one";
 *  - while the latest answer's practice update has not landed, whether the
 *    level moved is unknown — so the prefetch is not used and nothing
 *    waits;
 *  - a hung request cannot hold "next" hostage.
 *
 * Run: npx tsx tests/next-prefetch.test.mts
 */
import assert from "node:assert/strict";
import {
  createNextPrefetcher,
  effectiveLevel,
  levelStillMatches,
  type NextFetchResult,
} from "../lib/exercises/nextPrefetch";
import type { Exercise } from "../lib/exercises/types";
import type { PracticeSummary } from "../lib/practice/state";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ex = (id: string) => ({ id, question: `q-${id}` }) as unknown as Exercise;
const level = (l: 1 | 2 | 3 | null): PracticeSummary => ({ level: l, diagnosing: l === null, change: null });

/** A fake network whose responses the test controls. */
function net(opts?: { ignoreAbort?: boolean }) {
  const calls: { exclude: string[]; aborted: boolean }[] = [];
  const waiting: { resolve: (r: NextFetchResult) => void; call: (typeof calls)[number] }[] = [];
  const fetchNext = (excludeIds: string[], signal: AbortSignal) => {
    const call = { exclude: [...excludeIds], aborted: false };
    calls.push(call);
    return new Promise<NextFetchResult>((resolve, reject) => {
      waiting.push({ resolve, call });
      signal.addEventListener("abort", () => {
        call.aborted = true;
        // A real server does not take back a response it has already
        // started sending; with ignoreAbort the late result still arrives.
        if (!opts?.ignoreAbort) reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  };
  return {
    fetchNext,
    calls,
    /** Answer the oldest still-open request. */
    respond(r: NextFetchResult) {
      waiting.shift()?.resolve(r);
    },
  };
}

console.log("levels");

t("a kid still being placed is served at the default level, exactly as the server does", () => {
  assert.equal(effectiveLevel(level(null)), 2);
  assert.equal(effectiveLevel(level(3)), 3);
  assert.equal(effectiveLevel(undefined), null, "no practice state at all: nothing adapts");
  assert.equal(effectiveLevel(null), null);
});

t("placement landing on the level it was already served at does NOT invalidate the prefetch", () => {
  // Built at 2 (diagnosing => default 2); the diagnostic ends and places the kid at 2.
  assert.equal(levelStillMatches(2, level(2)), true);
});

t("a level change of either direction, or a placement elsewhere, does", () => {
  assert.equal(levelStillMatches(2, level(3)), false, "level up");
  assert.equal(levelStillMatches(2, level(1)), false, "level down");
  assert.equal(levelStillMatches(effectiveLevel(level(null)), level(3)), false, "diagnostic placed the kid at 3");
});

t("with no practice state on either side, levels trivially match", () => {
  assert.equal(levelStillMatches(null, undefined), true);
});

console.log("\nstarting");

await at("one request per current exercise, however often start() is called", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  p.start("A", level(2));
  p.start("A", level(2));
  assert.equal(n.calls.length, 1);
  p.cancel();
});

await at("the request carries the current exercise's id, so the server cannot hand it straight back", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  assert.deepEqual(n.calls[0].exclude, ["A"]);
  p.cancel();
});

await at("starting for a NEW current exercise abandons the old request", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  p.start("B", level(2));
  assert.equal(n.calls[0].aborted, true, "the stale request must be aborted");
  assert.equal(n.calls.length, 2);
  assert.ok(n.calls[1].exclude.includes("A") && n.calls[1].exclude.includes("B"));
  p.cancel();
});

console.log("\ntaking it — when it is safe");

await at("unchanged level + settled answer: the prefetched exercise is handed over", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  n.respond({ kind: "ok", exercise: ex("B") });
  await sleep(5);
  assert.equal(p.status(), "ready");
  const got = await p.take(level(2), true);
  assert.equal(got?.id, "B");
  assert.equal(p.status(), "idle", "it is spent once taken");
});

await at("an in-flight request is JOINED rather than raced by a fresh one", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  assert.equal(p.status(), "inflight");
  const taking = p.take(level(2), true);
  await sleep(10);
  n.respond({ kind: "ok", exercise: ex("B") });
  assert.equal((await taking)?.id, "B");
  assert.equal(n.calls.length, 1, "joining must not start a second request");
});

console.log("\ntaking it — when it is NOT safe");

await at("the level moved up: the stale exercise is discarded", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  n.respond({ kind: "ok", exercise: ex("B") });
  await sleep(5);
  assert.equal(await p.take(level(3), true), null, "built for level 2, kid is now at 3");
});

await at("the level dropped after a second miss: the stale exercise is discarded", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  n.respond({ kind: "ok", exercise: ex("B") });
  await sleep(5);
  assert.equal(await p.take(level(1), true), null);
});

await at("the diagnostic placed the kid: an exercise built at the default level is discarded if placement moved them", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(null)); // diagnosing
  n.respond({ kind: "ok", exercise: ex("B") });
  await sleep(5);
  assert.equal(await p.take(level(3), true), null);
});

await at("the answer has NOT settled: nothing is used AND nothing waits", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  const t0 = performance.now();
  const got = await p.take(level(2), false); // request still in flight, never answered
  assert.equal(got, null);
  assert.ok(performance.now() - t0 < 50, "an unsettled answer must fall straight through to the ordinary path");
  assert.equal(n.calls[0].aborted, true);
});

await at("the server hands back the exercise already on screen: refused", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  n.respond({ kind: "ok", exercise: ex("A") });
  await sleep(5);
  assert.equal(await p.take(level(2), true), null, "asking for the next question and getting THIS one is a bug, not an exercise");
});

await at("a repeat of anything shown earlier in the visit is refused, and never announced", async () => {
  const n = net();
  const announced: string[] = [];
  const p = createNextPrefetcher({ fetchNext: n.fetchNext, onReady: (e) => announced.push(e.id) });
  p.markServed("EARLIER");
  p.start("A", level(2));
  n.respond({ kind: "ok", exercise: ex("EARLIER") });
  await sleep(5);
  assert.deepEqual(announced, [], "a refused exercise must not get its speech warmed either");
  assert.equal(await p.take(level(2), true), null);
});

await at("a hung request cannot hold 'next' hostage: it gives up and lets the ordinary path run", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext, takeWaitMs: 60 });
  p.start("A", level(2));
  const t0 = performance.now();
  const got = await p.take(level(2), true); // never answered
  const waited = performance.now() - t0;
  assert.equal(got, null);
  assert.ok(waited >= 50 && waited < 250, `should wait about the cap, waited ${Math.round(waited)}ms`);
  assert.equal(n.calls[0].aborted, true);
});

await at("failed and empty results are simply 'no prefetch'", async () => {
  for (const r of [{ kind: "failed" }, { kind: "none" }] as NextFetchResult[]) {
    const n = net();
    const p = createNextPrefetcher({ fetchNext: n.fetchNext });
    p.start("A", level(2));
    n.respond(r);
    await sleep(5);
    assert.equal(await p.take(level(2), true), null);
  }
});

await at("a request that throws is contained", async () => {
  const p = createNextPrefetcher({
    fetchNext: () => Promise.reject(new Error("offline")),
  });
  p.start("A", level(2));
  await sleep(5);
  assert.equal(await p.take(level(2), true), null);
});

console.log("\nacross a whole visit");

await at("a chain never repeats: every later request excludes everything already shown", async () => {
  const n = net();
  const p = createNextPrefetcher({ fetchNext: n.fetchNext });
  p.start("A", level(2));
  n.respond({ kind: "ok", exercise: ex("B") });
  await sleep(5);
  assert.equal((await p.take(level(2), true))?.id, "B");

  p.start("B", level(2)); // B is now on screen
  assert.deepEqual([...n.calls[1].exclude].sort(), ["A", "B"]);
  n.respond({ kind: "ok", exercise: ex("A") }); // a misbehaving server offers A again
  await sleep(5);
  assert.equal(await p.take(level(2), true), null, "A was shown two exercises ago and must not come back");
});

await at("onReady fires once, for the wanted exercise only", async () => {
  const n = net({ ignoreAbort: true });
  const announced: string[] = [];
  const p = createNextPrefetcher({ fetchNext: n.fetchNext, onReady: (e) => announced.push(e.id) });
  p.start("A", level(2));
  p.start("B", level(2)); // supersedes A's request
  n.respond({ kind: "ok", exercise: ex("STALE") }); // answer to the aborted request, arriving late
  n.respond({ kind: "ok", exercise: ex("C") });
  await sleep(5);
  assert.ok(!announced.includes("STALE"), "a superseded request's result must not be announced");
  assert.deepEqual(announced, ["C"], "only the wanted request's exercise is announced, exactly once");
});

await at("cancel() aborts in-flight work and nothing is announced afterwards", async () => {
  const n = net();
  const announced: string[] = [];
  const p = createNextPrefetcher({ fetchNext: n.fetchNext, onReady: (e) => announced.push(e.id) });
  p.start("A", level(2));
  p.cancel();
  n.respond({ kind: "ok", exercise: ex("B") });
  await sleep(5);
  assert.equal(n.calls[0].aborted, true);
  assert.deepEqual(announced, []);
  assert.equal(p.status(), "idle");
  assert.equal(await p.take(level(2), true), null);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
