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
}

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
export default function CelebrationOverlay({ character, line, pose = "celebration", actions }: Props) {
  const guide = useGuide({ owner: OWNER, pose, line });
  const { celebrate } = useCelebration();

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
      className="fixed inset-0 z-50 overflow-hidden flex flex-col items-center justify-center gap-5 p-6 bg-[var(--color-canvas)]"
    >
      <div
        aria-hidden
        className="absolute left-1/2 top-[38%] w-[160vmax] h-[160vmax] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      >
        <div
          className="w-full h-full rounded-full animate-rays opacity-70"
          style={{
            background:
              "repeating-conic-gradient(from 0deg, var(--color-teal-soft) 0deg 12deg, transparent 12deg 24deg)",
            maskImage: "radial-gradient(circle, black 0%, black 22%, transparent 50%)",
            WebkitMaskImage: "radial-gradient(circle, black 0%, black 22%, transparent 50%)",
          }}
        />
      </div>

      <motion.div
        className="relative"
        initial={{ scale: 0.5, y: 60 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 13 }}
      >
        <Character character={character} pose={guide.pose} size={300} />
      </motion.div>

      <SpeechBubble
        text={line.text}
        lead={line.name}
        tail="top"
        tailAlign="center"
        owner={OWNER}
        className="relative w-full max-w-md"
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
