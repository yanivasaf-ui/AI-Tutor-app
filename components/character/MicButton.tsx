"use client";

import { useVoiceInput } from "@/lib/voice/useVoiceInput";

/** What the button communicates right now. `listening` is owned
 *  internally (it's this component's own capture state); `thinking` and
 *  `speaking` are only knowable by the parent running the turn. */
export type MicPhase = "idle" | "listening" | "thinking" | "speaking";

interface Props {
  onResult: (transcript: string) => void;
  /** Capture ended with nothing usable heard — parent drives the
   *  "לא שמעתי, אפשר שוב?" re-ask (ROADMAP.md Phase 1A). */
  onNothingHeard?: () => void;
  onListeningChange?: (listening: boolean) => void;
  /** Parent-owned phase, used when not actively listening. */
  busyPhase?: "thinking" | "speaking" | null;
  disabled?: boolean;
}

/**
 * Push-to-talk (UI Revamp Brief Section 6, ROADMAP.md Phase 1A).
 * Hold-to-record, not tap-to-toggle — a kid holding a button down has an
 * unambiguous mental model of "it's listening now"; a toggle risks a mic
 * left open. Voice is never the only input path (locked guardrail —
 * child Hebrew STT is fragile per the roadmap's own risk flag): this
 * button simply doesn't render when no STT provider is available, and
 * tap-answers stay fully usable either way.
 *
 * Capture moved to lib/voice/useVoiceInput.ts (over the swappable
 * provider in lib/stt/provider.ts) — this component is now presentation
 * plus gesture handling only.
 *
 * State legibility is carried by icon + colour + motion, NOT by text: the
 * kids who most need voice are the ones who can't yet read the label,
 * which is the whole reason this feature exists. The Hebrew strings here
 * are aria-labels for assistive tech, not instructions a child is
 * expected to read.
 */
export default function MicButton({
  onResult,
  onNothingHeard,
  onListeningChange,
  busyPhase = null,
  disabled,
}: Props) {
  const { state, available, start, stop } = useVoiceInput({
    onTranscript: onResult,
    onNothingHeard,
    disabled,
  });

  const phase: MicPhase = state === "listening" ? "listening" : (busyPhase ?? "idle");

  if (!available) return null;

  const visual: Record<MicPhase, { icon: string; className: string; label: string }> = {
    idle: {
      icon: "🎤",
      className: "bg-[var(--color-surface)]",
      label: "לחצו והחזיקו כדי לדבר",
    },
    listening: {
      icon: "🎤",
      className: "bg-[var(--color-teal)] scale-110 ring-4 ring-[var(--color-teal)]/40 animate-pulse",
      label: "מקשיב/ה",
    },
    thinking: {
      icon: "⏳",
      className: "bg-[var(--color-teal-soft)]",
      label: "חושב/ת",
    },
    speaking: {
      icon: "🔊",
      className: "bg-[var(--color-purple-soft)]",
      label: "מדבר/ת",
    },
  };
  const { icon, className, label } = visual[phase];

  // Busy phases aren't tappable: the turn is mid-flight and starting a new
  // capture would race the one in progress.
  const interactionDisabled = disabled || phase === "thinking" || phase === "speaking";

  return (
    <button
      type="button"
      // pointerdown/up, not click — the toggle model is exactly what this
      // deliberately avoids (see doc comment above).
      onPointerDown={() => {
        if (interactionDisabled) return;
        start();
        onListeningChange?.(true);
      }}
      onPointerUp={() => {
        stop();
        onListeningChange?.(false);
      }}
      onPointerLeave={() => {
        stop();
        onListeningChange?.(false);
      }}
      disabled={interactionDisabled}
      aria-label={label}
      title={label}
      className={`rounded-full flex items-center justify-center text-3xl shadow-md transition-transform disabled:opacity-60 ${className}`}
      style={{ width: 72, height: 72 }}
    >
      {icon}
    </button>
  );
}
