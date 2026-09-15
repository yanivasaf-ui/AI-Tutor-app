/**
 * FIX 6 (2026-09-14, spun off from the voice/tap work): replaying an
 * identical cached line can silently fail. lib/speech/useSpeech.ts's
 * speakCloud() reuses one shared <audio> element and caches Cartesia
 * audio by (character, text) — a 🔊 tap replaying the same bubble, or the
 * same line said again right after, hits the SAME cached blob URL twice
 * in a row. Assigning `.src` the identical string it already holds
 * doesn't reliably reset playback position across browsers (notably iOS
 * Safari, this app's main target): play() on an element already at the
 * end of that clip does nothing audible — no error, nothing to catch.
 *
 * Affects tap and voice equally: both call speak() -> speakCloud(), the
 * one function this fixes.
 *
 * Run: npm test -- tests/speech-cached-replay.test.mts (or npm run test:all)
 */
import assert from "node:assert/strict";

// A minimal fake <audio> element. play() deliberately leaves currentTime
// wherever it lands after "playing" (here, simulated by jumping it
// forward) — a real element ends up not-at-zero after playback finishes
// too; only an explicit reset before the NEXT play() guarantees a replay
// actually starts from the beginning.
const playCalls: { src: string; currentTimeAtPlay: number }[] = [];
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
    playCalls.push({ src: this.src, currentTimeAtPlay: this.currentTime });
    queueMicrotask(() => this.onplaying?.());
    this.currentTime = 999; // simulate having played through, same as a real element would end up
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

(globalThis as unknown as { window: { addEventListener: () => void } }).window = { addEventListener: () => {} };
(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;
let urlCounter = 0;
(globalThis as unknown as { URL: typeof URL }).URL = Object.assign(URL, {
  createObjectURL: () => `blob:fake-${urlCounter++}`,
  revokeObjectURL: () => {},
});
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => ({
  ok: true,
  status: 200,
  blob: async () => new Blob(["fake-audio-bytes"]),
})) as unknown as typeof fetch;

const { speak } = await import("../lib/speech/useSpeech");

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

// A short wait for speakCloud's fetch/play chain to actually run — it's
// fire-and-forget from speak()'s point of view.
const settle = () => new Promise((r) => setTimeout(r, 20));

console.log("replaying the identical cached line resets playback position");
await at("first play and a same-line replay both start from currentTime 0", async () => {
  playCalls.length = 0;
  speak("שלום, מה שלומך?", "test", "milo" as never);
  await settle();
  speak("שלום, מה שלומך?", "test", "milo" as never); // identical text+character -> cache hit, no fetch
  await settle();

  assert.equal(playCalls.length, 2, `expected 2 play() calls, got ${playCalls.length}`);
  assert.equal(playCalls[0].src, playCalls[1].src, "a cache hit must reuse the exact same blob URL — otherwise this isn't testing a replay");
  assert.equal(playCalls[0].currentTimeAtPlay, 0, "the first play should start at 0");
  assert.equal(playCalls[1].currentTimeAtPlay, 0, "the cached replay must also start at 0 — this is the bug: a stale currentTime silently plays nothing");
});

await at("a DIFFERENT line after a cached one still starts fresh, unaffected", async () => {
  playCalls.length = 0;
  speak("משפט אחר לגמרי", "test", "milo" as never);
  await settle();
  assert.equal(playCalls[0].currentTimeAtPlay, 0);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length > 0 ? 1 : 0);
