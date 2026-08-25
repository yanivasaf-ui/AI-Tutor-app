"use client";

import { useState } from "react";
import type { TileOrderData } from "@/lib/exercises/types";

interface Props {
  data: TileOrderData;
  disabled: boolean;
  onSubmit: (value: string) => void;
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
export default function TileOrderWidget({ data, disabled, onSubmit }: Props) {
  const [placed, setPlaced] = useState<(number | null)[]>(Array(data.slotCount).fill(null));

  const usedIndices = new Set(placed.filter((i): i is number => i !== null));
  const allFilled = placed.every((p) => p !== null);

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 justify-center">
        {placed.map((itemIndex, slotIndex) => (
          <button
            key={slotIndex}
            onClick={() => removeFromSlot(slotIndex)}
            disabled={disabled || itemIndex === null}
            className="min-w-[2.5rem] h-10 px-2 rounded border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center font-medium text-slate-800 disabled:cursor-default"
          >
            {itemIndex !== null ? data.items[itemIndex] : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        {data.items.map((item, i) => (
          <button
            key={i}
            onClick={() => placeInNextSlot(i)}
            disabled={disabled || usedIndices.has(i)}
            className="min-w-[2.5rem] h-10 px-3 rounded-lg bg-blue-50 border border-blue-200 font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-30 disabled:cursor-default"
          >
            {item}
          </button>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={disabled || !allFilled}
        className="self-center bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-30"
      >
        {disabled ? "בודק/ת..." : "בדוק/י תשובה"}
      </button>
    </div>
  );
}
