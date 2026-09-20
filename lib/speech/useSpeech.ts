"use client";

import { useSyncExternalStore } from "react";
import type { CharacterId } from "@/lib/characters";
import { createLimiter } from "@/lib/speech/limiter";
import {
  STALL_TIMEOUT_MS,
  logAudioPath,
  pickAudioPath,
  readAudioEnv,
  startStallWatchdog,
} from "@/lib/speech/audioPath";

/**
 * Module-level "has the kid touched the screen yet this session" flag —
 * used to gate auto-read (UI Revamp Brief Section 4.1): speech can only
 * start inside a user-gesture call stack on iOS Safari, so speech
 * triggered before any tap must NOT try to auto-speak. Set once, globally,
 * by the first pointerdown anywhere — "has this session had a gesture" is
 * a page-level fact, not component state. The same first tap unlocks the
 * shared audio element (see unlockAudio below).
 */
let gestureSeen = false;

export function hasSeenGesture() {
  return gestureSeen;
}

/**
 * Speech state is ONE page-level fact, not per-component state: one voice
 * lookup, one `speaking` flag, one current utterance. Utterances carry an
 * optional `owner` so that when two characters are on screen (the map
 * guide under the parent gate, the exercise character under a full-screen
 * celebration) only the one actually talking moves its mouth.
 *
 * Two voices, one contract (2026-09-11):
 * - Cartesia — each character's own chosen voice (lib/voices.ts), fetched
 *   as MP3 from /api/tutor's `speak` action and played through one shared
 *   <audio> element. Used whenever the caller says which character is
 *   speaking.
 * - The browser's Hebrew SpeechSynthesis voice (Carmit) — the fallback:
 *   lines with no character (the onboarding prompt before a character is
 *   picked), and any line Cartesia can't deliver. The character never
 *   goes silent because the network did.
 * speak() / stopSpeaking() / useSpeech() look the same to every caller
 * either way, so mouth-sync, owners, the mute toggle and barge-in work
 * unchanged.
 */
interface SpeechState {
  voice: SpeechSynthesisVoice | null;
  speaking: boolean;
  /** Who is saying the current utterance. null = an ownerless request
   *  (a bare 🔊 tap), which every on-screen character may lip-sync to. */
  owner: string | null;
  /** Cartesia is usable this session. Starts true; flips false for the
   *  rest of the session if the server says it isn't configured (503) or
   *  the session isn't signed in (401), so we stop paying a doomed round
   *  trip before every fallback line. */
  cloud: boolean;
}

let state: SpeechState = { voice: null, speaking: false, owner: null, cloud: true };
const SERVER_STATE: SpeechState = { voice: null, speaking: false, owner: null, cloud: false };
const listeners = new Set<() => void>();
let initialized = false;
/** Only the newest utterance may change `speaking` or start audio: speak()
 *  cancels the previous one, and its late events (or a slow fetch) must
 *  not flip the mouth or talk over the new line. */
let utteranceId = 0;
/** Owner of the newest utterance, set the moment speak() is called — not
 *  when audio starts — so a guide that unmounts while its Cartesia line is
 *  still being fetched can still cancel it. */
let currentOwner: string | null = null;
/** The one utterance (by id) an owner-scoped stopSpeaking() must let
 *  through even though it matches currentOwner — set by speak()'s
 *  `surviveOwnerUnmount` (2026-09-14, FIX 1: tapping a topic label never
 *  spoke it). A screen that says something and unmounts in the same tick
 *  (pickTopic: say the label, then navigate) has its own useGuide unmount
 *  cleanup call stopSpeaking(itsOwnOwner) right after — currentOwner is
 *  still that owner, so without this the guide silenced the very line it
 *  just said. Consumed once: the NEXT real interruption (the mute toggle's
 *  ownerless stopSpeaking(), voice barge-in, or another speak()) cancels it
 *  normally — this only exempts the specific bogus self-cancellation. */
let protectedUtteranceId: number | null = null;

