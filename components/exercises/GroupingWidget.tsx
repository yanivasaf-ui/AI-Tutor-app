"use client";

import { useState } from "react";
import type { GroupingData } from "@/lib/exercises/types";

interface Props {
  data: GroupingData;
  disabled: boolean;
  onSubmit: (value: string) => void;
}

/**
 * Math #2, visual counting/grouping — the one genuinely new interaction
 * shape in this pass (see lib/exercises/types.ts GroupingData). Unlike
 * TileOrderWidget's 1:1 ordering, a bucket here holds many items and order
 * within a bucket doesn't matter — a real many-to-few distribution, not a
 * variant of the ordering primitive, hence its own small component.
 *
 * Interaction: tap an unassigned item to pick it up, then tap a bucket to
 * drop it there (tap-to-place, same paradigm as TileOrderWidget). Tap an
 * item already in a bucket to send it back to the pool.
 *
 * State updates use the functional setState form throughout, and
 * `assignments` + `selectedItem` live in ONE combined state object updated
 * by a single functional call per action — not two separate useState
 * calls with one nested inside the other's updater. A sibling widget
 * (TileOrderWidget) shipped with a stale-closure bug from reading state
 * via the render closure instead of functional updates, found via real
 * tap-through QA; a first pass at this component then hit a *different*
 * bug from the opposite direction — nesting a second setState call inside
 * the first's updater function, which under React 19's automatic batching
 * silently dropped every placement when actions fired without a paint in
 * between. Both were only caught by actually tapping through the UI.
 */
export default function GroupingWidget({ data, disabled, onSubmit }: Props) {
  const [state, setState] = useState<{ assignments: (number | null)[]; selectedItem: number | null }>({
    assignments: Array(data.items.length).fill(null),
    selectedItem: null,
  });
  const { assignments, selectedItem } = state;

  const allAssigned = assignments.every((a) => a !== null);

  function pickUpItem(itemIndex: number) {
    if (disabled) return;
    setState((prev) => ({
      ...prev,
      selectedItem: prev.selectedItem === itemIndex ? null : itemIndex,
    }));
  }

  function dropInBucket(bucketIndex: number) {
    if (disabled) return;
    setState((prev) => {
      if (prev.selectedItem === null) return prev;
      const next = [...prev.assignments];
      next[prev.selectedItem] = bucketIndex;
      return { assignments: next, selectedItem: null };
    });
  }

  function removeFromBucket(itemIndex: number) {
    if (disabled) return;
    setState((prev) => {
      const next = [...prev.assignments];
      next[itemIndex] = null;
      return { ...prev, assignments: next };
    });
  }

  function handleSubmit() {
    if (!allAssigned) return;
    const sizes = Array.from({ length: data.groupCount }, (_, bucket) =>
      assignments.filter((a) => a === bucket).length
    );
    onSubmit(sizes.join(", "));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: data.groupCount }, (_, bucketIndex) => (
          <div
            key={bucketIndex}
            onClick={() => dropInBucket(bucketIndex)}
            className={`min-h-16 rounded-2xl border-2 border-dashed p-2 flex flex-wrap gap-1 items-center justify-center cursor-pointer ${
              selectedItem !== null ? "border-[var(--color-teal)] bg-[var(--color-teal-soft)]" : "border-[var(--color-teal)]/40 bg-[var(--color-surface)]"
            }`}
          >
            {data.items.map((item, i) =>
              assignments[i] === bucketIndex ? (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromBucket(i);
                  }}
                  disabled={disabled}
                  className="text-2xl leading-none"
                >
                  {item}
                </button>
              ) : null
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 justify-center">
        {data.items.map((item, i) =>
          assignments[i] === null ? (
            <button
              key={i}
              onClick={() => pickUpItem(i)}
              disabled={disabled}
              className={`text-2xl leading-none h-14 w-14 rounded-full border-2 flex items-center justify-center ${
                selectedItem === i ? "border-[var(--color-teal)] bg-[var(--color-teal-soft)] scale-110" : "border-[var(--color-teal)]/30 bg-[var(--color-surface)]"
              }`}
            >
              {item}
            </button>
          ) : null
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={disabled || !allAssigned}
        className="self-center min-h-16 px-8 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium disabled:opacity-30"
      >
        {disabled ? "בודק/ת..." : "בדוק/י תשובה"}
      </button>
    </div>
  );
}
