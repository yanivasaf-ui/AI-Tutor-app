/**
 * feat: streaming voice pipeline — progressive playback.
 *
 * speakCloud() used to `await res.blob()`: the whole clip had to arrive
 * before one sample could play, on top of Cartesia's own ~495ms
 * time-to-first-byte. This proves the replacement actually starts on the
 * FIRST chunk, and that the finished clip still lands in the cache so a
 * replay takes the same blob path it always did.
 *
 * The browsers without MediaSource (iPhone Safari before iOS 17) keep the
 * buffered path — tests/speech-cached-replay.test.mts covers that one, and
 * deliberately defines no MediaSource so it exercises the fallback.
 *
 * Run: npx tsx tests/speech-streaming-playback.test.mts
 */
import assert from "node:assert/strict";

const events: string[] = [];

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
    events.push("play");
    queueMicrotask(() => this.onplaying?.());
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

class FakeSourceBuffer {
  updating = false;
  private listeners: (() => void)[] = [];
  addEventListener(_type: string, fn: () => void) {
    this.listeners.push(fn);
  }
  appendBuffer(_chunk: unknown) {
    events.push("append");
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
  buffers: FakeSourceBuffer[] = [];
  private openListeners: (() => void)[] = [];
  constructor() {
    // A real MediaSource fires sourceopen once the element attaches it.
    queueMicrotask(() => {
      this.readyState = "open";
      this.openListeners.forEach((fn) => fn());
    });
  }
  addEventListener(type: string, fn: () => void) {
    if (type === "sourceopen") this.openListeners.push(fn);
  }
  addSourceBuffer(_mime: string) {
    const b = new FakeSourceBuffer();
    this.buffers.push(b);
    return b;
  }
  endOfStream() {
    events.push("endOfStream");
    this.readyState = "ended";
  }
}

(globalThis as unknown as { window: Record<string, unknown> }).window = {
  addEventListener: () => {},
  MediaSource: FakeMediaSource,
};
(globalThis as unknown as { MediaSource: unknown }).MediaSource = FakeMediaSource;
(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;

let urlCounter = 0;
(globalThis as unknown as { URL: typeof URL }).URL = Object.assign(URL, {
  createObjectURL: () => `blob:fake-${urlCounter++}`,
  revokeObjectURL: () => {},
});

/** Emits three chunks, with a gap between each, so "started before the
 *  last chunk" is a real claim and not a scheduling accident. */
let releaseLastChunk: () => void = () => {};
let fetchCount = 0;
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
  fetchCount++;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      await new Promise((r) => setTimeout(r, 10));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      await new Promise<void>((r) => {
        releaseLastChunk = r;
        setTimeout(r, 200); // safety net so a failing test still finishes
      });
      controller.enqueue(new Uint8Array([7, 8, 9]));
      controller.close();
    },
  });
  return { ok: true, status: 200, body, blob: async () => new Blob(["unused"]) };
}) as unknown as typeof fetch;

const { speak } = await import("../lib/speech/useSpeech");

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

console.log("playback starts on the first chunk, not the last");

await at("play() is called while the response is still streaming", async () => {
  events.length = 0;
  speak("שלום לך", "exercise", "girl");
  await settle(40);
  assert.ok(events.includes("append"), "the first chunk must be appended");
  assert.ok(events.includes("play"), "playback must have started");
  assert.ok(
    !events.includes("endOfStream"),
    "playback started only after the whole clip arrived — that is the bug this replaces"
  );
});

await at("the finished clip is cached, so a replay needs no second fetch", async () => {
  releaseLastChunk();
  await settle(60);
  assert.equal(events.includes("endOfStream"), true, "the stream must close once the last chunk lands");
  const before = fetchCount;
  speak("שלום לך", "exercise", "girl");
  await settle(30);
  assert.equal(fetchCount, before, "a replay must reuse the cached blob, not refetch");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
