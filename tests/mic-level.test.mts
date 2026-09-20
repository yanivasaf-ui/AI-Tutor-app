/**
 * feat: local UX wins item 1 — the character leans in step with the kid's
 * voice while they hold the mic.
 *
 * The properties that matter, because this touches the mic stream of a
 * children's app:
 *  - it only READS the stream and never routes it to a destination (that
 *    would play the child's own voice back at them);
 *  - it does no work when nobody is watching;
 *  - it settles to exactly 0 when the capture ends, and stops looping;
 *  - and whatever goes wrong inside it, it never throws into the caller.
 *    Voice input working matters far more than the cue, so failure must be
 *    silent and local.
 *
 * Driven with a fake Web Audio context and a hand-cranked rAF.
 *
 * Run: npx tsx tests/mic-level.test.mts
 */
import assert from "node:assert/strict";
import {
  ATTACK_MS,
  LEVEL_CEIL,
  LEVEL_FLOOR,
  MIN_FRAME_MS,
  RELEASE_MS,
  computeRms,
  createMicLevelMonitor,
  shapeLevel,
  shouldReactToMic,
  smooth,
  type ContextLike,
} from "../lib/voice/micLevel";

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
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log("the maths");

t("silence is 0 and a full-scale square wave is ~1", () => {
  assert.equal(computeRms(new Uint8Array(256).fill(128)), 0);
  const square = new Uint8Array(256).map((_, i) => (i % 2 ? 255 : 0));
  assert.ok(computeRms(square) > 0.99);
  assert.equal(computeRms([]), 0);
});

t("room noise below the floor maps to exactly 0; the ceiling maps to 1", () => {
  assert.equal(shapeLevel(0), 0);
  assert.equal(shapeLevel(LEVEL_FLOOR), 0);
  assert.equal(shapeLevel(LEVEL_FLOOR / 2), 0);
  assert.ok(near(shapeLevel(LEVEL_CEIL), 1));
  assert.equal(shapeLevel(LEVEL_CEIL * 4), 1, "louder than the ceiling must clamp, not overshoot");
});

t("shaping is monotonic: louder never looks quieter", () => {
  let prev = -1;
  for (let rms = 0; rms <= 0.3; rms += 0.005) {
    const v = shapeLevel(rms);
    assert.ok(v >= prev - 1e-12, `not monotonic at rms=${rms}`);
    prev = v;
  }
});

t("attack is faster than release: it rises quickly and falls slowly", () => {
  const up = smooth(0, 1, 16);
  const down = 1 - smooth(1, 0, 16);
  assert.ok(up > down, `rise per frame ${up} should exceed fall per frame ${down}`);
  assert.ok(ATTACK_MS < RELEASE_MS);
});

t("smoothing is frame-rate independent: two half steps ~ one whole step", () => {
  const whole = smooth(0, 1, 32);
  const halves = smooth(smooth(0, 1, 16), 1, 16);
  assert.ok(near(whole, halves, 1e-9));
});

t("smoothing converges on the target and never overshoots it", () => {
  let v = 0;
  for (let i = 0; i < 200; i++) {
    v = smooth(v, 0.7, 16);
    assert.ok(v <= 0.7 + 1e-12);
  }
  assert.ok(near(v, 0.7, 1e-3));
});

// ---------------------------------------------------------------------------
// The loop, on a fake Web Audio context
// ---------------------------------------------------------------------------

interface Rig {
  monitor: ReturnType<typeof createMicLevelMonitor>;
  emitted: number[];
  /** Amplitude the fake analyser reports, 0..1 (0 = silence). */
  setAmp(a: number): void;
  /** Run one animation frame at absolute time `t`. */
  frame(t: number): void;
  pendingFrames(): number;
  connects: unknown[];
  sourceDisconnects: () => number;
  contextsCreated: () => number;
  samples: () => number;
  breakAnalyser(): void;
}

