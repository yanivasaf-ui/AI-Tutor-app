/**
 * feat: STT timing marks (instrumentation only — "do not tune STT yet").
 *
 * Two things have to be true, and this file pins both:
 *  1. the numbers are RIGHT — each mark sits on the event it names, the
 *     derived legs add up, the server's vendor time is read from
 *     Server-Timing, and no transcript or audio ever reaches the log;
 *  2. it changes NOTHING — the cloud session behaves exactly as it did:
 *     a tap still uploads nothing, a 401 still retries once, an error still
 *     falls back, callbacks fire in the same order, and a broken logger
 *     cannot touch a child's answer.
 *
 * The cloud session is driven for real, against a fake mic, MediaRecorder
 * and fetch (the fetch fake behaves like the route: it reads the whole body,
 * takes a moment, then answers with a Server-Timing header). Real timers, so
 * a few of these take ~1s.
 *
 * Run: npx tsx tests/stt-timing.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  __clearSttTimingLogForTests,
  createSttTrace,
  formatSttTimingLine,
  getSttTimingLog,
  logSttTiming,
  parseServerTimingVendor,
  subscribeSttTimingLog,
  summarizeSttTrace,
  type SttMark,
  type SttTimingSummary,
} from "../lib/stt/sttTiming";

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

// ---------------------------------------------------------------- pure pieces
console.log("Server-Timing");
t("reads the vendor entry, alone or among others, integer or fractional", () => {
  assert.equal(parseServerTimingVendor("vendor;dur=830"), 830);
  assert.equal(parseServerTimingVendor("app;dur=5, vendor;dur=830, db;dur=2"), 830);
  assert.equal(parseServerTimingVendor("vendor;desc=openai;dur=12.6"), 13);
  assert.equal(parseServerTimingVendor('vendor;dur="41"'), 41);
});
t("anything else is null, never NaN or 0", () => {
  for (const h of [null, undefined, "", "app;dur=5", "vendor", "vendor;dur=", "vendor;dur=abc", "vendor;dur=-4", "vendors;dur=9"]) {
    assert.equal(parseServerTimingVendor(h as string | null), null, String(h));
  }
});

console.log("\nderiving the legs");
const marks = (o: Partial<Record<SttMark, number>>) => o;
const FULL = marks({ stop: 1000, "recorder-stopped": 1040, "upload-closed": 1041, response: 2200, transcript: 2203 });
t("each leg is the gap between the two marks it is named for", () => {
  const s = summarizeSttTrace(FULL, { engine: "cloud", vendorMs: 900 }, "ok", 0);
  assert.deepEqual(
    [s.totalMs, s.flushMs, s.closeMs, s.waitMs, s.parseMs],
    [1203, 40, 1, 1159, 3]
  );
});
t("the legs add up to the total", () => {
  const s = summarizeSttTrace(FULL, { engine: "cloud" }, "ok", 0);
  assert.equal(s.flushMs! + s.closeMs! + s.waitMs! + s.parseMs!, s.totalMs);
});
t("net+server is the wait minus the vendor's own time", () => {
  const s = summarizeSttTrace(FULL, { engine: "cloud", vendorMs: 900 }, "ok", 0);
  assert.equal(s.netServerMs, 1159 - 900);
});
t("net+server is null — not negative, not guessed — when the vendor time is missing or exceeds the wait", () => {
  assert.equal(summarizeSttTrace(FULL, { engine: "cloud" }, "ok", 0).netServerMs, null);
  assert.equal(summarizeSttTrace(FULL, { engine: "cloud", vendorMs: 5000 }, "ok", 0).netServerMs, null);
  assert.equal(summarizeSttTrace(FULL, { engine: "cloud", vendorMs: 1159 }, "ok", 0).netServerMs, 0);
});
t("a missing mark makes only the legs that need it null (no NaN anywhere)", () => {
  const s = summarizeSttTrace(marks({ stop: 10 }), { engine: "cloud" }, "cloud-failed", 0);
  assert.equal(s.totalMs, null);
  assert.equal(s.flushMs, null);
  assert.equal(s.waitMs, null);
  for (const v of Object.values(s)) assert.ok(!(typeof v === "number" && Number.isNaN(v)));
});
t("facts pass through: mode, held, bytes, status, retry flag, when the stream opened", () => {
  const s = summarizeSttTrace(FULL, { engine: "cloud", mode: "streamed", heldMs: 2103.6, bytes: 4321, status: 200, retried401: true, streamOpenedAfterMs: 401.2 }, "ok", 7);
  assert.deepEqual([s.mode, s.heldMs, s.bytes, s.status, s.retried401, s.streamOpenedAfterMs, s.at], ["streamed", 2104, 4321, 200, true, 401, 7]);
});

console.log("\nthe trace and the log");
t("marks use the injected clock; last write wins (a retried response replaces the first)", () => {
  let now = 0;
  __clearSttTimingLogForTests();
  const tr = createSttTrace("cloud", () => now);
  now = 100; tr.mark("stop");
  now = 300; tr.mark("response");
  now = 900; tr.mark("response");
  now = 910; tr.mark("transcript");
  tr.finish("ok");
  const s = getSttTimingLog().at(-1)!;
  assert.equal(s.totalMs, 810);
  assert.equal(s.parseMs, 10);
});
t("finish counts once: a second call (cancel after done, onend after result) logs nothing", () => {
  __clearSttTimingLogForTests();
  const tr = createSttTrace("cloud");
  tr.finish("ok");
  tr.finish("cancelled");
  assert.equal(getSttTimingLog().length, 1);
  assert.equal(getSttTimingLog()[0].outcome, "ok");
});
t("the log is a short ring, and subscribers are told on each entry", () => {
  __clearSttTimingLogForTests();
  let notified = 0;
  const off = subscribeSttTimingLog(() => notified++);
  for (let i = 0; i < 20; i++) createSttTrace("cloud").finish("ok");
  off();
  createSttTrace("cloud").finish("ok");
  assert.equal(notified, 20);
  assert.ok(getSttTimingLog().length <= 8, "bounded");
});
t("the console line carries the [stt-timing] prefix and the legs, and never any words", () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    const s = summarizeSttTrace(FULL, { engine: "cloud", mode: "streamed", heldMs: 2100, bytes: 4321, status: 200, vendorMs: 900 }, "ok", 0);
    logSttTiming(s);
  } finally {
    console.log = orig;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[stt-timing\] engine=cloud upload=streamed outcome=ok total=1203ms flush=40ms close=1ms wait=1159ms vendor=900ms net\+srv=259ms parse=3ms held=2100ms bytes=4321 status=200/);
});
t("a summary has no field that could hold a transcript or audio", () => {
  const s: SttTimingSummary = summarizeSttTrace(FULL, { engine: "cloud" }, "ok", 0);
  for (const [k, v] of Object.entries(s)) assert.ok(typeof v !== "string" || ["engine", "mode", "outcome"].includes(k), `${k} is a free string`);
});
t("a console that throws, a listener that throws, cannot escape finish()", () => {
  const orig = console.log;
  console.log = () => {
    throw new Error("console broke");
  };
  const off = subscribeSttTimingLog(() => {
    throw new Error("listener broke");
  });
  try {
    assert.doesNotThrow(() => createSttTrace("cloud").finish("ok"));
  } finally {
    console.log = orig;
    off();
  }
});
t("each layer contains its own failures: logSttTiming survives a throwing console and still records and notifies", () => {
  __clearSttTimingLogForTests();
  const orig = console.log;
  console.log = () => {
    throw new Error("console broke");
  };
  let notified = 0;
  const off = subscribeSttTimingLog(() => notified++);
  try {
    assert.doesNotThrow(() => logSttTiming(summarizeSttTrace(FULL, { engine: "cloud" }, "ok", 0)));
  } finally {
    console.log = orig;
    off();
  }
  assert.equal(getSttTimingLog().length, 1, "the entry is kept even though the console threw");
  assert.equal(notified, 1);
});
t("a throwing listener does not stop the entry being recorded or the other listeners hearing it", () => {
  __clearSttTimingLogForTests();
  let heard = 0;
  const off1 = subscribeSttTimingLog(() => {
    throw new Error("listener broke");
  });
  const off2 = subscribeSttTimingLog(() => heard++);
  try {
    assert.doesNotThrow(() => logSttTiming(summarizeSttTrace(FULL, { engine: "cloud" }, "ok", 0)));
  } finally {
    off1();
    off2();
  }
  assert.equal(heard, 1);
  assert.equal(getSttTimingLog().length, 1);
});
t("a clock that throws cannot escape mark()", () => {
  const tr = createSttTrace("cloud", () => {
    throw new Error("clock broke");
  });
  assert.doesNotThrow(() => tr.mark("stop"));
});
t("a summary that cannot be computed cannot escape finish()", () => {
  const tr = createSttTrace("cloud");
  tr.info({ heldMs: { valueOf() { throw new Error("bad fact"); } } as unknown as number });
  assert.doesNotThrow(() => tr.finish("ok"));
});
t("formatSttTimingLine omits what it does not know", () => {
  const line = formatSttTimingLine(summarizeSttTrace({}, { engine: "browser" }, "no-speech", 0));
  assert.equal(line, "engine=browser outcome=no-speech");
});

// ------------------------------------------------- the real cloud session
console.log("\nthe cloud session, driven for real");

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
let fetchCalls: { url: string; bodyKind: string }[] = [];
let fetchImpl: Fetch = async () => new Response("{}");
const FLUSH_MS = 30;
const SERVER_MS = 120;
const VENDOR_MS = 80;

class FakeRecorder {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
    setTimeout(() => this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)]) }), 5);
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(512)]) });
      this.onstop?.();
    }, FLUSH_MS);
  }
}
const track = { enabled: true, readyState: "live", stop() {} };
const fakeStream = { getAudioTracks: () => [track], getTracks: () => [track] };

Object.defineProperty(globalThis, "window", { value: { addEventListener() {} }, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia: async () => fakeStream } }, configurable: true });
Object.defineProperty(globalThis, "MediaRecorder", { value: FakeRecorder, configurable: true });
const RealRequest = globalThis.Request;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const body = init.body as unknown;
  fetchCalls.push({ url, bodyKind: body instanceof ReadableStream ? "stream" : "blob" });
  // Behave like the route: take the whole body first, then think, then answer.
  if (body instanceof ReadableStream) {
    const r = body.getReader();
    while (!(await r.read()).done) {
      /* drain */
    }
  }
  return fetchImpl(url, init);
}) as typeof fetch;

