"use client";

import { useSpeech } from "@/lib/speech/useSpeech";
import type { CharacterId } from "@/lib/characters";

interface Props {
  text: string;
  /** The character this line belongs to — so the replay moves *that*
   *  character's mouth (lib/speech/useSpeech.ts owner model)... */
  owner?: string;
  /** ...and is said in that character's own voice. */
  character?: CharacterId | null;
  className?: string;
}

/**
 * Thin wrapper around useSpeech (lib/speech/useSpeech.ts). Renders nothing
 * if neither voice can speak. Token colours, 44px hit target — it's a
 * kid-facing control, and the kids who need replay most are the ones with
 * the least precise taps.
 */
export default function SpeakButton({ text, owner, character, className }: Props) {
  const { speak, speaking, supported } = useSpeech(owner, character);

  if (!supported || !text) return null;

  return (
    <button
      onClick={() => speak(text)}
      type="button"
      aria-label="הקרא בקול"
      title="הקרא בקול"
      className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-lg transition-colors ${
        speaking ? "bg-[var(--color-teal-soft)] animate-pulse" : "bg-[var(--color-canvas)] hover:bg-[var(--color-teal-soft)]"
      } ${className ?? ""}`}
    >
      🔊
    </button>
  );
}
