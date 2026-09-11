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

function stopPlayback() {
  pendingFetch?.abort();
  pendingFetch = null;
  if (audioEl && !audioEl.paused) audioEl.pause();
  if (available()) speechSynthesis.cancel();
}

/** Resolves true when the line is handled (playing, or superseded by a
 *  newer line); false when the caller should fall back to the browser
 *  voice. */
async function speakCloud(text: string, character: CharacterId, owner: string | null, id: number): Promise<boolean> {
  const key = `${character}|${text}`;
  let url = audioCache.get(key);

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
    url = URL.createObjectURL(await res.blob());
    cachePut(key, url);
    if (id !== utteranceId) return true;
  }

  const a = getAudio();
  let started = false;
  a.onplaying = () => {
    started = true;
    if (id === utteranceId) emit({ speaking: true, owner });
  };
  a.onended = () => {
    if (id === utteranceId) emit({ speaking: false, owner: null });
  };
  a.onerror = () => {
    if (id !== utteranceId) return;
    emit({ speaking: false, owner: null });
    if (!started) speakBrowser(text, owner, id);
  };
  a.muted = false;
  a.src = url;
  await a.play();
  return true;
}

// ---- Browser voice ---------------------------------------------------------

function speakBrowser(text: string, owner: string | null, id: number) {
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
    if (id === utteranceId) emit({ speaking: false, owner: null });
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
 */
export function speak(text: string, owner: string | null = null, character?: CharacterId | null) {
  if (!text) return;
  const id = ++utteranceId;
  currentOwner = owner;
  stopPlayback();
  if (state.speaking) emit({ speaking: false, owner: null });

  if (character && state.cloud && typeof window !== "undefined") {
    speakCloud(text, character, owner, id)
      .then((handled) => {
        if (!handled && id === utteranceId) speakBrowser(text, owner, id);
      })
      .catch(() => {
        // AbortError when superseded (id moved on — nothing to do);
        // otherwise a network or autoplay failure: fall back.
        if (id === utteranceId) speakBrowser(text, owner, id);
      });
    return;
  }
  speakBrowser(text, owner, id);
}

/**
 * Stop whatever is being said. With an `owner`, only stops if that owner
 * said the current line — so a guide unmounting (the kid leaving the map
 * mid-sentence) silences its own line, even one still being fetched,
 * without cutting off whoever spoke next. Used by the mute toggle (no
 * owner: stop everything).
 */
export function stopSpeaking(owner?: string) {
  if (owner !== undefined && currentOwner !== owner) return;
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
