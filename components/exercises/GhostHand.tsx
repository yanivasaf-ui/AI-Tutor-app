"use client";

import { motion } from "framer-motion";

/**
 * Kids-App UX Benchmark, build-first item 6: the translucent "ghost hand"
 * shown once per kid per widget kind, demonstrating where to tap.
 *
 * Render this as the ONLY extra child of the exact target element it
 * should appear to tap (that element must itself be `position: relative`
 * — every call site below already is, or gets that added). It is purely
 * decorative:
 * - `pointer-events-none`, so it can never intercept, delay, or "lose" a
 *   real tap — a kid tapping through it hits the real element underneath,
 *   exactly as if this weren't rendered at all.
 * - It never calls onSubmit, onManipulate, or any widget callback, never
 *   reads or writes exercise/placement state, and never touches
 *   lib/exercises/firstUseDemo.ts itself — the widget that mounts it owns
 *   the ~2s timer and the seen/mark-seen calls, this is view-only.
 * - The bounce is framer-motion's own `animate` (y/scale), which the
 *   app-wide <MotionConfig reducedMotion="user"> (components/MotionRoot.tsx)
 *   already suppresses to a near-static value under prefers-reduced-motion
 *   — the same mechanism build-first item 3 relies on. Under reduced
 *   motion the hand still mounts and unmounts (a clear, if static,
 *   "tap here" cue for the ~2s it's shown) rather than animating a bounce,
 *   which is the "non-animated visual equivalent" the benchmark asks for.
 */
export default function GhostHand() {
  return (
    <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden="true">
      <motion.span
        className="text-3xl opacity-70 drop-shadow-md"
        animate={{ y: [0, 6, 0], scale: [1, 0.9, 1] }}
        transition={{ duration: 0.7, repeat: 2, repeatType: "loop" }}
      >
        👆
      </motion.span>
    </span>
  );
}
