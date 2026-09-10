"use client";

import { useEffect, useState } from "react";

/**
 * Module-level "has the kid touched the screen yet this session" flag —
 * used to gate auto-read on exercise load (UI Revamp Brief Section 4.1):
 * TTS can only fire inside a user-gesture call stack on iOS Safari, so an
 * exercise arriving before any tap must NOT try to auto-speak. Set once,
 * globally, by the first pointerdown anywhere — not per-component state,
 * since "has this session had a gesture" is a page-level fact.
 */
let gestureSeen = false;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => { gestureSeen = true; }, { once: true, capture: true });
}

export function hasSeenGesture() {
  return gestureSeen;
}

/**
 * Shared SpeechSynthesis hook — extracted from the original SpeakButton.tsx
 * (which now wraps this) so Character.tsx's mouth-sync (UI Revamp Brief
 * Section 3.3) and any future TTS trigger point share one source of truth
 * instead of duplicating the voice-selection/gesture logic.
 *
 * Free, on-device Hebrew read-aloud via the browser's native
 * SpeechSynthesis API — zero cost, zero added backend latency. Renders
 * `supported: false` if no Hebrew voice exists on the device — callers
 * must not show an affordance that would silently fail to speak.
 */
export function useSpeech() {
  const [heVoice, setHeVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    function pickVoice() {
      const voices = speechSynthesis.getVoices();
      const found = voices.find((v) => v.lang === "he-IL") || voices.find((v) => v.lang.startsWith("he"));
      if (found) setHeVoice(found);
    }

    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
    return () => {
      speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Must run synchronously inside the click/tap handler, no `await` before
  // speak() — iOS Safari only allows SpeechSynthesis inside a direct
  // user-gesture call stack and silently drops it otherwise. Same
  // constraint documented in the original SpeakButton.tsx; UI Revamp Brief
  // Section 0 extends this rule to every sound in the app (Section 5).
  function speak(text: string) {
    if (!heVoice || !text) return;
    speechSynthesis.cancel(); // stop anything already playing first
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = heVoice;
    utterance.lang = heVoice.lang;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    speechSynthesis.speak(utterance);
  }

  return { speak, speaking, supported: !!heVoice };
}
