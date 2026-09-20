/**
 * Cartesia answers concurrent requests beyond the plan's limit with
 * `429 concurrency_limited`, which /api/tutor reports as a 502. An
 * exercise screen fired five warm-up prefetches at once on mount and
 * measured 6/40 of them failing against the real API (0/16 with two).
 * prefetchSpeech now runs through a limiter: at most two in flight.
 *
 * What these guard:
 *  - the cap itself, measured by counting requests actually in flight on a
 *    fake network, not by trusting the limiter's own bookkeeping;
 *  - a slot is held until the response BODY is read (that is when Cartesia
 *    stops counting it);
 *  - a HUNG request cannot hold its slot forever. Nothing waits on a
 *    prefetch, so without a timeout two hung requests would silently end
 *    prefetching for the whole session and nobody would ever notice;
 *  - a failing request frees its slot;
 *  - live speaks never queue behind a saturated prefetch queue;
 *  - dedupe still holds, including for a line that is merely waiting.
 *
 * Run: npx tsx tests/prefetch-limiter.test.mts
 */
import assert from "node:assert/strict";
import { createLimiter } from "../lib/speech/limiter";

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

/** A task the test finishes by hand. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

console.log("the limiter");

await at("never runs more than `max` at once, and starts the rest first-in-first-out", async () => {
  const limiter = createLimiter(2);
  const gates = Array.from({ length: 6 }, () => deferred());
  const started: number[] = [];
  let running = 0;
  let peak = 0;
  const jobs = gates.map((g, i) =>
    limiter.run(async () => {
      started.push(i);
      running++;
      peak = Math.max(peak, running);
      await g.promise;
      running--;
    })
  );
  await sleep(5);
  assert.deepEqual(started, [0, 1], "only the first two may start");
  assert.equal(limiter.active, 2);
  assert.equal(limiter.queued, 4);

  gates[0].resolve();
  await sleep(5);
  assert.deepEqual(started, [0, 1, 2], "a freed slot starts the NEXT in line, not a later one");

  for (const g of gates) g.resolve();
  await Promise.all(jobs);
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5], "strict arrival order");
  assert.equal(peak, 2, "concurrency must never exceed the cap");
  assert.equal(limiter.active, 0);
  assert.equal(limiter.queued, 0);
});

await at("a rejecting task frees its slot instead of leaking it", async () => {
  const limiter = createLimiter(1);
  const failing = limiter.run(async () => {
    throw new Error("boom");
  });
  const after = limiter.run(async () => "ran");
  await assert.rejects(failing, /boom/);
  assert.equal(await after, "ran", "the task behind a failure must still run");
  assert.equal(limiter.active, 0);
});

await at("a task that throws synchronously also frees its slot", async () => {
  const limiter = createLimiter(1);
  const failing = limiter.run((() => {
    throw new Error("sync boom");
  }) as () => Promise<never>);
  const after = limiter.run(async () => "ran");
  await assert.rejects(failing, /sync boom/);
  assert.equal(await after, "ran");
});

t("a nonsensical cap is refused rather than silently deadlocking everything", () => {
  assert.throws(() => createLimiter(0));
  assert.throws(() => createLimiter(-1));
  assert.throws(() => createLimiter(1.5));
});

// ---------------------------------------------------------------------------
// prefetchSpeech against a fake network
// ---------------------------------------------------------------------------

class FakeAudio {
  src = "";
  muted = false;
  currentTime = 0;
  paused = true;
  preload = "";
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play() {
    this.paused = false;
    queueMicrotask(() => this.onplaying?.());
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
(globalThis as unknown as { window: Record<string, unknown> }).window = { addEventListener: () => {} };
(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Macintosh) Chrome/126", maxTouchPoints: 0 },
  configurable: true,
});
let urlCounter = 0;
(globalThis as unknown as { URL: typeof URL }).URL = Object.assign(URL, {
  createObjectURL: () => `blob:fake-${urlCounter++}`,
  revokeObjectURL: () => {},
});

/** How a given line behaves on the fake network. Default: ok. */
const behavior = new Map<string, "ok" | "hang" | "fail">();
const requested: string[] = [];
let inFlight = 0;
let peakInFlight = 0;
const BODY_MS = 25; // time to read the body — the part Cartesia counts

(globalThis as unknown as { fetch: typeof fetch }).fetch = ((_url: string, init: RequestInit) => {
  const { text } = JSON.parse(init.body as string) as { text: string };
  requested.push(text);
  inFlight++;
  peakInFlight = Math.max(peakInFlight, inFlight);
  const mode = behavior.get(text) ?? "ok";

  if (mode === "hang") {
    // Never answers — but, like a real fetch, ends when aborted.
    return new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => {
        inFlight--;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  }
  if (mode === "fail") {
    return sleep(BODY_MS).then(() => {
      inFlight--;
      return { ok: false, status: 502, blob: async () => new Blob([]) };
    });
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    // The slot is only truly free once the body has been read.
    blob: async () => {
      await sleep(BODY_MS);
      inFlight--;
      return new Blob(["audio"]);
    },
  });
}) as unknown as typeof fetch;

const { prefetchSpeech, speak, __speechTestHooks } = await import("../lib/speech/useSpeech");