const okResponse = (text = "שלום עולם") =>
  new Response(JSON.stringify({ text }), { status: 200, headers: { "Server-Timing": `vendor;dur=${VENDOR_MS}` } });
const slow = (make: () => Response): Fetch => async () => {
  await sleep(SERVER_MS);
  return make();
};

const { cloudSpeechProvider } = await import("../lib/stt/provider");

interface PressResult {
  events: string[];
  transcript: string | null;
  summary: SttTimingSummary;
}
async function press(opts: { holdMs: number; streaming: boolean; cancelAfterStopMs?: number }): Promise<PressResult> {
  // Turning Request off is how supportsRequestStreaming() reports "not here": the
  // assembled-at-release path every Safari takes.
  Object.defineProperty(globalThis, "Request", { value: opts.streaming ? RealRequest : undefined, configurable: true });
  __clearSttTimingLogForTests();
  fetchCalls = [];
  const events: string[] = [];
  let transcript: string | null = null;
  let done!: () => void;
  const ended = new Promise<void>((r) => (done = r));
  const session = cloudSpeechProvider.start({
    onResult: (tx) => {
      events.push("result");
      transcript = tx;
    },
    onEnd: () => {
      events.push("end");
      done();
    },
    onError: (r) => events.push("error:" + r),
    onCaptureEnd: () => events.push("captureEnd"),
  });
  await sleep(opts.holdMs);
  session.stop();
  if (opts.cancelAfterStopMs !== undefined) {
    await sleep(opts.cancelAfterStopMs);
    session.cancel?.();
    await sleep(50);
  } else {
    await ended;
  }
  return { events, transcript, summary: getSttTimingLog().at(-1)! };
}