function emit(patch: Partial<SpeechState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function available() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice() {
  if (!available()) return;
  const voices = speechSynthesis.getVoices();
  const found = voices.find((v) => v.lang === "he-IL") || voices.find((v) => v.lang.startsWith("he")) || null;
  if (found !== state.voice) emit({ voice: found });
}

function init() {
  if (initialized || !available()) return;
  initialized = true;
  pickVoice();
  if (typeof speechSynthesis.addEventListener === "function") {
    speechSynthesis.addEventListener("voiceschanged", pickVoice);
  } else {
    speechSynthesis.onvoiceschanged = pickVoice;
  }
}

function subscribe(listener: () => void) {
  init();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---- Cartesia playback ---------------------------------------------------

/** Lines repeat constantly (🔊 replays, the thinking cue, map lines, a
 *  retried question), and each Cartesia call costs credit and ~a network
 *  round trip. Cache the audio per (voice, text) for the session. */
const CACHE_MAX = 60;
const audioCache = new Map<string, string>(); // `${character}|${text}` -> blob URL
let audioEl: HTMLAudioElement | null = null;
let silentUrl: string | null = null;
let pendingFetch: AbortController | null = null;

function getAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  return audioEl;
}

/** 0.1s of silence as a tiny WAV — used only to unlock the audio element. */
function silentWavUrl(): string {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const ascii = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true); // sample rate
  v.setUint32(28, 8000, true); // byte rate
  v.setUint16(32, 1, true); // block align
  v.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128); // 8-bit silence
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/**
 * iOS Safari only lets an <audio> element play if it has played once
 * inside a user gesture. Cartesia audio always arrives *after* an await
 * (the fetch), outside any gesture — so on the first tap of the session we
 * play a muted blip of silence on the one shared element, which unlocks it
 * for every line after. Unverified on a real iPhone from here.
 */
function unlockAudio() {
  const a = getAudio();
  silentUrl ??= silentWavUrl();
  const blip = silentUrl;
  a.muted = true;
  a.src = blip;
  a.play()
    .then(() => {
      // Only pause if a real line hasn't already taken over the element.
      if (a.src === blip) a.pause();
    })
    .catch(() => {})
    .finally(() => {
      a.muted = false;
    });
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    () => {
      gestureSeen = true;
      unlockAudio();
    },
    { once: true, capture: true }
  );
}

function cachePut(key: string, url: string) {
  audioCache.set(key, url);
  while (audioCache.size > CACHE_MAX) {
    const [oldKey, oldUrl] = audioCache.entries().next().value as [string, string];
    audioCache.delete(oldKey);
    if (audioEl?.src !== oldUrl) URL.revokeObjectURL(oldUrl);
  }
}

const prefetching = new Set<string>();

/**
 * At most this many warm-up prefetches in flight at once.
 *
 * Cartesia answers concurrent requests beyond the plan's limit with
 * `429 concurrency_limited`, which our `speak` route reports as a 502. An
 * exercise screen fires five prefetches on mount (the two scripted lines
 * plus the three verdict openers). Measured against the real API: with 2
 * prefetches 0/16 failed, with 5 at once 6/40 (15%). Two in flight, plus
 * at most one live line, is the shape that measured clean.
 *
 * The cost is that the fifth line is warm a couple of seconds later than
 * it would have been. A line still cold when it is needed is simply
 * fetched live, exactly as it was before it was ever prefetched.
 */
const PREFETCH_MAX_IN_FLIGHT = 2;

/**
 * Longest a single prefetch may hold its slot. Without this a hung request
 * would occupy one permanently, and two of them would silently end
 * prefetching for the rest of the session — nothing waits on a warm-up, so
 * nothing would ever notice. A healthy prefetch takes 1-3s (niqqud has a
 * 5s deadline of its own, then Cartesia); 15s is far past that.
 */
const PREFETCH_TIMEOUT_MS = 15_000;
let prefetchTimeoutMs = PREFETCH_TIMEOUT_MS;

const prefetchLimiter = createLimiter(PREFETCH_MAX_IN_FLIGHT);

/**
 * Voice-experience fix item 1 (2026-09-15): warms the same cache
 * speakCloud() reads from, for a line whose exact text is known before
 * the character actually needs to say it — a greeting, a praise line, a
 * topic prompt (lib/guide/lines.ts's fully-static functions; the LLM
 * feedback lines can't be prefetched, their text doesn't exist yet).
 * When the moment comes, speak() finds the audio already in hand instead
 * of paying Cartesia's network round trip live — this is the actual
 * "TTS" number in the per-stage timing (lib/voice/timing.ts's
 * "speak-start" leg) for every line prefetched far enough ahead.
 *
 * Fetch only, no playback — doesn't touch the shared <audio> element and
 * needs no user gesture, so it's safe to call from an effect on mount
 * rather than waiting for a tap. Silently gives up on any failure (no
 * Cartesia configured, offline, 401 before sign-in settles): speak()
 * still works normally, it just pays the round trip at that point
 * instead of having paid it early.
 *
 * Runs through prefetchLimiter: at most PREFETCH_MAX_IN_FLIGHT at once,
 * first come first served. Live speaks (speakCloud) never go through it.
 */
