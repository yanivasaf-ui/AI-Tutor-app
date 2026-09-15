"use client";

import { useRef } from "react";
import { useVoiceInput } from "@/lib/voice/useVoiceInput";

/** What the button communicates right now. `listening` is owned
 *  internally (it's this component's own capture state); `thinking` and
 *  `speaking` are only knowable by the parent running the turn. */
export type MicPhase = "idle" | "listening" | "thinking" | "speaking";

/** A press this short from onPointerDown is almost certainly not a real
 *  release yet — see the onPointerLeave comment below. */
const LEAVE_GRACE_MS = 500;

interface Props {
  onResult: (transcript: string) => void;
  /** Capture ended with nothing usable heard — parent drives the
   *  "לא שמעתי, אפשר שוב?" re-ask (ROADMAP.md Phase 1A). */
  onNothingHeard?: () => void;
  /** The provider's raw error reason (lib/stt/provider.ts) — e.g.
   *  "not-allowed" when the OS/browser refused microphone access, as
   *  opposed to genuinely hearing nothing. Fires alongside
   *  onNothingHeard, not instead of it. */
  onError?: (reason: string) => void;
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
 * plus gesture handling only. The mic STREAM's own lifecycle (permission,
 * acquire-once, release timing) lives entirely in lib/stt/provider.ts /
 * useVoiceInput.ts and is untouched here — this file only decides what a
 * press LOOKS like.
 *
 * Touch hardening (2026-09-12 iPhone QA — "voice input fails"):
 * - `touch-none` (touch-action: none) stops iOS from treating the
 *   press-and-hold as a scroll/pan gesture, which could cancel the touch
 *   sequence entirely before onPointerUp ever fires.
 * - onPointerCancel ends the session the same way onPointerUp does — the
 *   OS can cancel a touch mid-press (an incoming call, a system gesture
 *   taking over) without ever sending pointerup, which used to leave the
 *   recognizer running with no way to stop it from this component.
 * - onPointerLeave ignores the first 500ms after press-down. Right after
 *   touchstart, iOS Safari can recompute hit-testing and fire a spurious
 *   pointerleave within the first frames — even though the finger never
 *   moved — which was ending the recording before a kid had said
 *   anything. onPointerUp/onPointerCancel are the authoritative "the kid
 *   let go" signals and always stop immediately, regardless of timing;
 *   this grace period only guards the supplementary leave signal.
 *
 * Touch hardening, round 2 (2026-09-14 iPhone QA — screenshot evidence:
 * text-selection highlight on press, and a duplicated "ghost" copy of the
 * button — iOS Safari's native long-press-to-select/drag on the emoji
 * glyph, which `touch-action: none` alone doesn't suppress (that property
 * governs scroll/zoom gestures, not text selection or drag). Selection
 * and drag are killed at both the CSS layer (select-none plus the
 * WebKit-specific properties Tailwind has no utility for — touch-callout,
 * user-drag, tap-highlight-color) and the event layer (onDragStart,
 * onContextMenu, onSelectStart all preventDefault) — belt and suspenders,
 * since a kid's grip is never a clean, centered, still tap.
 *
 * State legibility is carried by icon + colour + motion, NOT by text: the
 * kids who most need voice are the ones who can't yet read the label,
 * which is the whole reason this feature exists. The Hebrew strings here
 * are aria-labels for assistive tech, not instructions a child is
 * expected to read. Exactly three states a kid can be in: idle (nothing
 * happening yet), listening (recording — the ring makes this
 * unmistakable), thinking (released, waiting on the answer). `speaking`
 * is a fourth, parent-owned phase (the character is mid-line) that
 * borrows the same three-state visual language.
 */

/** WebKit-only declarations no build path here preserves reliably.
 *  React's inline `style` object sets each property via the DOM's
 *  CSSStyleDeclaration, which silently drops one the CURRENT browser
 *  doesn't define at all — confirmed here: Chromium has no
 *  -webkit-touch-callout, so the assignment no-opped. Tailwind's
 *  arbitrary-property syntax ([prop:value], compiled through this
 *  project's LightningCSS-based pipeline) hits the SAME wall at BUILD
 *  time — it validated the declaration away before the browser ever saw
 *  it. A literal <style> tag with plain CSS text (below, mounted once)
 *  is the one path neither strips: it's not run through either
 *  mechanism, just handed to the browser's own CSS parser, which skips
 *  an unrecognized declaration without dropping the rule — exactly the
 *  standard CSS error-recovery behavior this whole problem needed.
 *  `touch-action: none` (already applied via `touch-none`) only
 *  suppresses scroll/zoom gestures, not text selection or the drag
 *  affordance selected text gets on iOS — this covers those two. */
