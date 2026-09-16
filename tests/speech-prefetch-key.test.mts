/**
 * fix: speech prefetch cache key mismatch (2026-09-16, voice-branch
 * review). ExerciseScreen's two prefetchSpeech() calls (item 1's own fix
 * from 2026-09-15) warmed the cache under `line.text` alone, while every
 * caller that actually speaks the line — useGuide's say(), and this
 * screen's own speakAuto() calls — reads the "name, text" form via
 * lines.spoken(). Both lines here (thinking, buildingExercise) carry a
 * `name`, so the two keys never matched: every load paid for the
 * prefetch AND paid the Cartesia round trip again live, silently.
 *
 * This proves the fix the way it actually shows up in the browser: one
 * fetch to warm the cache, zero more when the line is actually spoken.
 * A regression back to `.text` reintroduces a second fetch here.
 *
 * Run: npx tsx tests/speech-prefetch-key.test.mts
 */
import assert from "node:assert/strict";
import * as lines from "../lib/guide/lines";

// Same minimal fake <audio>/fetch harness as speech-cached-replay.test.mts —
// duplicated rather than shared because both files stand alone under
// `npm test`'s chain of independent `tsx` invocations, each importing a
// fresh copy of the useSpeech module (its cache must start empty).
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

(globalThis as unknown as { window: { addEventListener: () => void } }).window = { addEventListener: () => {} };
(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;
let urlCounter = 0;
(globalThis as unknown as { URL: typeof URL }).URL = Object.assign(URL, {
  createObjectURL: () => `blob:fake-${urlCounter++}`,
  revokeObjectURL: () => {},
});

const fetchCalls: string[] = [];
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (_url: unknown, init: RequestInit) => {
  const body = JSON.parse(init.body as string) as { text: string };
  fetchCalls.push(body.text);
  return { ok: true, status: 200, blob: async () => new Blob(["fake-audio-bytes"]) };
}) as unknown as typeof fetch;

const { speak, prefetchSpeech } = await import("../lib/speech/useSpeech");

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
const settle = () => new Promise((r) => setTimeout(r, 20));

console.log("the prefetch key matches the key speak() actually reads");

await at("thinking(): prefetch, then speak, hits the cache — one fetch total", async () => {
  fetchCalls.length = 0;
  const line = lines.thinking("boy", "נועה");
  // This is exactly ExerciseScreen's own call, post-fix.
  prefetchSpeech(lines.spoken(line), "boy");
  await settle();
  assert.equal(fetchCalls.length, 1, "the prefetch itself is the one fetch");

  // This is exactly what useGuide.say() / speakAuto() actually send.
  speak(lines.spoken(line), "exercise", "boy");
  await settle();
  assert.equal(fetchCalls.length, 1, "speaking the line must not pay a second round trip");
});

await at("buildingExercise(): same proof", async () => {
  fetchCalls.length = 0;
  const line = lines.buildingExercise("girl", "איתי");
  prefetchSpeech(lines.spoken(line), "girl");
  await settle();
  speak(lines.spoken(line), "exercise", "girl");
  await settle();
  assert.equal(fetchCalls.length, 1, "speaking the line must not pay a second round trip");
});

await at("the old bug, demonstrated: prefetching .text alone would have missed", async () => {
  fetchCalls.length = 0;
  const line = lines.thinking("boy", "דניאל");
  // .text has no name prefix; spoken() does — this is the mismatch that
  // shipped in the 2026-09-15 prefetch fix and is what this fix corrects.
  assert.notEqual(line.text, lines.spoken(line), "a line with a name must differ from spoken() form");
  prefetchSpeech(line.text, "boy");
  await settle();
  speak(lines.spoken(line), "exercise", "boy");
  await settle();
  assert.equal(fetchCalls.length, 2, "prefetching the wrong key pays for both the warm-up and the real call");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