export function prefetchSpeech(text: string, character: CharacterId) {
  if (!text || typeof window === "undefined") return;
  const key = `${character}|${text}`;
  if (audioCache.has(key) || prefetching.has(key)) return;
  // Marked at enqueue, not at start, so a line asked for twice while it
  // waits its turn is still only fetched once.
  prefetching.add(key);
  void prefetchLimiter
    .run(async () => {
      // A live speak may have cached this line while it was waiting.
      if (audioCache.has(key)) return;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), prefetchTimeoutMs);
      try {
        const res = await fetch("/api/tutor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // prefetch: nobody is waiting on this one, so the server lets the
          // niqqud step take the time it needs and caches the properly
          // vocalized clip — see lib/tts/cartesia.ts.
          body: JSON.stringify({ action: "speak", text, character, prefetch: true }),
          signal: ctrl.signal,
        });
        // The slot is held until the BODY is read, not just the headers:
        // that is when Cartesia stops counting this request.
        const blob = res.ok ? await res.blob() : null;
        if (blob) cachePut(key, URL.createObjectURL(blob));
      } catch {
        // Silent by design — see above.
      } finally {
        clearTimeout(timer);
      }
    })
    .finally(() => prefetching.delete(key));
}

function stopPlayback() {
  pendingFetch?.abort();
  pendingFetch = null;
  activeWatchdog?.cancel();
  activeWatchdog = null;
  if (audioEl && !audioEl.paused) audioEl.pause();
  // Only when the engine actually has something in flight. speak() calls
  // this unconditionally on every utterance, and useVoiceInput's barge-in
  // (lib/voice/useVoiceInput.ts's start()) calls stopSpeaking() — which
  // calls this — on every single mic press, whether or not the character
  // is talking. Calling cancel() on an idle engine cancels nothing, but
  // WebKit and Chromium both have long-documented bugs where a cancel()
  // issued back-to-back with the next speak() — exactly what a rapid
  // press-then-answer voice turn produces — can leave the synthesis queue
  // wedged, silently dropping every speak() after it for the rest of the
  // page's life. Gating on "is there actually something to cancel" removes
  // the redundant calls without changing behavior when something really is
  // playing or queued.
  if (available() && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}

/** Resolves true when the line is handled (playing, or superseded by a
 *  newer line); false when the caller should fall back to the browser
 *  voice. `onEnd`, when given, fires once this exact utterance genuinely
 *  finishes (not superseded) — used by voice-experience fix item 3's
 *  answer-option readout to chain "speak the next thing" without a
 *  fragile speaking-flag poll. */
/** The one container Cartesia returns here (lib/tts/cartesia.ts asks for
 *  mp3), and the only type this progressive path ever feeds to MSE. */
const MP3_MIME = "audio/mpeg";

type MediaSourceCtor = {
  new (): MediaSource;
  isTypeSupported?(type: string): boolean;
};

/** MediaSource, or Safari 17+'s ManagedMediaSource. iPhone Safari had
 *  neither until iOS 17, which is exactly why every caller here must keep
 *  working when this returns null — the blob path below stays the
 *  fallback, unchanged, and is what that platform still uses. */
function getMediaSourceCtor(): MediaSourceCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { MediaSource?: MediaSourceCtor; ManagedMediaSource?: MediaSourceCtor };
  const ctor = w.ManagedMediaSource ?? w.MediaSource;
  if (!ctor || typeof ctor.isTypeSupported !== "function") return null;
  return ctor.isTypeSupported(MP3_MIME) ? ctor : null;
}

/**
 * What an MSE-backed line hands back: the src to play, a way to tear the
 * MediaSource down, and a way to get the COMPLETE clip as a blob URL if the
 * streaming attempt has to be abandoned (see speakCloud's handOff).
 */
