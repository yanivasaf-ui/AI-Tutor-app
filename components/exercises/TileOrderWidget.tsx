"use client";

import { useEffect, useRef, useState } from "react";
import type { TileOrderData } from "@/lib/exercises/types";
import { manipulationEvent, type ManipulationKind } from "@/lib/character/manipulation";

interface Props {
  data: TileOrderData;
  disabled: boolean;
  onSubmit: (value: string) => void;
  /** Local, cosmetic "I saw that" hook (see lib/character/manipulation.ts). */
  onManipulate?: (kind: ManipulationKind) => void;
}

/**
 * Tier 2 shared tap-to-place primitive, ordering variant — covers
 * pattern_completion, word_build, and sentence_order (see
 * output/exercise-types-build-brief.md). Tap a chip to place it in the
 * next empty slot; tap a filled slot to send it back to the bank.
 * Tap-to-place instead of real HTML5 drag-and-drop — the brief explicitly
 * allows this ("drag-and-drop or tap-to-place"), and it works the same on
 * mobile without a DnD library.
 *
 * Tracks placement by index into data.items, not by value, so repeated
 * letters/words (e.g. two identical letters in a word) stay distinguishable.
 */
export default function TileOrderWidget({ data, disabled, onSubmit, onManipulate }: Props) {
  const [placed, setPlaced] = useState<(number | null)[]>(Array(data.slotCount).fill(null));

  const usedIndices = new Set(placed.filter((i): i is number => i !== null));
  const allFilled = placed.every((p) => p !== null);

  // The acknowledgment is derived from the committed state, in an effect,
  // rather than from the tap handlers: those read a possibly-stale closure
  // (see the fast-double-tap note below), while this sees each real change
  // once. The ref starts at 0, so mounting an empty widget reacts to nothing.
  const filledCount = placed.filter((p) => p !== null).length;
  const prevFilled = useRef(0);
  const onManipulateRef = useRef(onManipulate);
  onManipulateRef.current = onManipulate;
  useEffect(() => {
    const kind = manipulationEvent(prevFilled.current, filledCount, placed.length);
    prevFilled.current = filledCount;
    if (kind) onManipulateRef.current?.(kind);
  }, [filledCount, placed.length]);

  function placeInNextSlot(itemIndex: number) {
    if (disabled) return;
    // Functional update — reading `placed`/`usedIndices` from the render
    // closure instead would go stale when two taps land before a
    // re-render (e.g. a fast double-tap), letting both compute the same
    // "next empty slot" and silently overwrite each other. Found via
    // real interactive testing, not a hypothetical.
    setPlaced((prev) => {
      if (prev.includes(itemIndex)) return prev;
      const nextEmpty = prev.findIndex((p) => p === null);
      if (nextEmpty === -1) return prev;
      const next = [...prev];
      next[nextEmpty] = itemIndex;
      return next;
    });
  }

  function removeFromSlot(slotIndex: number) {
    if (disabled) return;
    setPlaced((prev) => {
      if (prev[slotIndex] === null) return prev;
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  }

  function handleSubmit() {
    if (!allFilled) return;
    const value = placed.map((i) => data.items[i as number]).join(data.joinWith);
    onSubmit(value);
  }

  const isNumericItem = (v: string) => /^[\d+\-*/=.,\s]+$/.test(v);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 justify-center">
        {placed.map((itemIndex, slotIndex) => (
          <button
            key={slotIndex}
            onClick={() => removeFromSlot(slotIndex)}
            disabled={disabled || itemIndex === null}
            className="h-14 min-w-14 px-3 rounded-2xl border-2 border-dashed border-[var(--color-teal)]/50 bg-[var(--color-teal-soft)]/40 flex items-center justify-center font-medium text-xl text-[var(--color-ink)] disabled:cursor-default"
          >
            {itemIndex !== null ? data.items[itemIndex] : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 justify-center">
        {data.items.map((item, i) => (
          <button
            key={i}
            onClick={() => placeInNextSlot(i)}
            disabled={disabled || usedIndices.has(i)}
            dir={isNumericItem(item) ? "ltr" : undefined}
            className="h-14 min-w-14 px-4 rounded-full bg-[var(--color-surface)] border-2 border-[var(--color-teal)]/40 font-medium text-xl text-[var(--color-ink)] hover:bg-[var(--color-teal-soft)] disabled:opacity-30 disabled:cursor-default"
          >
            {item}
          </button>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={disabled || !allFilled}
        className="self-center min-h-16 px-8 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium disabled:opacity-30"
      >
        {disabled ? "בודק/ת..." : "בדוק/י תשובה"}
      </button>
    </div>
  );
}