await at("assembled upload (Safari's path): every mark lands and the legs are sane", async () => {
  fetchImpl = slow(() => okResponse());
  const r = await press({ holdMs: 500, streaming: false });
  const s = r.summary;
  assert.equal(s.engine, "cloud");
  assert.equal(s.mode, "assembled");
  assert.equal(s.outcome, "ok");
  assert.equal(s.status, 200);
  assert.equal(s.vendorMs, VENDOR_MS, "read from the route's Server-Timing header");
  assert.ok(s.flushMs! >= FLUSH_MS - 5 && s.flushMs! < FLUSH_MS + 60, `flush ${s.flushMs}`);
  assert.ok(s.waitMs! >= SERVER_MS - 5 && s.waitMs! < SERVER_MS + 100, `wait ${s.waitMs}`);
  assert.ok(s.netServerMs! >= 0 && s.netServerMs! < s.waitMs!, `net+srv ${s.netServerMs}`);
  assert.ok(Math.abs(s.flushMs! + s.closeMs! + s.waitMs! + s.parseMs! - s.totalMs!) <= 2, "legs add up to stop→transcript (each is rounded)");
  assert.ok(s.heldMs! >= 490 && s.heldMs! < 600, `held ${s.heldMs}`);
  assert.equal(s.bytes, 2048 + 512);
  assert.equal(s.streamOpenedAfterMs, null, "no stream was opened");
  assert.deepEqual(fetchCalls, [{ url: "/api/stt", bodyKind: "blob" }]);
});
await at("streamed upload: mode says so, and the stream opened at ~CLOUD_MIN_MS into the press", async () => {
  fetchImpl = slow(() => okResponse());
  const r = await press({ holdMs: 600, streaming: true });
  const s = r.summary;
  assert.equal(s.mode, "streamed");
  assert.equal(s.outcome, "ok");
  assert.ok(s.streamOpenedAfterMs! >= 395 && s.streamOpenedAfterMs! < 520, `stream opened at ${s.streamOpenedAfterMs}`);
  assert.ok(Math.abs(s.flushMs! + s.closeMs! + s.waitMs! + s.parseMs! - s.totalMs!) <= 2, "legs add up to stop→transcript (each is rounded)");
  assert.deepEqual(fetchCalls, [{ url: "/api/stt", bodyKind: "stream" }]);
});
await at("BEHAVIOUR UNCHANGED: callbacks fire in the same order and the transcript arrives untouched", async () => {
  fetchImpl = slow(() => okResponse("שלום עולם"));
  const r = await press({ holdMs: 450, streaming: false });
  assert.deepEqual(r.events, ["captureEnd", "result", "end"]);
  assert.equal(r.transcript, "שלום עולם");
});
await at("BEHAVIOUR UNCHANGED: the words never appear in what was logged", async () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    fetchImpl = slow(() => okResponse("שלום עולם"));
    await press({ holdMs: 450, streaming: false });
  } finally {
    console.log = orig;
  }
  const mine = lines.filter((l) => l.startsWith("[stt-timing]"));
  assert.equal(mine.length, 1);
  assert.ok(!mine[0].includes("שלום"), "a transcript reached the log");
});
await at("BEHAVIOUR UNCHANGED: a tap (held under CLOUD_MIN_MS) uploads NOTHING and is logged as a tap", async () => {
  fetchImpl = slow(() => okResponse());
  const r = await press({ holdMs: 100, streaming: false });
  assert.equal(fetchCalls.length, 0, "a tap must never be uploaded");
  assert.deepEqual(r.events, ["captureEnd", "end"], "no result, ends cleanly");
  assert.equal(r.summary.outcome, "tap");
  assert.equal(r.summary.totalMs, null, "there was no transcript to time");
});
await at("BEHAVIOUR UNCHANGED: a 401 is retried once (and the retry is flagged), a second answer wins", async () => {
  let n = 0;
  fetchImpl = async () => {
    await sleep(20);
    return n++ === 0 ? new Response("{}", { status: 401 }) : okResponse();
  };
  const r = await press({ holdMs: 450, streaming: false });
  assert.equal(fetchCalls.length, 2, "exactly one retry");
  assert.equal(r.summary.retried401, true);
  assert.equal(r.summary.outcome, "ok");
  assert.equal(r.summary.status, 200, "the status is the retry's, not the 401");
  assert.ok(r.summary.waitMs! >= 400, "the retry pause is inside the wait, and the flag says why");
});
await at("BEHAVIOUR UNCHANGED: a 502 reports cloud-failed to the caller and to the log", async () => {
  fetchImpl = async () => new Response(JSON.stringify({ error: "stt_failed" }), { status: 502 });
  const r = await press({ holdMs: 450, streaming: false });
  assert.deepEqual(r.events, ["captureEnd", "error:cloud-failed", "end"]);
  assert.equal(r.summary.outcome, "cloud-failed");
  assert.equal(r.summary.status, 502);
});
await at("BEHAVIOUR UNCHANGED: a 503 is cloud-unavailable", async () => {
  fetchImpl = async () => new Response("{}", { status: 503 });
  const r = await press({ holdMs: 450, streaming: false });
  assert.deepEqual(r.events, ["captureEnd", "error:cloud-unavailable", "end"]);
  assert.equal(r.summary.outcome, "cloud-unavailable");
});
await at("BEHAVIOUR UNCHANGED: silence ({text:''}) is no-speech, not ok", async () => {
  fetchImpl = async () => okResponse("");
  const r = await press({ holdMs: 450, streaming: false });
  assert.deepEqual(r.events, ["captureEnd", "error:no-speech", "end"]);
  assert.equal(r.summary.outcome, "no-speech");
});
await at("a press cancelled mid-upload is logged as cancelled and delivers nothing", async () => {
  fetchImpl = slow(() => okResponse());
  fetchImpl = async (_u, init) =>
    new Promise((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    });
  const r = await press({ holdMs: 450, streaming: false, cancelAfterStopMs: 150 });
  assert.ok(!r.events.includes("result"));
  assert.equal(r.summary.outcome, "cancelled");
});
await at("a press cancelled WHILE HELD (before release) is still logged, once", async () => {
  fetchImpl = slow(() => okResponse());
  Object.defineProperty(globalThis, "Request", { value: undefined, configurable: true });
  __clearSttTimingLogForTests();
  fetchCalls = [];
  const events: string[] = [];
  const session = cloudSpeechProvider.start({ onResult: () => events.push("result"), onEnd: () => events.push("end"), onCaptureEnd: () => {} });
  await sleep(150);
  session.cancel?.();
  await sleep(120);
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(getSttTimingLog().map((e) => e.outcome), ["cancelled"]);
});
await at("a broken logger cannot cost the kid their answer", async () => {
  fetchImpl = slow(() => okResponse("שלום עולם"));
  const orig = console.log;
  console.log = () => {
    throw new Error("console broke");
  };
  const off = subscribeSttTimingLog(() => {
    throw new Error("listener broke");
  });
  let r: PressResult;
  try {
    r = await press({ holdMs: 450, streaming: false });
  } finally {
    console.log = orig;
    off();
  }
  assert.deepEqual(r.events, ["captureEnd", "result", "end"]);
  assert.equal(r.transcript, "שלום עולם");
});