interface MseStream {
  src: string;
  /** Detach the MediaSource. The network read is NOT stopped — the fallback
   *  needs those bytes. */
  teardown(): void;
  /** The finished clip as a cached blob URL, or null if it can't be had.
   *  Works whether or not the MediaSource ever opened. */
  whole(): Promise<string | null>;
}

/**
 * Attaches a streaming response to the shared <audio> element so playback
 * can begin on the FIRST chunk instead of after the last one.
 *
 * Before this, speakCloud awaited res.blob() — the whole clip had to
 * arrive before a single sample could play, on top of Cartesia's own
 * ~495ms time-to-first-byte. The child waited through the download too.
 *
 * Returns null when this browser can't do it (the caller then falls back
 * to the buffered path). The full clip is still assembled in the
 * background and written to audioCache on completion, so a replay — the 🔊
 * tap, a repeated line — uses the same proven blob URL it always did,
 * including FIX 6's currentTime reset.
 *
 * Whoever reads the response body owns it: either the MediaSource's
 * `sourceopen` handler (the normal case) or `whole()` (when the
 * MediaSource never opened, which is a real failure mode on Safari). The
 * `bodyClaimed` flag stops the two ever both trying.
 */
function streamToAudioSrc(res: Response, key: string): MseStream | null {
  const Ctor = getMediaSourceCtor();
  if (!Ctor || !res.body) return null;

  let mediaSource: MediaSource;
  try {
    mediaSource = new Ctor();
  } catch {
    return null;
  }
  const srcUrl = URL.createObjectURL(mediaSource);

  let torn = false;
  let bodyClaimed = false;
  let settle: (ok: boolean) => void = () => {};
  /** Resolves true once the complete clip has been read AND cached. */
  const finished = new Promise<boolean>((resolve) => {
    settle = resolve;
  });

  mediaSource.addEventListener("sourceopen", () => {
    // Torn down before it opened, or `whole()` already took the body.
    if (torn || bodyClaimed) return;
    bodyClaimed = true;

    let buffer: SourceBuffer;
    try {
      buffer = mediaSource.addSourceBuffer(MP3_MIME);
    } catch {
      // Can't feed it — but the body is still ours to read, so the clip is
      // recoverable as a blob. The watchdog notices the silence.
      buffer = null as unknown as SourceBuffer;
    }
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    const queue: Uint8Array[] = [];
    let ended = false;

    const pump = () => {
      if (torn || !buffer || buffer.updating) return;
      const next = queue.shift();
      if (next) {
        try {
          buffer.appendBuffer(next as BufferSource);
        } catch {
          /* quota or closed source — stop feeding, let what's buffered play */
        }
        return;
      }
      if (ended && mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch {
          /* already ended */
        }
      }
    };

    buffer?.addEventListener("updateend", pump);

    // Keeps reading to the end even after teardown: the fallback path
    // wants the complete clip, and it is already on its way.
    const read = () => {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            ended = true;
            // Cache the complete clip for replays, on the ordinary path.
            const blob = new Blob(chunks as BlobPart[], { type: MP3_MIME });
            cachePut(key, URL.createObjectURL(blob));
            pump();
            settle(true);
            return;
          }
          if (value) {
            chunks.push(value);
            queue.push(value);
            pump();
          }
          read();
        })
        .catch(() => {
          ended = true;
          pump();
          settle(false);
        });
    };
    read();
  });

  return {
    src: srcUrl,
    teardown() {
      if (torn) return;
      torn = true;
      try {
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
      } catch {
        /* mid-update or already closed */
      }
      try {
        URL.revokeObjectURL(srcUrl);
      } catch {
        /* nothing to revoke */
      }
    },
    async whole() {
      const cached = audioCache.get(key);
      if (cached) return cached;
      if (!bodyClaimed) {
        // The MediaSource never opened, so nothing has read the body.
        bodyClaimed = true;
        try {
          const url = URL.createObjectURL(await res.blob());
          cachePut(key, url);
          return url;
        } catch {
          return null;
        }
      }
      // The sourceopen reader has it; wait for it to finish.
      return (await finished) ? (audioCache.get(key) ?? null) : null;
    },
  };
}

/** The stall watchdog for the line currently playing, if it is MSE-backed.
 *  Cancelled by stopPlayback() so a superseded line's timer can never fire
 *  into the next one. */
let activeWatchdog: { cancel(): void } | null = null;

