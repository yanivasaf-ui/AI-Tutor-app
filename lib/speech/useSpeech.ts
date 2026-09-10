"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level "has the kid touched the screen yet this session" flag —
 * used to gate auto-read (UI Revamp Brief Section 4.1): TTS can only fire
 * inside a user-gesture call stack on iOS Safari, so speech triggered
 * before any tap must NOT try to auto-speak. Set once, globally, by the
 * first pointerdown anywhere — "has this session had a gesture" is a
 * page-level fact, not component state.
 */
let gestureSeen = false;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => { gestureSeen = true; }, { once: true, capture: true });
}

export function hasSeenGesture() {
  return gestureSeen;
}

/**
 * Speech state is ONE page-level fact, not per-component state.
 *
 * Why this changed (character-led redesign): `speechSynthesis` is a
 * browser singleton, but each `useSpeech()` call used to keep its own
 * `speaking` flag and its own voice. Two real bugs followed:
 *
 * 1. Mouth-sync only worked for the one instance that called speak().
 *    Tapping 🔊 inside a bubble (SpeakButton's own instance) read the
 *    line aloud while the character on screen stood still — the
 *    opposite of "the character reads every instruction aloud".
 * 2. Every instance assigned `speechSynthesis.onvoiceschanged`, so the
 *    last one to mount won and an unmounting one nulled it for
 *    everybody. On a cold load (Chrome loads voices async) an instance
 *    could silently never get a Hebrew voice: `supported: false`, and
 *    speak() quietly did nothing.
 *
 * Now there is one store: one voice lookup, one listener, one `speaking`
 * flag. Utterances carry an optional `owner` so that when two characters
 * are on screen (the map guide under the parent gate, the exercise
 * character under a full-screen celebration) only the one actually
 * talking moves its mouth.
 */
interface SpeechState {
  voice: SpeechSynthesisVoice | null;
  speaking: boolean;
  /** Who is saying the current utterance. null = an ownerless request
   *  (a bare 🔊 tap), which every on-screen character may lip-sync to. */
  owner: string | null;
}

let state: SpeechState = { voice: null, speaking: false, owner: null };
const SERVER_STATE: SpeechState = { voice: null, speaking: false, owner: null };
const listeners = new Set<() => void>();
let initialized = false;
/** Only the newest utterance may change `speaking`: speak() cancels the
 *  previous one, and its end/error event can arrive AFTER the new one's
 *  start — without this guard that late event flips `speaking` back to
 *  false mid-sentence and the mouth freezes. */
let utteranceId = 0;

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

/**
 * Must be called synchronously inside the tap handler when it's the first
 * speech of the session — iOS Safari only allows SpeechSynthesis inside a
 * direct user-gesture call stack and silently drops it otherwise. Callers
 * that speak from effects or async callbacks must check hasSeenGesture().
 */
export function speak(text: string, owner: string | null = null) {
  const voice = state.voice;
  if (!voice || !text || !available()) return;
  const id = ++utteranceId;
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

/**
 * Stop whatever is being said. With an `owner`, only stops if that owner
 * is the one talking — so a guide unmounting (the kid leaving the map
 * mid-sentence) silences its own line without cutting off whoever spoke
 * next. Used by the mute toggle (no owner: stop everything).
 */
export function stopSpeaking(owner?: string) {
  if (owner !== undefined && state.owner !== owner) return;
  utteranceId++;
  if (available()) speechSynthesis.cancel();
  if (state.speaking) emit({ speaking: false, owner: null });
}

/**
 * Free, on-device Hebrew read-aloud via the browser's SpeechSynthesis.
 * `supported: false` when the device has no Hebrew voice — callers must
 * not show an affordance that would silently fail to speak.
 *
 * With an `owner`, `speak` is bound to it and `speaking` is true only
 * while that owner (or an ownerless request) is talking — that's the flag
 * a character's mouth-sync should follow. Without one, `speaking` is the
 * raw global flag.
 */
export function useSpeech(owner?: string) {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  const mine = owner === undefined || s.owner === null || s.owner === owner;
  return {
    speak: (text: string) => speak(text, owner ?? null),
    speaking: s.speaking && mine,
    supported: !!s.voice,
  };
}