function rig(opts?: { context?: "ok" | "null" | "throws" }): Rig {
  let amp = 0;
  let broken = false;
  let samples = 0;
  let contexts = 0;
  let sourceDisconnects = 0;
  const connects: unknown[] = [];
  let nextHandle = 1;
  const queue = new Map<number, (t: number) => void>();

  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 1,
    getByteTimeDomainData(arr: Uint8Array) {
      if (broken) throw new Error("analyser died");
      samples++;
      for (let i = 0; i < arr.length; i++) arr[i] = Math.round(128 + amp * 127 * (i % 2 ? 1 : -1));
    },
    disconnect() {},
  };
  const ctx: ContextLike = {
    state: "running",
    createMediaStreamSource() {
      return {
        connect(node: unknown) {
          connects.push(node);
          return node;
        },
        disconnect() {
          sourceDisconnects++;
        },
      };
    },
    createAnalyser: () => analyser,
  };

  const monitor = createMicLevelMonitor({
    createContext: () => {
      contexts++;
      if (opts?.context === "throws") throw new Error("no audio here");
      return opts?.context === "null" ? null : ctx;
    },
    raf: (cb) => {
      const h = nextHandle++;
      queue.set(h, cb);
      return h;
    },
    caf: (h) => void queue.delete(h),
  });
  const emitted: number[] = [];
  return {
    monitor,
    emitted,
    setAmp: (a) => (amp = a),
    frame(tm) {
      const pending = [...queue.entries()];
      queue.clear();
      for (const [, cb] of pending) cb(tm);
    },
    pendingFrames: () => queue.size,
    connects,
    sourceDisconnects: () => sourceDisconnects,
    contextsCreated: () => contexts,
    samples: () => samples,
    breakAnalyser: () => (broken = true),
  };
}
const STREAM = {} as MediaStream;
/** Advance `n` frames of 16ms starting after `from`. */
function run(r: Rig, from: number, n: number) {
  let tm = from;
  for (let i = 0; i < n; i++) {
    tm += 16;
    r.frame(tm);
  }
  return tm;
}

console.log("\nit does no work when nobody is looking");

t("a capture with no subscriber builds no audio context and schedules no frames", () => {
  const r = rig();
  r.monitor.start(STREAM);
  assert.equal(r.contextsCreated(), 0);
  assert.equal(r.pendingFrames(), 0);
  assert.equal(r.monitor.running, false);
});

t("subscribing while a capture is already live starts the loop", () => {
  const r = rig();
  r.monitor.start(STREAM);
  r.monitor.subscribe((v) => r.emitted.push(v));
  assert.equal(r.monitor.running, true);
  assert.equal(r.contextsCreated(), 1);
});

t("the last unsubscribe cancels the loop and releases the graph", () => {
  const r = rig();
  const off = r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  assert.equal(r.monitor.running, true);
  off();
  assert.equal(r.monitor.running, false);
  assert.equal(r.pendingFrames(), 0, "no orphaned animation frame may be left running");
  assert.equal(r.sourceDisconnects(), 1);
});

console.log("\nit follows the voice, and settles");

t("loud speech drives the level up; silence brings it back down", () => {
  const r = rig();
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  r.setAmp(0.5);
  let tm = run(r, 0, 12);
  const loud = Math.max(...r.emitted);
  assert.ok(loud > 0.6, `loud speech should read high, got ${loud}`);
  r.setAmp(0);
  tm = run(r, tm, 40);
  assert.ok(r.emitted[r.emitted.length - 1] < loud / 3, "and it should ease back when they stop talking");
});

t("room noise below the floor never moves the character at all", () => {
  const r = rig();
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  r.setAmp(0.01); // ~0.01 RMS: under LEVEL_FLOOR
  run(r, 0, 20);
  assert.equal(Math.max(0, ...r.emitted), 0);
});

t("after the capture ends the level eases to EXACTLY 0 and the loop stops", () => {
  const r = rig();
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  r.setAmp(0.6);
  let tm = run(r, 0, 10);
  assert.ok(Math.max(...r.emitted) > 0.5);
  r.monitor.stop();
  assert.equal(r.monitor.running, true, "it should keep looping just long enough to ease back, not snap");
  tm = run(r, tm, 80);
  assert.equal(r.emitted[r.emitted.length - 1], 0, "the character must return to rest exactly, not hover near it");
  assert.equal(r.monitor.running, false);
  assert.equal(r.pendingFrames(), 0);
  assert.equal(r.sourceDisconnects(), 1);
});

