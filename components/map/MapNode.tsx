"use client";

import { motion } from "framer-motion";

export type NodeState = "done" | "current" | "locked";

interface Props {
  topic: string;
  state: NodeState;
  onTap: () => void;
}

/**
 * One topic node on the progress map (UI Revamp Brief Section 4.2).
 * done = filled teal + check, current = pulsing ring, locked = gray + lock.
 * `animate-ping` respects prefers-reduced-motion via the global CSS rule
 * (app/globals.css) rather than a per-component check.
 */
export default function MapNode({ topic, state, onTap }: Props) {
  const disabled = state === "locked";

  return (
    <button
      type="button"
      onClick={onTap}
      disabled={disabled}
      title={topic}
      aria-label={topic}
      className="relative flex flex-col items-center gap-1 disabled:cursor-not-allowed"
    >
      {state === "current" && (
        <span className="absolute inset-0 rounded-full animate-ping bg-[var(--color-teal)]/40" />
      )}
      <motion.span
        whileTap={disabled ? undefined : { scale: 0.9 }}
        className={`relative w-18 h-18 rounded-full flex items-center justify-center text-2xl shadow-sm ${
          state === "done"
            ? "bg-[var(--color-teal)] text-white"
            : state === "current"
              ? "bg-[var(--color-surface)] border-4 border-[var(--color-teal)] text-[var(--color-teal)]"
              : "bg-slate-200 text-slate-400"
        }`}
        style={{ width: 72, height: 72 }}
      >
        {state === "done" ? "✓" : state === "locked" ? "🔒" : "●"}
      </motion.span>
    </button>
  );
}