/** Set the first time an MSE line stalls. From then on this session goes
 *  straight to the blob path — otherwise a platform where MSE is broken
 *  but the UA gate doesn't catch it would pay the full watchdog wait on
 *  every single line. */
let mseDisabledForSession = false;

let stallMs = STALL_TIMEOUT_MS;
/** How long the fallback will wait for the rest of the clip to arrive
 *  before giving up on the blob path and using the browser voice. */
let wholeClipWaitMs = 6000;

/** Test-only handles on the module's timing and breaker state. */
export const __speechTestHooks = {
  setStallMs(ms: number) {
    stallMs = ms;
  },
  setWholeClipWaitMs(ms: number) {
    wholeClipWaitMs = ms;
  },
  setPrefetchTimeoutMs(ms: number) {
    prefetchTimeoutMs = ms;
  },
  reset() {
    mseDisabledForSession = false;
    stallMs = STALL_TIMEOUT_MS;
    wholeClipWaitMs = 6000;
    prefetchTimeoutMs = PREFETCH_TIMEOUT_MS;
  },
  isMseDisabled: () => mseDisabledForSession,
};

const errName = (err: unknown) => (err as { name?: string })?.name ?? "error";

/** Resolves to `null` if `p` hasn't settled in `ms`. Clears its own timer. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function speakCloud(
  text: string,
  character: CharacterId,
  owner: string | null,
  id: number,
  onEnd?: () => void,
  live?: boolean
): Promise<boolean> {
  const key = `${character}|${text}`;
  let url = audioCache.get(key);
  /** Set only when this line is MSE-backed: a live MediaSource being fed,
   *  not a finished blob — it has no seekable position to reset yet (see
   *  FIX 6 below), and it is the only kind of line the stall watchdog and
   *  the MSE -> blob fallback apply to. */
  let stream: MseStream | null = null;

  if (url) {
    logAudioPath("blob", "cache-hit");
  } else {
    const ctrl = new AbortController();
    pendingFetch = ctrl;
    const res = await fetch("/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "speak", text, character, live: live === true }),
      signal: ctrl.signal,
    });
    if (pendingFetch === ctrl) pendingFetch = null;
    if (id !== utteranceId) return true;
    if (res.status === 401 || res.status === 503) {
      emit({ cloud: false });
      logAudioPath("speechSynthesis", `http-${res.status} (cloud voice off for the session)`);
      return false;
    }
    if (!res.ok) {
      logAudioPath("speechSynthesis", `http-${res.status}`);
      return false;
    }

    // The platform gate. On iOS/iPadOS this returns "blob" without touching
    // any MediaSource API, so that path is exactly what it was before
    // streaming existed. See lib/speech/audioPath.ts for why.
    const choice = pickAudioPath(readAudioEnv(), () => getMediaSourceCtor() !== null, mseDisabledForSession);
    if (choice.path === "mse") stream = streamToAudioSrc(res, key);
    if (stream) {
      url = stream.src;
      logAudioPath("mse", choice.reason);
      // Deliberately NOT cachePut here — streamToAudioSrc writes the
      // finished blob to the cache once the last chunk lands. Caching a
      // live MediaSource URL would hand the next replay a source that has
      // already ended.
    } else {
      logAudioPath("blob", choice.path === "mse" ? "mse-construct-failed" : choice.reason);
      url = URL.createObjectURL(await res.blob());
      cachePut(key, url);
    }
    if (id !== utteranceId) return true;
  }

  const a = getAudio();
  let started = false;
  /** The MSE attempt was abandoned and a fallback owns this line now.
   *  Everything from the abandoned attempt must go quiet — above all its
   *  pending play() promise, which rejects with AbortError the moment the
   *  fallback swaps the src, and would otherwise trip speak()'s own
   *  fallback to the browser voice ON TOP of the blob one (double speech). */
  let handedOff = false;
  /** The fallback has put its own src on the element. Until then, events
   *  from the torn-down source are noise, not news. */
  let fallbackSrcSet = false;

  const wire = (stage: "primary" | "fallback") => {
    a.onplaying = () => {
      started = true;
      activeWatchdog?.cancel();
      if (id === utteranceId) emit({ speaking: true, owner });
    };
    a.onended = () => {
      activeWatchdog?.cancel();
      if (id === utteranceId) {
        emit({ speaking: false, owner: null });
        onEnd?.();
      }
    };
    a.onerror = () => {
      if (id !== utteranceId) return;
      if (stage === "fallback" && !fallbackSrcSet) return;
      emit({ speaking: false, owner: null });
      if (started) {
        onEnd?.();
        return;
      }
      // An MSE element that errors before playing goes to the blob path
      // first — MSE -> blob -> speechSynthesis, in that order.
      if (stage === "primary" && stream) {
        void handOff("element-error");
        return;
      }
      logAudioPath("speechSynthesis", stage === "fallback" ? "blob-element-error" : "element-error");
      speakBrowser(text, owner, id, onEnd);
    };
  };

  /**
   * Abandon the MSE attempt: tear the MediaSource down, play the same clip
   * from a blob instead, and only if THAT fails use the browser voice.
   */
  const handOff = async (reason: string) => {
    if (handedOff || id !== utteranceId || !stream) return;
    handedOff = true;
    activeWatchdog?.cancel();
    mseDisabledForSession = true;
    a.onplaying = a.onended = a.onerror = null;
    a.pause();
    stream.teardown();
    logAudioPath("blob", `fallback:${reason}`);

    const blobUrl = await withTimeout(stream.whole(), wholeClipWaitMs).catch(() => null);
    if (id !== utteranceId) return;
    if (!blobUrl) {
      logAudioPath("speechSynthesis", "blob-unavailable");
      speakBrowser(text, owner, id, onEnd);
      return;
    }

    wire("fallback");
    a.muted = false;
    a.src = blobUrl;
    fallbackSrcSet = true;
    a.currentTime = 0;
    try {
      await a.play();
    } catch (err) {
      if (id !== utteranceId) return;
      logAudioPath("speechSynthesis", `blob-play-rejected:${errName(err)}`);
      speakBrowser(text, owner, id, onEnd);
    }
  };

  wire("primary");
  a.muted = false;
  a.src = url;
  // FIX 6 (2026-09-14): replaying a cached line — a 🔊 tap on the same
  // bubble twice, or the identical line said again right after — can
  // silently produce no audio at all. Assigning `.src` the SAME string it
  // already holds (audioCache means a repeated line reuses the exact same
  // blob URL) doesn't reliably reset playback position across browsers —
  // notably iOS Safari, this app's main target. play() on an element
  // already at the end of that clip just... does nothing audible: no
  // error, onerror never fires, onplaying may or may not fire either.
  // Explicitly resetting the position before every play() call — cached
  // replay or a first play, tap or voice, since both go through this one
  // function — costs nothing on a fresh src and fixes the stale one.
  // A live MediaSource has nothing buffered yet — it starts at 0 by
  // definition, and assigning currentTime before the first append throws
  // in some browsers. Only the blob path (the one FIX 6 is about) needs
  // the reset.
  if (!stream) a.currentTime = 0;

  if (!stream) {
    try {
      await a.play();
    } catch (err) {
      if (id !== utteranceId) return true;
      logAudioPath("speechSynthesis", `play-rejected:${errName(err)}`);
      return false;
    }
    return true;
  }

  // MSE-backed: armed BEFORE play(), because a stalled element can leave
  // play()'s own promise pending forever — waiting on it would be waiting
  // on the very thing that has failed.
  activeWatchdog?.cancel();
  activeWatchdog = startStallWatchdog({
    timeoutMs: stallMs,
    isPlaying: () => started || a.currentTime > 0,
    onStall: () => {
      if (id === utteranceId) void handOff("stall");
    },
  });
  try {
    await a.play();
  } catch (err) {
    // The fallback already owns the line (this is its src swap aborting
    // our play), or a newer line does. Either way, nothing more to do.
    if (handedOff || id !== utteranceId) return true;
    await handOff(`play-rejected:${errName(err)}`);
  }
  return true;
}