t("decay ignores the mic: after stop() a still-loud analyser cannot keep the character leaning", () => {
  const r = rig();
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  r.setAmp(0.6);
  let tm = run(r, 0, 10);
  r.monitor.stop();
  run(r, tm, 80); // amp is still 0.6 — a stale buffer, say
  assert.equal(r.emitted[r.emitted.length - 1], 0);
});

t("a new press during the previous decay restarts cleanly", () => {
  const r = rig();
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  r.setAmp(0.5);
  let tm = run(r, 0, 8);
  r.monitor.stop();
  tm = run(r, tm, 3);
  r.monitor.start(STREAM);
  tm = run(r, tm, 8);
  assert.ok(r.emitted[r.emitted.length - 1] > 0.3, "the second press must track the voice again");
  assert.equal(r.monitor.running, true);
});

t("updates are capped near 60Hz: two frames closer than the minimum sample once", () => {
  const r = rig();
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  r.frame(100);
  const after = r.samples();
  r.frame(100 + MIN_FRAME_MS - 5); // a 120Hz display's second frame
  assert.equal(r.samples(), after, "the too-soon frame must not be sampled");
  r.frame(100 + MIN_FRAME_MS + 6);
  assert.equal(r.samples(), after + 1);
});

console.log("\nit can never play the child's voice back at them");

t("the mic source connects to the analyser and to NOTHING else", () => {
  const r = rig();
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  assert.equal(r.connects.length, 1, "exactly one connection: source -> analyser");
  const node = r.connects[0] as { getByteTimeDomainData?: unknown };
  assert.equal(typeof node.getByteTimeDomainData, "function", "and that one node must be the analyser, not a destination");
});

console.log("\nfailure is silent and local");

t("no AudioContext available: nothing throws, nothing emits, and it does not keep retrying", () => {
  const r = rig({ context: "null" });
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  r.monitor.stop();
  r.monitor.start(STREAM);
  assert.equal(r.emitted.length, 0);
  assert.equal(r.contextsCreated(), 1, "it must not retry constructing a context on every press");
  assert.equal(r.pendingFrames(), 0);
});

t("a context that throws on creation is contained", () => {
  const r = rig({ context: "throws" });
  r.monitor.subscribe((v) => r.emitted.push(v));
  assert.doesNotThrow(() => r.monitor.start(STREAM));
  assert.equal(r.monitor.running, false);
});

t("an analyser that dies mid-capture stops the cue cleanly and lands at 0", () => {
  const r = rig();
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  r.setAmp(0.5);
  let tm = run(r, 0, 6);
  r.breakAnalyser();
  assert.doesNotThrow(() => run(r, tm, 3));
  assert.equal(r.emitted[r.emitted.length - 1], 0);
  assert.equal(r.monitor.running, false);
});

t("one throwing listener does not stop the others or the loop", () => {
  const r = rig();
  r.monitor.subscribe(() => {
    throw new Error("bad listener");
  });
  r.monitor.subscribe((v) => r.emitted.push(v));
  r.monitor.start(STREAM);
  r.setAmp(0.5);
  assert.doesNotThrow(() => run(r, 0, 8));
  assert.ok(r.emitted.length > 0);
  assert.equal(r.monitor.running, true);
});

console.log("\nwho reacts");

t("reduced-motion users get no reaction; nor does a character that did not ask for it", () => {
  assert.equal(shouldReactToMic({ enabled: true, reducedMotion: true }), false);
  assert.equal(shouldReactToMic({ enabled: false, reducedMotion: false }), false);
  assert.equal(shouldReactToMic({ enabled: true, reducedMotion: false }), true);
  assert.equal(shouldReactToMic({ enabled: true, reducedMotion: null }), true);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
