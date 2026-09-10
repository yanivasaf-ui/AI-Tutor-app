"use client";

import { useSpeech } from "@/lib/speech/useSpeech";

interface Props {
  text: string;
  className?: string;
}

/**
 * Thin wrapper around useSpeech (lib/speech/useSpeech.ts) — the actual
 * SpeechSynthesis logic moved there (UI Revamp Brief Section 3.3) so
 * Character.tsx's mouth-sync can share the same `speaking` state without
 * duplicating voice-selection logic. This component's own API is
 * unchanged: same props, same render-nothing-if-unsupported behavior.
 */
export default function SpeakButton({ text, className }: Props) {
  const { speak, speaking, supported } = useSpeech();

  if (!supported || !text) return null;

  return (
    <button
      onClick={() => speak(text)}
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
