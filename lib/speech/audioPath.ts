/**
 * Which audio path a spoken line takes, how we notice when one silently
 * dies, and the trace that says what actually happened on a real device.
 *
 * No imports, on purpose: this is pure logic (a UA check, a timer, a log
 * buffer), so tests can load it without a DOM and lib/speech/useSpeech.ts
 * stays about playback rather than about deciding.
 *
 * WHY THIS EXISTS (production hotfix, 2026-09-20). The 19.9 evening deploy
 * made speakCloud() prefer MediaSource streaming so playback could start on
 * the first chunk instead of after the last. On iPhone Safari that turned
 * into total silence for exercise questions. Working theory: iOS exposes
 * ManagedMediaSource, `isTypeSupported("audio/mpeg")` says yes, and then
 * MP3 through MSE stalls or decodes to nothing on WebKit — with NO `error`
 * event, so nothing ever reached the speechSynthesis fallback. Desktop
 * Chrome was verified fine end to end. Unverified on a real iPhone from
 * here, which is what the trace below is for.
 */

export type AudioPath = "mse" | "blob" | "speechSynthesis";

export interface AudioEnv {
  userAgent: string;
  maxTouchPoints: number;
}

/** Read from the live browser. Safe on the server and in tests. */
export function readAudioEnv(): AudioEnv {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return { userAgent: nav?.userAgent ?? "", maxTouchPoints: nav?.maxTouchPoints ?? 0 };
}

/**
 * iOS / iPadOS — where every browser is WebKit underneath.
 *
 * - `iPhone|iPad|iPod` in the UA covers Safari AND the third-party
 *   browsers (Chrome/CriOS, Firefox/FxiOS, Edge/EdgiOS): Apple requires
 *   them all to use WebKit on iOS, so a Chrome-branded iPhone has exactly
 *   Safari's MSE behaviour and must be gated the same way.
 * - iPadOS 13+ sends a *Macintosh* UA by default ("Request Desktop
 *   Website"), so the UA alone calls an iPad a Mac. Real Macs report 0
 *   touch points; an iPad reports 5. That is the tell.
 *
 * Deliberately NOT gated: desktop Safari on macOS. The brief scoped this
 * to iOS/iPadOS; the stall watchdog below is the net for anything else
 * that turns out to misbehave.
 */
export function isIOSWebKit(env: AudioEnv): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(env.userAgent)) return true;
  return /\bMacintosh\b/.test(env.userAgent) && env.maxTouchPoints > 1;
}

/**
 * THE platform gate — the one place that decides whether MSE streaming may
 * be attempted. MP3-in-MSE stalls silently on WebKit (no `error` event), so
 * iOS/iPadOS use the blob path exactly as they did before streaming
 * existed. Desktop Chrome keeps streaming.
 */
export function mseStreamingAllowed(env: AudioEnv): boolean {
  return !isIOSWebKit(env);
}

export interface PathChoice {
  path: "mse" | "blob";
  reason: string;
}

/**
 * Pick MSE or blob for a line that is not already cached.
 *
 * `hasMediaSource` is a function so the gate is evaluated FIRST and, on
 * iOS, no MediaSource / ManagedMediaSource API is touched at all — not
 * even `isTypeSupported`. The blob path is then byte-for-byte what it was.
 */
export function pickAudioPath(env: AudioEnv, hasMediaSource: () => boolean, mseDisabledForSession: boolean): PathChoice {
  if (!mseStreamingAllowed(env)) return { path: "blob", reason: "ios-webkit-gate" };
  if (mseDisabledForSession) return { path: "blob", reason: "mse-disabled-after-stall" };
  if (!hasMediaSource()) return { path: "blob", reason: "no-mediasource" };
  return { path: "mse", reason: "streaming" };
}

// ---- Stall watchdog ----------------------------------------------------------

