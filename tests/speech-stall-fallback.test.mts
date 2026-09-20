/**
 * Production hotfix (2026-09-20): the whole fallback chain, driven through
 * the real speak() -> speakCloud() with fake browser objects.
 *
 *   MSE -> blob -> speechSynthesis
 *
 * What these guard, in the order they would have bitten:
 *  - iOS never touches MediaSource at all (the actual fix).
 *  - A stalled MediaSource element is noticed and replayed from a blob,
 *    instead of leaving the child in silence forever.
 *  - The abandoned attempt goes quiet: its pending play() rejects with
 *    AbortError when the fallback swaps the src, and that must NOT also
 *    start the browser voice on top of the blob one (double speech).
 *  - A MediaSource that never opens (a real Safari failure mode) is still
 *    recoverable, because the fallback can read the body itself.
 *  - Healthy playback is left completely alone.
 *
 * speechSynthesis has no fake voice here, so "the browser voice was used"
 * is read from the [tts-path] trace — which is also exactly how the
 * on-screen ?audiodebug=1 line will report it on a real phone.
 *
 * Run: npx tsx tests/speech-stall-fallback.test.mts
 */
import assert from "node:assert/strict";

type PlayMode = "ok" | "stall" | "reject";
const playQueue: PlayMode[] = [];
const audioEvents: string[] = [];
const srcHistory: string[] = [];
let playCalls = 0;

class FakeAudio {
  muted = false;
  currentTime = 0;
  paused = true;
  preload = "";
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  private pending: ((e: Error) => void) | null = null;

  get src() {
    return this._src;
  }
  // A real element rejects a pending play() with AbortError the moment a
  // new load starts. Emulating that is what makes the double-speech test
  // meaningful — without it the hazard cannot occur.
  set src(v: string) {
    this._src = v;
    srcHistory.push(v);
    if (this.pending) {
      const reject = this.pending;
      this.pending = null;
      reject(Object.assign(new Error("The play() request was interrupted by a new load request."), { name: "AbortError" }));
    }
  }
  play() {
    playCalls++;
    audioEvents.push("play");
    const mode = playQueue.shift() ?? "ok";
    if (mode === "reject") {
      return Promise.reject(Object.assign(new Error("not allowed"), { name: "NotAllowedError" }));
    }
    if (mode === "stall") {
      // Never resolves, never fires 'playing', never fires 'error'.
      return new Promise<void>((_, reject) => {
        this.pending = reject;
      });
    }
    this.paused = false;
    queueMicrotask(() => this.onplaying?.());
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    audioEvents.push("pause");
  }
}

let mediaSourcesBuilt = 0;
let mediaSourcesEnded = 0;
let mediaSourceOpens = true;
class FakeSourceBuffer {
  updating = false;
  private listeners: (() => void)[] = [];
  addEventListener(_t: string, fn: () => void) {
    this.listeners.push(fn);
  }
  appendBuffer(_c: unknown) {
    this.updating = true;
    queueMicrotask(() => {
      this.updating = false;
      this.listeners.forEach((fn) => fn());
    });
  }
}
class FakeMediaSource {
  static isTypeSupported(type: string) {
    return type === "audio/mpeg";
  }
  readyState = "closed";
  private openListeners: (() => void)[] = [];
  constructor() {
    mediaSourcesBuilt++;
    queueMicrotask(() => {
      if (!mediaSourceOpens) return; // the Safari failure: sourceopen never comes
      this.readyState = "open";
      this.openListeners.forEach((fn) => fn());
    });
  }
  addEventListener(type: string, fn: () => void) {
    if (type === "sourceopen") this.openListeners.push(fn);
  }
  addSourceBuffer(_m: string) {
    return new FakeSourceBuffer();
  }
  endOfStream() {
    mediaSourcesEnded++;
    this.readyState = "ended";
  }
}