const NO_SELECTION_CLASS = "mic-btn-no-select";
const NO_SELECTION_CSS = `
  .${NO_SELECTION_CLASS}, .${NO_SELECTION_CLASS} * {
    -webkit-touch-callout: none;
    -webkit-user-drag: none;
    -webkit-tap-highlight-color: transparent;
  }
`;

/** Prevents the press itself from ever becoming a text selection or a
 *  drag — called on every event that could start either. */
function suppressSelectionAndDrag(e: { preventDefault: () => void }) {
  e.preventDefault();
}

export default function MicButton({
  onResult,
  onNothingHeard,
  onError,
  onListeningChange,
  busyPhase = null,
  disabled,
}: Props) {
  const { state, available, start, stop } = useVoiceInput({
    onTranscript: onResult,
    onNothingHeard,
    onError,
    disabled,
  });
  const pressStartedAtRef = useRef(0);

  // "processing" = released, the cloud engine is uploading/transcribing —
  // shown as thinking (⏳), and not tappable, so a second press can't race
  // the transcript that's still on its way.
  const phase: MicPhase =
    state === "listening" ? "listening" : state === "processing" ? "thinking" : (busyPhase ?? "idle");

  if (!available) return null;

  const visual: Record<MicPhase, { icon: string; className: string; label: string }> = {
    idle: {
      icon: "🎤",
      className: "bg-[var(--color-surface)]",
      label: "לחצו והחזיקו כדי לדבר",
    },
    listening: {
      icon: "🎤",
      // Distinct from the old style on purpose — a bigger scale jump plus
      // the expanding rings below (the same animate-ping language the map
      // uses for "you are here" — ProgressMap.tsx's MapNode) make
      // "recording" unmistakable at a glance, not just a subtle tint
      // change a kid could miss mid-press.
      className: "bg-[var(--color-teal)] scale-125 ring-4 ring-[var(--color-teal)]/50",
      label: "מקשיב/ה",
    },
    thinking: {
      icon: "⏳",
      className: "bg-[var(--color-teal-soft)] animate-pulse",
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

  function endPress() {
    stop();
    onListeningChange?.(false);
  }

  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: 72, height: 72 }}>
      {/* Expanding rings behind the button, only while genuinely
          recording — layered pings (staggered delay) read as "actively
          capturing sound" rather than a static highlight, legible without
          reading the aria-label. aria-hidden: purely decorative, the
          button's own aria-label already carries the state for assistive
          tech. */}
      {phase === "listening" && (
        <>
          <span aria-hidden className="absolute inset-0 rounded-full animate-ping bg-[var(--color-teal)]/40" />
          <span
            aria-hidden
            className="absolute inset-0 rounded-full animate-ping bg-[var(--color-teal)]/25"
            style={{ animationDelay: "0.3s" }}
          />
        </>
      )}
      <button
        type="button"
        // pointerdown/up, not click — the toggle model is exactly what
        // this deliberately avoids (see doc comment above).
        onPointerDown={() => {
          if (interactionDisabled) return;
          pressStartedAtRef.current = performance.now();
          start();
          onListeningChange?.(true);
        }}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={() => {
          if (performance.now() - pressStartedAtRef.current < LEAVE_GRACE_MS) return;
          endPress();
        }}
        // A held press must only ever be a press: never a text selection,
        // never a drag. touch-action: none (touch-none, below) covers
        // scroll/zoom gestures; these cover the two iOS Safari showed
        // instead (selection highlight, drag ghost).
        draggable={false}
        onDragStart={suppressSelectionAndDrag}
        onContextMenu={suppressSelectionAndDrag}
        onSelect={suppressSelectionAndDrag}
        disabled={interactionDisabled}
        aria-label={label}
        title={label}
        className={`relative touch-none select-none ${NO_SELECTION_CLASS} rounded-full flex items-center justify-center text-3xl shadow-md transition-transform disabled:opacity-60 ${className}`}
        style={{ width: 72, height: 72 }}
      >
        <style>{NO_SELECTION_CSS}</style>
        <span aria-hidden className="pointer-events-none select-none">
          {icon}
        </span>
      </button>
    </span>
  );
}
