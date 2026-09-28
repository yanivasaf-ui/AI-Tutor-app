"use client";

import { useEffect, useState } from "react";
import type { NumberLineData } from "@/lib/exercises/types";
import type { ManipulationKind } from "@/lib/character/manipulation";
import GhostHand from "@/components/exercises/GhostHand";
import { hasSeenFirstUseDemo, markFirstUseDemoSeen } from "@/lib/exercises/firstUseDemo";

interface Props {
  data: NumberLineData;
  disabled: boolean;
  onSubmit: (value: string) => void;
  /** Local, cosmetic "I saw that" hook (see lib/character/manipulation.ts). */
  onManipulate?: (kind: ManipulationKind) => void;
  /** Kids-App UX Benchmark item 6: whose first-use ghost-hand demo to
   *  check/mark (lib/exercises/firstUseDemo.ts) — required because the
   *  demo is keyed per kid, never a shared/global flag. */
  kidId: string;
}

/** How long the ghost hand is shown, in ms — the benchmark's own "~2
 *  seconds". */
const DEMO_DURATION_MS = 2000;

/**
 * Kids-App UX Benchmark, build-first item 4: the previous version rendered
 * each tick as a free-floating, flex-wrapped circle — on a long set (any
 * range wider than a phone screen) these wrapped onto a second and third
 * row, so "number LINE" stopped reading as a line at all, and each circle
 * was only 56px (h-14/min-w-14), under the ~76px (2cm-ish) touch-target
 * floor the benchmark cites.
 *
 * This version keeps every tick on ONE ordered row: a horizontally
 * scrollable track (never wraps — see TICK_COLUMN_WIDTH below) with a
 * continuous line running behind/through every tick, distinct endpoint
 * marks, and a ≥76px square tap target per tick (the whole column, not
 * just the small visual tick mark, is the <button>). Tapping still submits
 * immediately, same one-tap pattern as multiple_choice buttons and as this
 * widget had before.
 */

/** Each tick's own column width AND the floor for its tap target's other
 *  dimension (MIN_HIT_TARGET below) — the benchmark's ~76px (2cm at a
 *  nominal 96dpi screen) floor; the previous circles' 56px sat under it. */
const TICK_COLUMN_WIDTH = 76;
const MIN_HIT_TARGET = 76;

export default function NumberLineWidget({ data, disabled, onSubmit, onManipulate, kidId }: Props) {
  const ticks: number[] = [];
  for (let v = data.min; v <= data.max; v += data.step) ticks.push(v);

  // Kids-App UX Benchmark item 6: presentation-only — this state never
  // touches onSubmit/onManipulate or any placement/answer logic below,
  // and GhostHand itself is pointer-events-none, so a real tap during the
  // ~2s window reaches the real tick button exactly as if this weren't
  // rendered at all (nothing to "lose"). Checked once on mount, per kid
  // per widget kind, never per exercise.
  const [showDemo, setShowDemo] = useState(false);
  useEffect(() => {
    if (!hasSeenFirstUseDemo(kidId, "number_line")) setShowDemo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!showDemo) return;
    const timer = setTimeout(() => {
      setShowDemo(false);
      markFirstUseDemoSeen(kidId, "number_line");
    }, DEMO_DURATION_MS);
    return () => clearTimeout(timer);
  }, [showDemo, kidId]);
  // A real tap anywhere in the widget dismisses the (purely cosmetic)
  // overlay right away rather than letting it linger for the rest of the
  // window — the tap itself already succeeded via the button's own
  // onClick below; this only ever clears this local boolean.
  function dismissDemo() {
    if (showDemo) setShowDemo(false);
  }

  return (
    // overflow-x-auto, never flex-wrap: a long set scrolls horizontally
    // rather than wrapping into a second row and losing its "one line"
    // reading. The -mx-1/px-1 pair keeps the first/last tick's own focus
    // ring from being clipped by the scroll container's edge.
    <div className="overflow-x-auto overflow-y-hidden -mx-1 px-1 py-1" dir="ltr">
      <div className="flex items-stretch" style={{ width: ticks.length * TICK_COLUMN_WIDTH }}>
        {ticks.map((v, i) => {
          const isEndpoint = i === 0 || i === ticks.length - 1;
          return (
            <button
              key={v}
              type="button"
              onClick={() => {
                dismissDemo();
                // The answer goes first: the acknowledgment is decoration
                // and must never be able to delay or block it.
                onSubmit(String(v));
                onManipulate?.("tap");
              }}
              disabled={disabled}
              aria-label={String(v)}
              className="relative flex-none flex flex-col items-center justify-center gap-1.5 rounded-2xl hover:bg-[var(--color-teal-soft)]/60 disabled:opacity-50 disabled:hover:bg-transparent"
              style={{ width: TICK_COLUMN_WIDTH, minHeight: MIN_HIT_TARGET }}
            >
              {/* Ghost-hand demo: only on the FIRST tick, only while
                  showing. This button is already `position: relative`
                  (className above), which is all GhostHand needs to align
                  to it. */}
              {showDemo && i === 0 && <GhostHand />}
              {/* The rail: a full-width line segment in every column, edge
                  to edge with no gap between adjacent buttons — that's what
                  makes the whole set read as ONE continuous line rather
                  than separate chips, exactly as it did as separate circles
                  before. A small vertical tick crosses it at this column's
                  center; the two endpoints get a taller, bolder tick so the
                  line's extent is legible at a glance, even mid-scroll. */}
              <span className="relative flex items-center justify-center w-full h-6" aria-hidden="true">
                <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-[var(--color-teal)]/25" />
                <span
                  className={`relative rounded-full bg-[var(--color-teal)] ${
                    isEndpoint ? "w-1.5 h-7" : "w-1 h-4"
                  }`}
                />
              </span>
              <span className="font-medium text-xl text-[var(--color-ink)]">{v}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