/**
 * How long an MSE-backed line gets to show a sign of life after play().
 * Measured from the play() call. Streaming normally produces a 'playing'
 * event within a few hundred ms of the first chunk; 2.5s is far past that
 * and still short enough that a child hears the fallback as a hiccup
 * rather than as silence.
 */
export const STALL_TIMEOUT_MS = 2500;

export interface StallWatchdogOptions {
  /** True once audio is demonstrably playing: a 'playing' event fired, or
   *  currentTime moved. Read when the timer fires, not before. */
  isPlaying: () => boolean;
  /** Called at most once, only if nothing was playing at the deadline. */
  onStall: () => void;
  timeoutMs?: number;
  /** Injectable so tests can drive time deterministically. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Fires `onStall` if audio has not started by the deadline. Silent when
 * playback is healthy, and cancellable — the caller cancels it the moment
 * the line actually starts, ends, or is superseded.
 *
 * It exists because a stalled MediaSource element reports nothing: no
 * `error`, and `play()`'s own promise may never settle. Absence of an
 * event is the failure, so something has to be watching the clock.
 */
export function startStallWatchdog(opts: StallWatchdogOptions): { cancel(): void } {
  const set =
    opts.setTimer ??
    ((fn: () => void, ms: number) => {
      const h = setTimeout(fn, ms);
      // Never hold a process (or a test run) open on a watchdog alone.
      (h as { unref?: () => void }).unref?.();
      return h;
    });
  const clear = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let done = false;
  const handle = set(() => {
    if (done) return;
    done = true;
    if (!opts.isPlaying()) opts.onStall();
  }, opts.timeoutMs ?? STALL_TIMEOUT_MS);

  return {
    cancel() {
      if (done) return;
      done = true;
      clear(handle);
    },
  };
}

// ---- [tts-path] trace ----------------------------------------------------------

export interface AudioPathEntry {
  at: number;
  path: AudioPath;
  reason: string;
}

const MAX_ENTRIES = 12;
let entries: readonly AudioPathEntry[] = [];
const listeners = new Set<() => void>();

/**
 * Record which path a LIVE speak took and why. "Live" here means a line a
 * child is about to hear — everything that goes through speak(). Warm-up
 * prefetches are deliberately not traced: nobody is waiting on them.
 *
 * Console for a laptop with devtools; the entries also feed the on-screen
 * line behind ?audiodebug=1 for a phone with none.
 */
export function logAudioPath(path: AudioPath, reason: string): void {
  console.log(`[tts-path] path=${path} reason=${reason}`);
  // A new array each time, so useSyncExternalStore sees a changed snapshot.
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), { at: Date.now(), path, reason }];
  listeners.forEach((l) => l());
}

export function getAudioPathLog(): readonly AudioPathEntry[] {
  return entries;
}

export function subscribeAudioPathLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only. */
export function __clearAudioPathLogForTests(): void {
  entries = [];
  listeners.forEach((l) => l());
}

// ---- Temporary on-screen debug line -----------------------------------------

const DEBUG_FLAG_KEY = "ai-tutor-audiodebug";

/**
 * TEMPORARY (2026-09-20 hotfix): whether to show the on-screen audio trace.
 * On with `?audiodebug=1`, and remembered for the tab session so it
 * survives the login redirect that would otherwise drop the query string.
 * Remove together with components/debug/AudioDebugLine.tsx once the iPhone
 * question is answered.
 */
export function audioDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("audiodebug");
    if (fromUrl === "1") {
      window.sessionStorage.setItem(DEBUG_FLAG_KEY, "1");
      return true;
    }
    if (fromUrl === "0") {
      window.sessionStorage.removeItem(DEBUG_FLAG_KEY);
      return false;
    }
    return window.sessionStorage.getItem(DEBUG_FLAG_KEY) === "1";
  } catch {
    // Storage blocked (private mode): the query string alone still works.
    try {
      return new URLSearchParams(window.location.search).get("audiodebug") === "1";
    } catch {
      return false;
    }
  }
}