function setUA(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(globalThis, "navigator", { value: { userAgent, maxTouchPoints }, configurable: true });
}
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

(globalThis as unknown as { window: Record<string, unknown> }).window = {
  addEventListener: () => {},
  MediaSource: FakeMediaSource,
};
(globalThis as unknown as { MediaSource: unknown }).MediaSource = FakeMediaSource;
(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;

let urlCounter = 0;
(globalThis as unknown as { URL: typeof URL }).URL = Object.assign(URL, {
  createObjectURL: (o: unknown) => (o instanceof FakeMediaSource ? `mse:${urlCounter++}` : `blob:${urlCounter++}`),
  revokeObjectURL: () => {},
});

let fetchStatus = 200;
let fetchCount = 0;
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
  fetchCount++;
  if (fetchStatus !== 200) return new Response(JSON.stringify({ error: "tts_failed" }), { status: fetchStatus });
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([1, 2, 3]));
      c.enqueue(new Uint8Array([4, 5, 6]));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
}) as unknown as typeof fetch;

const { speak, __speechTestHooks } = await import("../lib/speech/useSpeech");
const { getAudioPathLog, __clearAudioPathLogForTests } = await import("../lib/speech/audioPath");

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
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const trace = () => getAudioPathLog().map((e) => `${e.path}:${e.reason}`);
let lineNo = 0;
const fresh = () => `שורה ${++lineNo}`;

function reset(over?: { ua?: string; touch?: number; opens?: boolean; status?: number }) {
  __speechTestHooks.reset();
  __speechTestHooks.setStallMs(40);
  __speechTestHooks.setWholeClipWaitMs(300);
  __clearAudioPathLogForTests();
  playQueue.length = 0;
  audioEvents.length = 0;
  srcHistory.length = 0;
  playCalls = 0;
  mediaSourcesBuilt = 0;
  mediaSourcesEnded = 0;
  mediaSourceOpens = over?.opens ?? true;
  fetchStatus = over?.status ?? 200;
  setUA(over?.ua ?? CHROME, over?.touch ?? 0);
}

console.log("iOS: the gate keeps MediaSource out of it entirely");

await at("iPhone Safari takes the blob path and never constructs a MediaSource", async () => {
  reset({ ua: IPHONE, touch: 5 });
  speak(fresh(), "exercise", "girl");
  await settle(80);
  assert.equal(mediaSourcesBuilt, 0, "iOS must not build a MediaSource — that is the fix");
  assert.deepEqual(trace(), ["blob:ios-webkit-gate"]);
  assert.equal(playCalls, 1);
  assert.match(srcHistory[0], /^blob:/, "must play a blob URL, exactly as before streaming existed");
  assert.equal(__speechTestHooks.isMseDisabled(), false, "the gate is not a stall; the breaker stays clear");
});

console.log("\ndesktop Chrome: streaming stays, and healthy playback is left alone");

await at("a healthy MSE line streams and the watchdog never touches it", async () => {
  reset();
  speak(fresh(), "exercise", "girl");
  await settle(150); // several times the 40ms stall deadline
  assert.deepEqual(trace(), ["mse:streaming"], "no fallback entries on a healthy line");
  assert.equal(playCalls, 1, "the line must not be replayed over itself");
  assert.match(srcHistory[0], /^mse:/);
  assert.equal(srcHistory.length, 1, "src must be set once");
  assert.equal(__speechTestHooks.isMseDisabled(), false);
});

console.log("\na stalled MediaSource: noticed, replayed from a blob, no double speech");

await at("stall -> blob fallback plays the same clip, MediaSource torn down", async () => {
  reset();
  playQueue.push("stall", "ok");
  speak(fresh(), "exercise", "girl");
  await settle(250);
  assert.deepEqual(trace(), ["mse:streaming", "blob:fallback:stall"]);
  assert.equal(playCalls, 2, "one MSE attempt, one blob attempt");
  assert.match(srcHistory[0], /^mse:/);
  assert.match(srcHistory[srcHistory.length - 1], /^blob:/, "the fallback must end on a blob URL");
  assert.equal(mediaSourcesEnded >= 1, true, "the stalled MediaSource must be torn down");
  assert.equal(__speechTestHooks.isMseDisabled(), true);
});

