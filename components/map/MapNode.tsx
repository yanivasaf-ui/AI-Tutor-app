"use client";

import { useEffect, useState } from "react";
import { motion, useAnimate, useReducedMotion } from "framer-motion";

export type NodeState = "done" | "current" | "locked";

const STATE_LABEL: Record<NodeState, string> = {
  done: "הושלם",
  current: "התחנה הבאה",
  locked: "עוד לא נפתח",
};

interface Props {
  topic: string;
  state: NodeState;
  size: number;
  onTap: () => void;
  /** Bumped by the map when the kid taps a locked stop: the current stop
   *  bounces — "this one, over here". Direction is carried by the path
   *  and the stops themselves, never by a character gesture (Task 5
   *  decision B: there is no pointing pose). */
  attention?: number;
}

/**
 * One topic stop on the progress map (UI Revamp Brief Section 4.2).
 * done = filled teal + check, current = ringed and pinging, locked = gray
 * + lock.
 *
 * Locked stops are tappable now (aria-disabled, not disabled): a kid who
 * taps one gets an answer — the stop shakes its head, the current stop
 * bounces, and the character says where to go instead — rather than a
 * button that silently does nothing. Tap ≠ navigation for locked stops;
 * the parent decides via `onTap`.
 */
export default function MapNode({ topic, state, size, onTap, attention = 0 }: Props) {
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const reduced = useReducedMotion();
  const [shakes, setShakes] = useState(0);
  const locked = state === "locked";

  useEffect(() => {
    if (attention === 0 || state !== "current" || reduced || !scope.current) return;
    animate(scope.current, { scale: [1, 1.22, 0.95, 1.08, 1] }, { duration: 0.6, ease: "easeOut" });
  }, [attention, state, reduced, animate, scope]);

  return (
    <button
      type="button"
      onClick={() => {
        if (locked) setShakes((n) => n + 1);
        onTap();
      }}
      aria-label={`${topic} — ${STATE_LABEL[state]}`}
      aria-disabled={locked || undefined}
      title={topic}
      className={`relative block rounded-full ${locked ? "cursor-default" : ""}`}
      style={{ width: size, height: size }}
    >
      {state === "current" && (
        <span aria-hidden className="absolute inset-0 rounded-full animate-ping bg-[var(--color-teal)]/35" />
      )}
      <motion.span
        ref={scope}
        // re-keyed per shake so the CSS nudge animation replays each tap
        key={shakes}
        whileTap={locked ? undefined : { scale: 0.9 }}
        className={`relative w-full h-full rounded-full flex items-center justify-center text-2xl shadow-md ${
          shakes > 0 ? "animate-nudge" : ""
        } ${
          state === "done"
            ? "bg-[var(--color-teal)] text-white"
            : state === "current"
              ? "bg-[var(--color-surface)] border-4 border-[var(--color-teal)] text-[var(--color-teal-ink)]"
              : "bg-slate-200 text-slate-400"
        }`}
      >
        {state === "done" ? "✓" : state === "locked" ? "🔒" : "●"}
      </motion.span>
    </button>
  );
}