// ------------------------------------------------- the browser engine
console.log("\nthe browser engine");
await at("stop → result is timed, outcome ok, and the callbacks are unchanged", async () => {
  class FakeRecognition {
    lang = "";
    interimResults = false;
    continuous = false;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    start() {}
    stop() {
      setTimeout(() => {
        this.onresult?.({ results: [[{ transcript: "שלום" }]] });
        this.onend?.();
      }, 60);
    }
  }
  (globalThis as unknown as { window: Record<string, unknown> }).window.webkitSpeechRecognition = FakeRecognition;
  const { browserSpeechProvider } = await import("../lib/stt/provider");
  __clearSttTimingLogForTests();
  const events: string[] = [];
  let done!: () => void;
  const ended = new Promise<void>((r) => (done = r));
  const session = browserSpeechProvider.start({
    onResult: () => events.push("result"),
    onEnd: () => {
      events.push("end");
      done();
    },
    onCaptureEnd: () => events.push("captureEnd"),
  });
  await sleep(50);
  session.stop();
  await ended;
  assert.deepEqual(events, ["captureEnd", "result", "end"]);
  const s = getSttTimingLog();
  assert.equal(s.length, 1, "exactly one summary, not one per event");
  assert.equal(s[0].engine, "browser");
  assert.equal(s[0].outcome, "ok");
  assert.ok(s[0].totalMs! >= 55 && s[0].totalMs! < 200, `total ${s[0].totalMs}`);
});

// ------------------------------------------------- wiring
console.log("\nwiring (source tripwire)");
const provider = readFileSync(new URL("../lib/stt/provider.ts", import.meta.url), "utf8");
const line = readFileSync(new URL("../components/debug/AudioDebugLine.tsx", import.meta.url), "utf8");
t("stop is marked inside stop(), after the already-stopped guard", () => {
  const body = provider.slice(provider.indexOf("const session: SttSession = {"));
  const guard = body.indexOf("if (stopRequested) return;");
  const mark = body.indexOf('trace.mark("stop")');
  assert.ok(guard >= 0 && mark > guard, "the mark must come after the guard so a repeated stop() cannot re-stamp it");
});
t("the readout is behind ?audiodebug=1 (the existing gate), not always on", () => {
  assert.match(line, /if \(!on\) return null;/);
  assert.match(line, /formatSttTimingLine/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
process.exit(0);
