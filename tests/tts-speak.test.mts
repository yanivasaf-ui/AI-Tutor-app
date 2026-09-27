/**
 * The speak action's server side (lib/tts/speak.ts): Cartesia failures are
 * classified by stage and scope, retried once when that can help, and
 * never become a 502 (QA sweep 2026-09-26: 118/177 speak calls returned
 * 502 tts_failed — Cartesia was answering 402 quota_exceeded).
 *
 * Cartesia is faked at the network (globalThis.fetch); `live: true` skips
 * the niqqud model call, so nothing real is called.
 *
 * Run: npx tsx tests/tts-speak.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.CARTESIA_API_KEY = "test-key-never-sent";
import { speakWithFallback, classifyUpstream, __ttsTestHooks } from "../lib/tts/speak";

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

type Reply = Response | Error | "hang";
let replies: Reply[] = [];
let calls = 0;
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (_url: string, init: { signal?: AbortSignal }) => {
  const r = replies[Math.min(calls++, replies.length - 1)];
  if (r === "hang") {
    // AbortSignal.timeout's timer does not hold the event loop open; this one does, until the abort lands.
    const hold = setTimeout(() => {}, 5_000);
    return new Promise((_, reject) =>
      init.signal?.addEventListener("abort", () => {
        clearTimeout(hold);
        reject(new DOMException("aborted", "AbortError"));
      })
    );
  }
  if (r instanceof Error) throw r;
  return r.clone();
}) as unknown as typeof fetch;
const audio = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
const cartesia = (status: number, error_code: string) => new Response(JSON.stringify({ error_code, message: "…" }), { status });
// Cartesia's real answer on 2026-09-27, as observed (message shortened).
const QUOTA = () => cartesia(402, "quota_exceeded");
const logged: string[] = [];
const realError = console.error;
console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
function fresh(r: Reply[]) {
  __ttsTestHooks.reset();
  __ttsTestHooks.setTimeouts(80, 5);
  replies = r;
  calls = 0;
  logged.length = 0;
}
const say = (text = "שלום נועה", signal?: AbortSignal) => speakWithFallback(text, "girl", signal, { live: true });

console.log("classification");
await at("402 / quota_exceeded and 401/403 are the account (session); 429, 5xx are this line; other 4xx rejected", () => {
  assert.deepEqual(classifyUpstream(402, "quota_exceeded"), { scope: "session", reason: "quota", status: 402, retryAfterSec: 300 });
  assert.equal(classifyUpstream(400, "quota_exceeded").reason, "quota", "the error code wins over the status");
  assert.equal(classifyUpstream(401, undefined).reason, "credentials");
  assert.equal(classifyUpstream(403, undefined).scope, "session");
  assert.deepEqual(classifyUpstream(429, "concurrency_limited"), { scope: "line", reason: "rate_limited", status: 429 });
  assert.equal(classifyUpstream(503, undefined).reason, "upstream_error");
  assert.equal(classifyUpstream(400, "invalid_transcript").reason, "rejected");
});

console.log("\nthe outage as QA met it: credit exhausted");
await at("402 quota_exceeded → session failure, logged by stage, and the breaker opens", async () => {
  fresh([QUOTA()]);
  const r = await say();
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.failure, { stage: "upstream", scope: "session", reason: "quota", status: 402, retryAfterSec: 300 });
  assert.equal(calls, 1, "a quota answer is not retried");
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^\[tts\] stage=upstream scope=session reason=quota status=402 attempt=1 — cloud voice off for 300s$/);
});
await at("while the breaker is open no request is made at all (no niqqud call, no Cartesia call)", async () => {
  // not fresh(): the breaker from the previous test is still open
  calls = 0;
  const results = await Promise.all(Array.from({ length: 20 }, () => say()));
  assert.equal(calls, 0);
  for (const r of results) {
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.failure.stage, "breaker");
      assert.equal(r.failure.scope, "session");
      assert.ok(r.failure.retryAfterSec! > 0 && r.failure.retryAfterSec! <= 300);
    }
  }
});
await at("once the cooldown passes, Cartesia is asked again (restored credit is heard)", async () => {
  fresh([QUOTA()]);
  await say();
  __ttsTestHooks.reset(); // clears the breaker, as the cooldown ending would
  replies = [audio()];
  calls = 0;
  const r = await say();
  assert.equal(r.ok, true);
  assert.equal(calls, 1);
});

console.log("\nline failures: one retry where it can help");
await at("429 concurrency_limited then audio → the line is spoken (2 calls)", async () => {
  fresh([cartesia(429, "concurrency_limited"), audio()]);
  const r = await say();
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
  assert.match(logged[0], /stage=upstream scope=line reason=rate_limited status=429 attempt=1 — retrying once/);
});
await at("429 twice → a line failure; no breaker, the next line tries again", async () => {
  fresh([cartesia(429, "concurrency_limited")]);
  const r = await say();
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual([r.failure.scope, r.failure.reason], ["line", "rate_limited"]);
  assert.equal(calls, 2);
  replies = [audio()];
  calls = 0;
  assert.equal((await say()).ok, true);
  assert.equal(calls, 1);
});
await at("a Cartesia 5xx and a network error are retried; a 400 is not", async () => {
  fresh([cartesia(500, "internal"), audio()]);
  assert.equal((await say()).ok, true);
  fresh([new TypeError("fetch failed"), audio()]);
  assert.equal((await say()).ok, true);
  fresh([cartesia(400, "invalid_transcript")]);
  const r = await say();
  assert.equal(calls, 1);
  if (!r.ok) assert.equal(r.failure.reason, "rejected");
});
await at("a retry that meets the quota still opens the breaker", async () => {
  fresh([cartesia(429, "concurrency_limited"), QUOTA()]);
  await say();
  calls = 0;
  const r = await say();
  assert.equal(calls, 0);
  if (!r.ok) assert.equal(r.failure.stage, "breaker");
});
await at("a request Cartesia never answers times out as stage=request reason=timeout (line)", async () => {
  fresh(["hang"]);
  const r = await say();
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual([r.failure.stage, r.failure.scope, r.failure.reason], ["request", "line", "timeout"]);
  assert.equal(calls, 1, "a timeout is not retried: the child has already waited");
});
await at("the client going away is not a TTS failure: it propagates, nothing is logged as a failure", async () => {
  fresh(["hang"]);
  const ctrl = new AbortController();
  const p = say("שלום", ctrl.signal);
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(p);
  assert.equal(logged.length, 0);
});
await at("no key → stage=config, session, no retry-after (off for good)", async () => {
  fresh([audio()]);
  const key = process.env.CARTESIA_API_KEY;
  delete process.env.CARTESIA_API_KEY;
  const r = await say();
  process.env.CARTESIA_API_KEY = key;
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.failure, { stage: "config", scope: "session", reason: "not_configured" });
  assert.equal(calls, 0);
});
await at("the logs never carry the line's text (lines address the child by name)", async () => {
  fresh([cartesia(429, "concurrency_limited")]);
  await say("שלום נועה, בואי נקרא");
  assert.ok(logged.length > 0);
  for (const l of logged) assert.ok(!/נועה|שלום/.test(l), l);
});

console.log("\nthe route");
const route = readFileSync(new URL("../app/api/tutor/route.ts", import.meta.url), "utf8");
await at("the speak action answers every failure with a 503 carrying scope and reason — never a 502", () => {
  assert.ok(!/status: 502/.test(route), "a 502 is still reachable in the route");
  assert.ok(!/tts_failed/.test(route));
  assert.match(route, /result = await speakWithFallback\(text, character, signal,/);
  assert.match(route, /if \(signal.aborted\) return new Response\(null, \{ status: 499 \}\);/);
  assert.match(route, /\{ error: reason === "not_configured" \? "tts_not_configured" : "tts_unavailable", scope, reason \},\s*\{ status: 503, headers: retryAfterSec \? \{ "Retry-After": String\(retryAfterSec\) \} : undefined \}/);
});

console.error = realError;
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
