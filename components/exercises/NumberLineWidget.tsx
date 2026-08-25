"use client";

import type { NumberLineData } from "@/lib/exercises/types";

interface Props {
  data: NumberLineData;
  disabled: boolean;
  onSubmit: (value: string) => void;
}

/**
 * Tier 2 shared tap-to-place primitive, number-line variant — see
 * TileOrderWidget for the ordering variant. Tapping a tick submits
 * immediately, same one-tap pattern as multiple_choice buttons. Tick count
 * is kept small by the generation prompt (not enforced here), the same
 * trust-the-prompt pattern already used for multiple_choice's "4 options."
 */
export default function NumberLineWidget({ data, disabled, onSubmit }: Props) {
  const ticks: number[] = [];
  for (let v = data.min; v <= data.max; v += data.step) ticks.push(v);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 py-2">
      {ticks.map((v) => (
        <button
          key={v}
          onClick={() => onSubmit(String(v))}
          disabled={disabled}
          className="min-w-[2.75rem] h-11 px-2 rounded-full border-2 border-slate-300 bg-white font-medium text-slate-700 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
        >
          {v}
        </button>
      ))}
    </div>
  );
}
