"use client";

import { useAutoSpeak } from "@/lib/speech/autoSpeak";
import { useSpeech } from "@/lib/speech/useSpeech";

/**
 * Device-level "stop reading aloud automatically" toggle (ROADMAP.md
 * Phase 1A). Now on every screen where the character speaks, since it
 * speaks everywhere. Hidden when the device has no Hebrew voice — same
 * rule as SpeakButton: no affordance that would silently do nothing.
 */
export default function MuteToggle() {
  const [on, setOn] = useAutoSpeak();
  const { supported } = useSpeech();
  if (!supported) return null;

  const label = on ? "כיבוי הקראה אוטומטית" : "הפעלת הקראה אוטומטית";
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      aria-label={label}
      title={label}
      aria-pressed={!on}
      className="w-11 h-11 rounded-full flex items-center justify-center text-xl bg-[var(--color-surface)] shadow-sm"
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}
