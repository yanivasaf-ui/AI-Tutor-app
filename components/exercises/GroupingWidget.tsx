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
 * A placement counter and an alternate numeric path were added after
 * 2026-09-12 iPhone QA found this an unexplained dead end: nothing on
 * screen said what to do, and a kid facing up to 20 stars with no progress
 * feedback had no way to tell whether they were nearly done or barely
 * started. ExerciseScreen renders the actual how-to caption (see
 * lines.groupingInstructions) above this component — this widget owns
 * only the counter and the numeric shortcut, which need its live
 * `assignments` state.
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
  const [manualCount, setManualCount] = useState("");
  const { assignments, selectedItem } = state;

  const placedCount = assignments.filter((a) => a !== null).length;
  const allAssigned = placedCount === assignments.length;

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

  /** The fallback path for a kid (or a parent helping) who'd rather just
   *  answer "how many per group" than tap every star into a bucket.
   *  Submits through the exact same onSubmit the tap-to-place path uses —
   *  evaluateExerciseAnswer's grouping instruction accepts any answer
   *  whose numbers all equal the correct per-group count, and a single
   *  typed number trivially satisfies that. */
  function handleManualSubmit() {
    if (disabled || !manualCount.trim()) return;
    onSubmit(manualCount.trim());
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-sm font-medium text-[var(--color-ink-soft)]">
        {placedCount} מתוך {data.items.length}
      </p>

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

      <div className="flex flex-col items-center gap-2 mt-1">
        <p className="text-sm text-[var(--color-ink-soft)]">או כתוב כמה בכל קבוצה</p>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={manualCount}
            onChange={(e) => setManualCount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
            disabled={disabled}
            dir="ltr"
            aria-label="כמה בכל קבוצה"
            className="w-20 min-h-12 rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/30 bg-[var(--color-surface)] px-3 text-xl text-center"
          />
          <button
            onClick={handleManualSubmit}
            disabled={disabled || !manualCount.trim()}
            className="min-h-12 px-6 rounded-[var(--radius-button)] bg-[var(--color-surface)] border-2 border-[var(--color-teal)]/30 text-[var(--color-ink)] font-medium disabled:opacity-30"
          >
            שלח
          </button>
        </div>
      </div>
    </div>
  );
}
