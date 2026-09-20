/**
 * Live microphone level, for a character that visibly listens.
 *
 * feat: local UX wins, item 1. While the kid holds the mic, the character
 * gets a subtle lean toward them that follows how loud they are — a
 * listening cue, not a light show. Zero network: an AnalyserNode on the
 * mic stream we already hold.
 *
 * Deliberately isolated from capture. This module only ever READS the
 * stream; MediaRecorder and the upload never depend on it, so if anything
 * here fails (no AudioContext, a suspended context on iOS, a throwing
 * node) the kid's voice input works exactly as before and only the cue is
 * missing. Every touch of the Web Audio API is inside try/catch for that
 * reason.
 *
 * Two things it must never do:
 *  - connect to the audio destination. Routing the mic to the speakers is
 *    an echo, and on a phone next to a child's ear it is worse than that;
 *  - run when nobody is looking. The loop only exists while at least one
 *    subscriber is attached AND a capture is live.
 *
 * The API is dependency-injected (context factory, rAF) so the loop can be
 * driven deterministically in tests.
 */

/** RMS below this is room noise, not speech. */
export const LEVEL_FLOOR = 0.015;
/** RMS at/above this is "as loud as it needs to look". Speech into a phone
 *  mic rarely exceeds ~0.25 RMS. */
export const LEVEL_CEIL = 0.22;
/** Rise fast, fall slow: a syllable should register at once, and the
 *  character should ease back rather than flicker between words. */
export const ATTACK_MS = 45;
export const RELEASE_MS = 180;
/** Cap the update rate at ~60Hz. On a 120Hz display rAF fires twice as
 *  often, and a second update per frame is battery for no visible gain. */
export const MIN_FRAME_MS = 15;
/** Analyser window. 256 samples is ~5ms of audio: plenty for a level, and
 *  the cheapest read there is. */
export const FFT_SIZE = 256;