/**
 * Between tests, wait until nothing from the last one is still holding a
 * slot. A hung request from a previous test keeps its slot until ITS
 * timeout — which was armed with that test's setting — and would silently
 * starve the next test's prefetches. That contamination once made a test
 * here pass vacuously, so reset() now refuses to proceed until idle.
 */
async function reset() {
  for (let i = 0; i < 300 && inFlight > 0; i++) await sleep(10);
  assert.equal(inFlight, 0, "a previous test left requests in flight — its cleanup is wrong");
  __speechTestHooks.reset();
  behavior.clear();
  requested.length = 0;
  peakInFlight = 0;
}
let n = 0;
const line = (tag = "l") => `${tag}-${++n}`;

console.log("\nprefetchSpeech, on a fake network");

await at("five prefetches at once (an exercise screen's mount) never exceed two in flight", async () => {
  await reset();
  const lines = Array.from({ length: 5 }, () => line("mount"));
  for (const l of lines) prefetchSpeech(l, "girl");
  await sleep(300);
  assert.equal(peakInFlight, 2, `expected a peak of exactly 2 in flight, saw ${peakInFlight}`);
  assert.deepEqual(requested, lines, "all five must still be fetched, in the order asked for");
});

await at("every prefetched line ends up cached: speaking it afterwards costs no new request", async () => {
  await reset();
  const lines = Array.from({ length: 5 }, () => line("warm"));
  for (const l of lines) prefetchSpeech(l, "girl");
  await sleep(300);
  const before = requested.length;
  for (const l of lines) speak(l, "exercise", "girl");
  await sleep(60);
  assert.equal(requested.length, before, "a warmed line must be a cache hit");
});

await at("a line asked for twice, even while it is still waiting its turn, is fetched once", async () => {
  await reset();
  const a = line("dup");
  const fillers = Array.from({ length: 3 }, () => line("fill"));
  for (const f of fillers) prefetchSpeech(f, "girl"); // saturate; the third is queued
  prefetchSpeech(a, "girl");
  prefetchSpeech(a, "girl");
  prefetchSpeech(a, "girl");
  await sleep(300);
  assert.equal(requested.filter((r) => r === a).length, 1);
});

await at("a failed prefetch frees its slot: the queue behind it still drains", async () => {
  await reset();
  const bad = [line("bad"), line("bad")];
  for (const b of bad) behavior.set(b, "fail");
  const good = Array.from({ length: 3 }, () => line("good"));
  for (const l of [...bad, ...good]) prefetchSpeech(l, "girl");
  await sleep(300);
  assert.deepEqual(new Set(requested), new Set([...bad, ...good]), "everything behind the failures must still be requested");
});

console.log("\na hung request must not starve the queue");

await at("two hung prefetches are aborted at the timeout and the queue drains behind them", async () => {
  await reset();
  __speechTestHooks.setPrefetchTimeoutMs(60);
  const hung = [line("hung"), line("hung")];
  for (const h of hung) behavior.set(h, "hang");
  const behind = [line("behind"), line("behind")];
  for (const l of [...hung, ...behind]) prefetchSpeech(l, "girl");

  await sleep(30);
  assert.deepEqual(requested, hung, "while both slots are held by hung requests, nothing else may start");

  await sleep(250);
  assert.deepEqual(requested.slice(2), behind, "once the hung requests time out, the queue must move");
  assert.equal(inFlight, 0, "nothing left in flight");
});

console.log("\nlive speaks are never queued behind warm-ups");

await at("with both prefetch slots held, a live speak still goes out immediately", async () => {
  await reset();
  __speechTestHooks.setPrefetchTimeoutMs(120); // set BEFORE the hung requests arm their timers
  const hung = [line("hung"), line("hung")];
  for (const h of hung) behavior.set(h, "hang");
  for (const h of hung) prefetchSpeech(h, "girl");
  await sleep(20);
  assert.equal(requested.length, 2, "both slots are now held");

  const liveLine = line("live");
  speak(liveLine, "exercise", "girl");
  await sleep(20);
  assert.ok(requested.includes(liveLine), "a live line must not wait for a warm-up to finish");
  await sleep(200); // let the hung ones time out so the next test starts clean
});

await at("a line cached live while its prefetch was still queued is not fetched a second time", async () => {
  await reset();
  const a = line("race");
  const hung = [line("hung"), line("hung")];
  for (const h of hung) behavior.set(h, "hang");
  __speechTestHooks.setPrefetchTimeoutMs(150);
  for (const h of hung) prefetchSpeech(h, "girl");
  prefetchSpeech(a, "girl"); // queued behind the two hung ones
  speak(a, "exercise", "girl"); // a live speak gets there first and caches it
  await sleep(60);
  // PRECONDITION — without it this test can pass having tested nothing:
  // the two hung prefetches hold both slots, so the queued prefetch of `a`
  // has NOT started, and the only request for `a` so far is the live one.
  assert.deepEqual(requested, [...hung, a], "setup wrong: the queued prefetch must still be waiting, the live fetch already done");
  await sleep(300); // the hung ones time out; the queued prefetch's turn comes
  assert.equal(requested.filter((r) => r === a).length, 1, "the queued prefetch must notice it is already cached and skip");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
