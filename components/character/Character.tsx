"use client";

/* eslint-disable @next/next/no-img-element -- poses are pre-sized 640x800
   webp and are preloaded by exact URL below; next/image would route them
   through the optimizer under a different URL and defeat the preload,
   which is what makes pose swaps instant. */

import { useEffect, useState } from "react";
import { useAnimate, useReducedMotion } from "framer-motion";
import { CHARACTERS, POSES, poseSrc, type CharacterId, type CharacterPose } from "@/lib/characters";

interface Props {
  character: CharacterId;
  pose: CharacterPose;
  /** Rendered height in px. Width follows the art's 4:5 frame. */
  size?: number;
  className?: string;
}

/** Warm the browser cache with every pose the first time a character
 *  appears, so no pose change ever waits on the network. ~37KB each. */
const preloaded = new Set<CharacterId>();
function preloadPoses(id: CharacterId) {
  if (preloaded.has(id) || typeof window === "undefined") return;
  preloaded.add(id);
  for (const p of POSES) {
    const img = new window.Image();
    img.src = poseSrc(id, p);
  }
}

const TALKING = new Set<CharacterPose>(["talking-open", "talking-closed"]);

/** Poses that are *reactions* arrive with a beat of energy — a small
 *  spring, the way a person's reaction has a beat before it settles.
 *  Held poses (idle, explaining, thinking) and the talk-mouth frames
 *  don't: a spring on every 140ms mouth swap would read as jitter. */
const POP: Partial<Record<CharacterPose, { scale: number[]; y?: number[]; duration: number }>> = {
  hello: { scale: [0.94, 1.04, 1], duration: 0.35 },
  correct: { scale: [0.92, 1.06, 1], duration: 0.35 },
  encouraging: { scale: [0.96, 1.02, 1], duration: 0.3 },
  celebration: { scale: [0.9, 1.08, 1], y: [0, -26, 0], duration: 0.55 },
  goodbye: { scale: [0.96, 1.03, 1], duration: 0.35 },
};

/**
 * The character, alive (character-led redesign, Task 5 item 3).
 *
 * Three layers of life, all on the existing 10 poses:
 * 1. Pose crossfade, 150ms. Two stacked images: the new pose fades in
 *    *over* the old one, which stays fully opaque until it's covered —
 *    so there's never a half-transparent dip mid-swap. Talk-mouth swaps
 *    are instant: at 140ms per frame a 150ms fade would keep the mouth
 *    permanently mid-blend.
 * 2. Ambient motion, always on. One continuous bob-and-breathe on every
 *    pose, never removed — removing a CSS transform animation snaps the
 *    element back to rest, which read as the character twitching every
 *    time it changed pose.
 * 3. Reaction springs on event poses (see POP).
 *
 * prefers-reduced-motion: ambient motion and springs are off (globals.css
 * + useReducedMotion); the crossfade stays, as a fade isn't motion.
 */
export default function Character({ character, pose, size = 200, className }: Props) {
  const label = CHARACTERS[character].label;
  const reduced = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();

  // Adjust-state-on-prop-change pattern (not an effect): the new pose is
  // on screen in the same render the prop changes.
  const [shown, setShown] = useState<CharacterPose>(pose);
  const [under, setUnder] = useState<CharacterPose | null>(null);
  const [instant, setInstant] = useState(true);
  if (pose !== shown) {
    setUnder(shown);
    setInstant(TALKING.has(pose) || TALKING.has(shown));
    setShown(pose);
  }

  useEffect(() => {
    preloadPoses(character);
  }, [character]);

  useEffect(() => {
    if (under === null) return;
    const t = window.setTimeout(() => setUnder(null), 170);
    return () => window.clearTimeout(t);
  }, [under, shown]);

  useEffect(() => {
    const pop = POP[pose];
    if (!pop || reduced || !scope.current) return;
    animate(
      scope.current,
      pop.y ? { scale: pop.scale, y: pop.y } : { scale: pop.scale },
      { duration: pop.duration, ease: "easeOut" }
    );
  }, [pose, reduced, animate, scope]);

  // Keyed by pose name so the outgoing image keeps its DOM element as it
  // moves to the under-layer — a remount there could blank for a frame.
  const layers = under && under !== shown ? [under, shown] : [shown];

  return (
    <div
      className={`relative shrink-0 animate-alive ${className ?? ""}`}
      style={{ width: Math.round(size * 0.8), height: size, transformOrigin: "50% 100%" }}
    >
      <div ref={scope} className="absolute inset-0" style={{ transformOrigin: "50% 100%" }}>
        {layers.map((p) => {
          const isTop = p === shown;
          return (
            <img
              key={p}
              src={poseSrc(character, p)}
              alt={isTop ? label : ""}
              aria-hidden={isTop ? undefined : true}
              draggable={false}
              className={`absolute inset-0 w-full h-full object-contain select-none ${
                isTop && !instant ? "animate-pose-in" : ""
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
