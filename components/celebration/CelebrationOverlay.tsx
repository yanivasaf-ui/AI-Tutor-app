"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import { useGuide } from "@/lib/guide/useGuide";
import { useCelebration } from "@/lib/celebration/useCelebration";
import { spoken, type Line } from "@/lib/guide/lines";
import type { CharacterId, CharacterPose } from "@/lib/characters";

export interface CelebrationAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface Props {
  character: CharacterId;
  line: Line;
  /** celebration by default; the session overlay's "done for today"
   *  branch swaps to goodbye (and a new line) without remounting. */
  pose?: CharacterPose;
  actions: CelebrationAction[];
  /** Kid-scene reskin (2026-09-15): "milestone" is the topic-completion
   *  moment specifically (reskin brief item 5) — a saturated gold scene,
   *  the character enlarged further still, and a handful of hand-placed
   *  decorative shapes instead of a denser confetti spray, matching the
   *  brief's own "6-10 confetti shapes" description. The session-close
   *  overlay (goodbye / "done for today") isn't part of this brief and
   *  keeps its exact prior look under the default "generic" variant. */
  variant?: "generic" | "milestone";
}

/** Fixed, hand-placed (not physics-simulated) — the milestone's own
 *  decorative flourish, distinct from the tier-2 canvas-confetti burst
 *  `celebrate(2)` still fires alongside it. */
const MILESTONE_SHAPES: { top: number; left?: number; right?: number; shape: "square" | "circle" | "triangle"; color: string }[] = [
  { top: 60, left: 38, shape: "square", color: "var(--color-teal)" },
  { top: 110, right: 44, shape: "circle", color: "#fff" },
  { top: 40, right: 120, shape: "triangle", color: "var(--color-math-deep)" },
  { top: 180, left: 20, shape: "circle", color: "var(--color-math-deep)" },
  { top: 150, left: 150, shape: "square", color: "var(--color-teal-ink)" },
  { top: 90, left: 250, shape: "triangle", color: "#fff" },
  { top: 220, right: 70, shape: "circle", color: "var(--color-teal)" },
  { top: 200, left: 100, shape: "square", color: "var(--color-hebrew)" },
  { top: 50, left: 170, shape: "circle", color: "var(--color-hebrew)" },
  { top: 250, right: 150, shape: "square", color: "var(--color-math-deep)" },
];

const OWNER = "celebration";

/**
 * Tier-2 celebration, full screen (character-led redesign, Task 5 item 6)
 * — for the moments that close something: a finished topic, a finished
 * session. Replaces the corner confetti + inline banner, which put the
 * biggest moments of a kid's session at the same visual weight as a
 * single correct answer.
 *
 * The character takes the whole stage at 300px, jumps in on a spring,
 * sunburst rays turn slowly behind it, confetti bursts from three points,
 * the celebrate sound plays, and it says the moment out loud, addressing
 * the kid by name. prefers-reduced-motion keeps the stage, the pose, the
 * sound and the spoken line; drops the rays, spring and confetti.
 */
export default function CelebrationOverlay({ character, line, pose = "celebration", actions, variant = "generic" }: Props) {
  const guide = useGuide({ owner: OWNER, character, pose, line });
  const { celebrate } = useCelebration();
  const isMilestone = variant === "milestone";

  useEffect(() => {
    celebrate(2);
    // mount only: a pose/line change (celebration -> goodbye) isn't a
    // second celebration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={spoken(line)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 overflow-hidden flex flex-col items-center justify-center gap-5 p-6"
      style={{
        background: isMilestone
          ? "radial-gradient(120% 90% at 50% 30%, #FFE9B0 0%, var(--color-gold) 45%, #FF9F4A 100%)"
          : "var(--color-canvas)",
      }}
    >
      <div
        aria-hidden
        className="absolute left-1/2 top-[38%] w-[160vmax] h-[160vmax] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      >
        <div
          className="w-full h-full rounded-full animate-rays opacity-70"
          style={{
            background: isMilestone
              ? "repeating-conic-gradient(from 0deg, rgba(255,255,255,.35) 0deg 12deg, transparent 12deg 24deg)"
              : "repeating-conic-gradient(from 0deg, var(--color-teal-soft) 0deg 12deg, transparent 12deg 24deg)",
            maskImage: "radial-gradient(circle, black 0%, black 22%, transparent 50%)",
            WebkitMaskImage: "radial-gradient(circle, black 0%, black 22%, transparent 50%)",
          }}
        />
      </div>

      {/* the milestone's own hand-placed flourish — "6-10 confetti
          shapes" per the reskin brief, distinct from celebrate(2)'s
          physics-based burst which still fires alongside it */}
      {isMilestone && (
        <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
          {MILESTONE_SHAPES.map((s, i) => (
            <span
              key={i}
              className="absolute"
              style={{
                top: s.top,
                left: s.left,
                right: s.right,
                width: 12,
                height: 12,
                background: s.shape === "triangle" ? "transparent" : s.color,
                borderRadius: s.shape === "circle" ? 999 : s.shape === "square" ? 4 : 0,
                transform: s.shape === "square" ? `rotate(${(i * 17) % 40 - 20}deg)` : undefined,
                borderLeft: s.shape === "triangle" ? "7px solid transparent" : undefined,
                borderRight: s.shape === "triangle" ? "7px solid transparent" : undefined,
                borderBottom: s.shape === "triangle" ? `12px solid ${s.color}` : undefined,
              }}
            />
          ))}
        </div>
      )}

      <motion.div
        className="relative"
        initial={{ scale: 0.5, y: 60 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 13 }}
      >
        <Character character={character} pose={guide.pose} size={isMilestone ? 340 : 300} />
      </motion.div>

      <SpeechBubble
        text={line.text}
        lead={isMilestone ? undefined : line.name}
        tail={isMilestone ? "none" : "top"}
        tailAlign="center"
        size={isMilestone ? "md" : "lg"}
        owner={OWNER}
        character={character}
        className={`relative w-full ${
          isMilestone ? "max-w-sm rounded-[var(--radius-stage)] shadow-lg py-5 px-5 text-center [&_p]:text-center" : "max-w-md"
        }`}
      />

      <div className="relative flex flex-col gap-3 w-full max-w-xs mt-1">
        {actions.map((a, i) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            autoFocus={i === 0}
            className={
              a.primary
                ? "min-h-16 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium shadow-md"
                : "min-h-14 rounded-[var(--radius-button)] bg-[var(--color-surface)] text-[var(--color-ink)] text-lg font-medium shadow-sm"
            }
          >
            {a.label}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
