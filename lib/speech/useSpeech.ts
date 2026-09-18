"use client";

import { useSyncExternalStore } from "react";
import type { CharacterId } from "@/lib/characters";

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
 */
export function prefetchSpeech(text: string, character: CharacterId) {
  if (!text || typeof window === "undefined") return;
  const key = `${character}|${text}`;
  if (audioCache.has(key) || prefetching.has(key)) return;
  prefetching.add(key);
  fetch("/api/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // prefetch: nobody is waiting on this one, so the server lets the
    // niqqud step take the time it needs and caches the properly
    // vocalized clip — see lib/tts/cartesia.ts.
    body: JSON.stringify({ action: "speak", text, character, prefetch: true }),
  })
    .then((res) => (res.ok ? res.blob() : null))
    .then((blob) => {
      if (blob) cachePut(key, URL.createObjectURL(blob));
    })
    .catch(() => {})
    .finally(() => prefetching.delete(key));
}

function stopPlayback() {
  pendingFetch?.abort();
  pendingFetch = null;
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
 * Attaches a streaming response to the shared <audio> element so playback
 * can begin on the FIRST chunk instead of after the last one.
 *
 * Before this, speakCloud awaited res.blob() — the whole clip had to
 * arrive before a single sample could play, on top of Cartesia's own
 * ~495ms time-to-first-byte. The child waited through the download too.
 *
 * Returns the src to play, or null when this browser can't do it (the
 * caller then falls back to the buffered path). The full clip is still
 * assembled in the background and written to audioCache on completion, so
 * a replay — the 🔊 tap, a repeated line — uses the same proven blob URL
 * it always did, including FIX 6's currentTime reset.
 */
function streamToAudioSrc(res: Response, key: string): string | null {
  const Ctor = getMediaSourceCtor();
  if (!Ctor || !res.body) return null;

  let mediaSource: MediaSource;
  try {
    mediaSource = new Ctor();
  } catch {
    return null;
  }
  const srcUrl = URL.createObjectURL(mediaSource);

  mediaSource.addEventListener("sourceopen", () => {
    let buffer: SourceBuffer;
    try {
      buffer = mediaSource.addSourceBuffer(MP3_MIME);
    } catch {
      // Nothing to recover to here — the element's onerror path (already
      // wired by the caller) falls back to the browser voice.
      return;
    }
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    const queue: Uint8Array[] = [];
    let ended = false;

    const pump = () => {
      if (buffer.updating) return;
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

    buffer.addEventListener("updateend", pump);

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
        });
    };
    read();
  });

  return srcUrl;
}

async function speakCloud(
  text: string,
  character: CharacterId,
  owner: string | null,
  id: number,
  onEnd?: () => void
): Promise<boolean> {
  const key = `${character}|${text}`;
  let url = audioCache.get(key);
  /** True when `url` is a live MediaSource being fed, not a finished blob
   *  — it has no seekable position to reset yet (see FIX 6 below). */
  let progressive = false;

  if (!url) {
    const ctrl = new AbortController();
    pendingFetch = ctrl;
    const res = await fetch("/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "speak", text, character }),
      signal: ctrl.signal,
    });
    if (pendingFetch === ctrl) pendingFetch = null;
    if (id !== utteranceId) return true;
    if (res.status === 401 || res.status === 503) {
      emit({ cloud: false });
      return false;
    }
    if (!res.ok) return false;
    const streamed = streamToAudioSrc(res, key);
    if (streamed) {
      url = streamed;
      progressive = true;
      // Deliberately NOT cachePut here — streamToAudioSrc writes the
      // finished blob to the cache once the last chunk lands. Caching a
      // live MediaSource URL would hand the next replay a source that has
      // already ended.
    } else {
      url = URL.createObjectURL(await res.blob());
      cachePut(key, url);
    }
    if (id !== utteranceId) return true;
  }

  const a = getAudio();
  let started = false;
  a.onplaying = () => {
    started = true;
    if (id === utteranceId) emit({ speaking: true, owner });
  };
  a.onended = () => {
    if (id === utteranceId) {
      emit({ speaking: false, owner: null });
      onEnd?.();
    }
  };
  a.onerror = () => {
    if (id !== utteranceId) return;
    emit({ speaking: false, owner: null });
    if (!started) speakBrowser(text, owner, id, onEnd);
    else onEnd?.();
  };
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
  if (!progressive) a.currentTime = 0;
  await a.play();
  return true;
}

// ---- Browser voice ---------------------------------------------------------

function speakBrowser(text: string, owner: string | null, id: number, onEnd?: () => void) {
  const voice = state.voice;
  if (!voice || !available() || id !== utteranceId) return;
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
  opts?: { surviveOwnerUnmount?: boolean; onEnd?: () => void }
) {
  if (!text) return;
  const id = ++utteranceId;
  currentOwner = owner;
  protectedUtteranceId = opts?.surviveOwnerUnmount ? id : null;
  stopPlayback();
  if (state.speaking) emit({ speaking: false, owner: null });

  if (character && state.cloud && typeof window !== "undefined") {
    speakCloud(text, character, owner, id, opts?.onEnd)
      .then((handled) => {
        if (!handled && id === utteranceId) speakBrowser(text, owner, id, opts?.onEnd);
      })
      .catch(() => {
        // AbortError when superseded (id moved on — nothing to do);
        // otherwise a network or autoplay failure: fall back.
        if (id === utteranceId) speakBrowser(text, owner, id, opts?.onEnd);
      });
    return;
  }
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