await at("the abandoned play()'s AbortError does NOT also start the browser voice", async () => {
  reset();
  playQueue.push("stall", "ok");
  speak(fresh(), "exercise", "girl");
  await settle(250);
  const tts = trace();
  assert.ok(
    !tts.some((e) => e.startsWith("speechSynthesis")),
    `the browser voice fired on top of the blob fallback (double speech): ${tts.join(" | ")}`
  );
});

await at("after one stall the session goes straight to blob, not 2.5s of waiting per line", async () => {
  reset();
  playQueue.push("stall", "ok");
  speak(fresh(), "exercise", "girl");
  await settle(250);
  __clearAudioPathLogForTests();
  playQueue.length = 0;
  srcHistory.length = 0;
  speak(fresh(), "exercise", "girl");
  await settle(80);
  assert.deepEqual(trace(), ["blob:mse-disabled-after-stall"]);
  assert.match(srcHistory[0], /^blob:/);
});

await at("a MediaSource that never opens is still recovered: the fallback reads the body itself", async () => {
  reset({ opens: false });
  playQueue.push("stall", "ok");
  speak(fresh(), "exercise", "girl");
  await settle(300);
  const tts = trace();
  assert.deepEqual(tts, ["mse:streaming", "blob:fallback:stall"], tts.join(" | "));
  assert.ok(!tts.includes("speechSynthesis:blob-unavailable"), "the body was never read, but it must still be recoverable");
  assert.match(srcHistory[srcHistory.length - 1], /^blob:/);
});

console.log("\nthe end of the chain is the browser voice, and only then");

await at("MSE play() rejecting goes to the blob path first, not straight to the browser voice", async () => {
  reset();
  playQueue.push("reject", "ok");
  speak(fresh(), "exercise", "girl");
  await settle(200);
  assert.deepEqual(trace(), ["mse:streaming", "blob:fallback:play-rejected:NotAllowedError"]);
});

await at("blob fallback ALSO failing is what finally reaches speechSynthesis — exactly once", async () => {
  reset();
  playQueue.push("stall", "reject");
  speak(fresh(), "exercise", "girl");
  await settle(250);
  const tts = trace();
  assert.deepEqual(tts.slice(0, 2), ["mse:streaming", "blob:fallback:stall"]);
  const browserVoice = tts.filter((e) => e.startsWith("speechSynthesis:blob-play-rejected"));
  assert.equal(browserVoice.length, 1, `expected one browser-voice fallback: ${tts.join(" | ")}`);
});

await at("a 502 from the server goes to the browser voice, traced with its status", async () => {
  reset({ status: 502 });
  speak(fresh(), "exercise", "girl");
  await settle(80);
  const tts = trace();
  assert.equal(tts[0], "speechSynthesis:http-502", "the trace must name the status that caused the fallback");
  // This test process has no speechSynthesis, so the chain runs out of
  // voices — and the trace must say so rather than look like a healthy
  // fallback. On a phone with no Hebrew voice this is the line that
  // explains total silence.
  assert.equal(tts[1], "speechSynthesis:SILENT: speechSynthesis unavailable");
  assert.equal(playCalls, 0, "no audio may be attempted on a failed fetch");
});

await at("the trace records a cache hit as such", async () => {
  reset();
  const line = fresh();
  speak(line, "exercise", "girl");
  await settle(80);
  __clearAudioPathLogForTests();
  speak(line, "exercise", "girl");
  await settle(50);
  assert.deepEqual(trace(), ["blob:cache-hit"]);
  assert.equal(fetchCount >= 1, true);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
