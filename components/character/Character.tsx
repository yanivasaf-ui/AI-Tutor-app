"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { CHARACTERS, poseSrc, type CharacterId, type CharacterPose } from "@/lib/characters";

interface Props {
  character: CharacterId;
  pose: CharacterPose;
  size?: number;
  className?: string;
}

/**
 * Renders the character at a given pose with a crossfade between poses
 * (UI Revamp Brief Section 3.2). The `pose` prop is fully controlled by
 * the caller — this component doesn't know about TTS, evaluation state,
 * or anything else; see lib/characters.ts's useTalkingPose for the mouth
 * alternation and the pose-trigger table (brief Section 3.4) for what
 * each screen should be passing in.
 *
 * Idle bob applies only when pose === "idle" — a character mid-celebration
 * or mid-explanation shouldn't also be gently bobbing, that reads as
 * jittery rather than alive.
 */
export default function Character({ character, pose, size = 200, className }: Props) {
  const label = CHARACTERS[character].label;

  return (
    <div
      className={`relative aspect-square ${pose === "idle" ? "animate-bob" : ""} ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <AnimatePresence>
        <motion.div
          key={pose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0"
        >
          <Image
            src={poseSrc(character, pose)}
            alt={label}
            fill
            sizes={`${size}px`}
            className="object-contain"
            priority
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