// ---- Browser voice ---------------------------------------------------------

function speakBrowser(text: string, owner: string | null, id: number, onEnd?: () => void) {
  const voice = state.voice;
  if (id !== utteranceId) return;
  if (!voice || !available()) {
    // The fallback chain ended in a voice that doesn't exist here. That is
    // silence, and it must not look like a healthy fallback in the trace.
    logAudioPath("speechSynthesis", available() ? "SILENT: no Hebrew voice installed" : "SILENT: speechSynthesis unavailable");
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.onstart = () => {
    if (id === utteranceId) emit({ speaking: true, owner });
  };
  const done = () => {
    if (id === utteranceId) {
      emit({ speaking: false, owner: null });
      onEnd?.();
    }
  };
  utterance.onend = done;
  utterance.onerror = done;
  speechSynthesis.speak(utterance);
}

// ---- Public API --------------------------------------------------------------

/**
 * Say a line. With a `character`, it's said in that character's Cartesia
 * voice (falling back to the browser voice if that fails); without one,
 * in the browser voice. Starts a new utterance and cancels the previous.
 *
 * For the first speech of a session, call this synchronously inside the
 * tap handler — the tap is what unlocks audio on iOS. Callers that speak
 * from effects or async callbacks must check hasSeenGesture().
 *
 * `surviveOwnerUnmount`: for a line said right before the same handler
 * navigates away (e.g. FreePractice's pickTopic: say the topic's name,
 * then switch screens) — see protectedUtteranceId's comment. Leave unset
 * for every ordinary line; an unprotected owner-unmount stop still works
 * exactly as before.
 */
export function speak(
  text: string,
  owner: string | null = null,
  character?: CharacterId | null,
  opts?: { surviveOwnerUnmount?: boolean; onEnd?: () => void; live?: boolean }
) {
  if (!text) return;
  const id = ++utteranceId;
  currentOwner = owner;
  protectedUtteranceId = opts?.surviveOwnerUnmount ? id : null;
  stopPlayback();
  if (state.speaking) emit({ speaking: false, owner: null });

  if (character && state.cloud && typeof window !== "undefined") {
    speakCloud(text, character, owner, id, opts?.onEnd, opts?.live)
      .then((handled) => {
        // speakCloud has already traced why it declined.
        if (!handled && id === utteranceId) speakBrowser(text, owner, id, opts?.onEnd);
      })
      .catch((err) => {
        // AbortError when superseded (id moved on — nothing to do);
        // otherwise a network or autoplay failure: fall back.
        if (id === utteranceId) {
          logAudioPath("speechSynthesis", `exception:${(err as { name?: string })?.name ?? "error"}`);
          speakBrowser(text, owner, id, opts?.onEnd);
        }
      });
    return;
  }
  logAudioPath(
    "speechSynthesis",
    !character ? "no-character" : !state.cloud ? "cloud-voice-off" : "no-window"
  );
  speakBrowser(text, owner, id, opts?.onEnd);
}

/**
 * Stop whatever is being said. With an `owner`, only stops if that owner
 * said the current line — so a guide unmounting (the kid leaving the map
 * mid-sentence) silences its own line, even one still being fetched,
 * without cutting off whoever spoke next. Used by the mute toggle (no
 * owner: stop everything, ignoring any protected utterance — a genuine
 * mute always wins).
 *
 * Exception: an owner-scoped call never cancels the one utterance that
 * owner just marked surviveOwnerUnmount — its own unmount cleanup running
 * right after `say(line, {surviveUnmount: true})` must not silence the
 * line it was told to protect. Consumed the first time it's checked, so a
 * later, real owner-scoped stop for that owner (should this ever happen
 * twice) behaves normally again.
 */
export function stopSpeaking(owner?: string) {
  if (owner !== undefined && currentOwner !== owner) return;
  if (owner !== undefined && protectedUtteranceId !== null && utteranceId === protectedUtteranceId) {
    protectedUtteranceId = null;
    return;
  }
  utteranceId++;
  currentOwner = null;
  stopPlayback();
  if (state.speaking) emit({ speaking: false, owner: null });
}

/**
 * The characters' read-aloud. `supported: false` only when neither voice
 * can work (no Cartesia this session and no Hebrew browser voice) —
 * callers must not show an affordance that would silently fail to speak.
 *
 * With an `owner`, `speak` is bound to it (and to `character`, whose
 * voice it uses) and `speaking` is true only while that owner — or an
 * ownerless request — is talking: the flag a character's mouth-sync
 * follows. Without one, `speaking` is the raw global flag.
 */
export function useSpeech(owner?: string, character?: CharacterId | null) {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  const mine = owner === undefined || s.owner === null || s.owner === owner;
  return {
    speak: (text: string) => speak(text, owner ?? null, character),
    speaking: s.speaking && mine,
    supported: s.cloud || !!s.voice,
  };
}
