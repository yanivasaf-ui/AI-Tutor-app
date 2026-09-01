"use client";

import { useEffect, useState } from "react";

interface Props {
  text: string;
  className?: string;
}

/**
 * Free, on-device Hebrew read-aloud via the browser's native
 * SpeechSynthesis API — zero cost, zero added backend latency (runs
 * entirely client-side, no network round-trip, no TTS API bill). Built
 * as the MVP answer to "grade ב kids will have a hard time reading"
 * (Asaf, 2026-08-31) — listen-only, no voice input, matching the locked
 * "no STT for MVP" scope. Cartesia (~$1.50-2/kid/month, real per-turn
 * cost) stays the fallback if real listening tests show this free voice
 * isn't warm enough for a 7-year-old — not decided yet, needs a human
 * to actually listen on a real device, which is the whole point of
 * shipping this now instead of guessing.
 *
 * Renders nothing if no Hebrew voice exists on the device — never shows
 * a button that would silently fail to speak.
 */
export default function SpeakButton({ text, className }: Props) {
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

  if (!heVoice || !text) return null;

  // Must run synchronously inside the click handler, no `await` before
  // speak() — iOS Safari only allows SpeechSynthesis inside a direct
  // user-gesture call stack and silently drops it otherwise.
  function speak() {
    speechSynthesis.cancel(); // stop anything already playing first
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = heVoice;
    utterance.lang = heVoice!.lang;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    speechSynthesis.speak(utterance);
  }

  return (
    <button
      onClick={speak}
      type="button"
      aria-label="הקרא בקול"
      title="הקרא בקול"
      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border text-sm ${
        speaking ? "bg-blue-100 border-blue-300 animate-pulse" : "bg-slate-50 border-slate-200 hover:bg-blue-50"
      } ${className ?? ""}`}
    >
      🔊
    </button>
  );
}