/** Root-mean-square of a time-domain byte buffer (128 = silence). 0..~1. */
export function computeRms(bytes: ArrayLike<number>): number {
  const n = bytes.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = (bytes[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/** RMS -> a 0..1 drive value. Floor-subtracted, then a gentle curve so
 *  quiet speech still moves the character visibly. */
export function shapeLevel(rms: number): number {
  const x = (rms - LEVEL_FLOOR) / (LEVEL_CEIL - LEVEL_FLOOR);
  const clamped = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return Math.pow(clamped, 0.6);
}

/** One step of frame-rate-independent smoothing toward `target`. */
export function smooth(prev: number, target: number, dtMs: number): number {
  const tau = target > prev ? ATTACK_MS : RELEASE_MS;
  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  return prev + (target - prev) * alpha;
}

// ---- The loop -----------------------------------------------------------------

/** The slice of Web Audio this module touches. */
export interface AnalyserLike {
  fftSize: number;
  smoothingTimeConstant: number;
  getByteTimeDomainData(array: Uint8Array): void;
  disconnect?(): void;
}
export interface SourceLike {
  connect(node: unknown): unknown;
  disconnect(): void;
}
export interface ContextLike {
  state?: string;
  createMediaStreamSource(stream: MediaStream): SourceLike;
  createAnalyser(): AnalyserLike;
  resume?(): Promise<void>;
}

export interface MicLevelDeps {
  /** Returns a context, or null when Web Audio is unavailable. Called at
   *  most once and only when there is something to watch. */
  createContext: () => ContextLike | null;
  raf: (cb: (t: number) => void) => number;
  caf: (handle: number) => void;
}

export type LevelListener = (level: number) => void;

export interface MicLevelMonitor {
  /** A capture began on this stream. */
  start(stream: MediaStream): void;
  /** The capture ended. The level eases to 0 rather than snapping. */
  stop(): void;
  subscribe(listener: LevelListener): () => void;
  /** For tests and diagnostics. */
  readonly running: boolean;
}

/** Below this, a decaying level is treated as settled. */
const SETTLED = 0.01;

export function createMicLevelMonitor(deps: MicLevelDeps): MicLevelMonitor {
  const listeners = new Set<LevelListener>();
  let ctx: ContextLike | null = null;
  let ctxFailed = false;
  let stream: MediaStream | null = null; // a capture is live on this stream
  let source: SourceLike | null = null;
  let analyser: AnalyserLike | null = null;
  let data: Uint8Array | null = null;
  let handle: number | null = null;
  let level = 0;
  let lastEmitted = 0;
  let lastT: number | null = null;
  /** The capture ended; keep looping only until the level has decayed. */
  let decaying = false;

  const emit = (v: number) => {
    lastEmitted = v;
    for (const l of listeners) {
      try {
        l(v);
      } catch {
        /* one bad listener must not stop the others or the loop */
      }
    }
  };

  const teardownGraph = () => {
    try {
      source?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      analyser?.disconnect?.();
    } catch {
      /* already disconnected */
    }
    source = null;
    analyser = null;
    data = null;
  };

  const cancelLoop = () => {
    if (handle !== null) deps.caf(handle);
    handle = null;
    lastT = null;
  };

  const settle = () => {
    cancelLoop();
    teardownGraph();
    decaying = false;
    level = 0;
    if (lastEmitted !== 0) emit(0);
  };

  const tick = (t: number) => {
    handle = null;
    if (lastT !== null && t - lastT < MIN_FRAME_MS) {
      handle = deps.raf(tick);
      return;
    }
    const dt = lastT === null ? 16 : t - lastT;
    lastT = t;

    let target = 0;
    if (!decaying && analyser && data) {
      try {
        analyser.getByteTimeDomainData(data);
        target = shapeLevel(computeRms(data));
      } catch {
        // The analyser died mid-capture. Stop cleanly; capture is unaffected.
        settle();
        return;
      }
    }
    level = smooth(level, target, dt);
    if (decaying && level < SETTLED) {
      settle();
      return;
    }
    if (Math.abs(level - lastEmitted) >= 0.004 || (level === 0 && lastEmitted !== 0)) emit(level);
    handle = deps.raf(tick);
  };

  /** Build the graph and start looping — only if a capture is live and
   *  someone is listening. Safe to call repeatedly. */
  const ensureRunning = () => {
    if (handle !== null || !stream || listeners.size === 0) return;
    if (!analyser) {
      if (ctxFailed) return;
      try {
        ctx ??= deps.createContext();
        if (!ctx) {
          ctxFailed = true;
          return;
        }
        // iOS hands out suspended contexts until a gesture; the mic press
        // that got us here is one. If it stays suspended the analyser just
        // reads silence, which is harmless.
        if (ctx.state === "suspended") void ctx.resume?.().catch(() => {});
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = FFT_SIZE;
        an.smoothingTimeConstant = 0; // we smooth, with separate attack/release
        // Source -> analyser ONLY. Never on to a destination: that would
        // play the child's own voice back at them.
        src.connect(an);
        source = src;
        analyser = an;
        data = new Uint8Array(an.fftSize);
      } catch {
        ctxFailed = true;
        teardownGraph();
        return;
      }
    }
    decaying = false;
    handle = deps.raf(tick);
  };

  return {
    start(s) {
      // A new press while the last one is still decaying: start over cleanly.
      cancelLoop();
      teardownGraph();
      stream = s;
      decaying = false;
      ensureRunning();
    },
    stop() {
      if (!stream && handle === null) return;
      stream = null;
      if (handle === null) {
        settle();
        return;
      }
      decaying = true; // keep looping just long enough to ease back to 0
    },
    subscribe(listener) {
      listeners.add(listener);
      ensureRunning();
      return () => {
        listeners.delete(listener);
        // Nobody left to look: no reason to keep sampling.
        if (listeners.size === 0) settle();
      };
    },
    get running() {
      return handle !== null;
    },
  };
}

// ---- The app's one monitor ---------------------------------------------------

function browserContext(): ContextLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: new () => ContextLike; webkitAudioContext?: new () => ContextLike };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

let shared: MicLevelMonitor | null = null;
function getMonitor(): MicLevelMonitor {
  shared ??= createMicLevelMonitor({
    createContext: browserContext,
    raf: (cb) => window.requestAnimationFrame(cb),
    caf: (h) => window.cancelAnimationFrame(h),
  });
  return shared;
}

/** Called by the STT provider when a capture starts on the shared stream. */
export function startMicLevel(stream: MediaStream): void {
  try {
    getMonitor().start(stream);
  } catch {
    /* the cue is optional; capture must never notice */
  }
}

/** Called by the STT provider when the capture ends. */
export function stopMicLevel(): void {
  try {
    shared?.stop();
  } catch {
    /* as above */
  }
}

/** Subscribe to the live level (0..1). Returns the unsubscribe function. */
export function subscribeMicLevel(listener: LevelListener): () => void {
  try {
    return getMonitor().subscribe(listener);
  } catch {
    return () => {};
  }
}

/**
 * Whether a character should react to the mic at all. Reduced-motion users
 * get no reaction: this is motion, unlike the pose crossfade, which is a
 * fade and stays.
 */
export function shouldReactToMic(opts: { enabled: boolean; reducedMotion: boolean | null }): boolean {
  return opts.enabled && !opts.reducedMotion;
}
