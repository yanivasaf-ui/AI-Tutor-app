"use client";

import { motion } from "framer-motion";
import SpeakButton from "@/components/SpeakButton";

interface Props {
  /** What's shown and (via the built-in SpeakButton) what's read aloud. */
  text: string;
  /** "passage" is the lighter, secondary bubble above the main question
   *  (UI Revamp Brief Section 4.1 — exercise.passage). */
  variant?: "default" | "passage";
  /** Which side the tail points to — the character's side. Logical, not
   *  physical: "end" is left in RTL, matching the character's anchor
   *  corner (brief Section 8). */
  tailSide?: "start" | "end";
  className?: string;
}

/**
 * One bubble = one thing the character "says" (UI Revamp Brief Section
 * 4.1/6). Every bubble is TTS-readable via the same SpeakButton used
 * elsewhere — kept as a real button, not auto-only, so a kid can replay it.
 */
export default function SpeechBubble({ text, variant = "default", tailSide = "end", className }: Props) {
  const isPassage = variant === "passage";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={`relative max-w-[85%] rounded-[var(--radius-bubble)] px-5 py-4 flex items-start gap-2 ${
        isPassage ? "bg-teal-50/70" : "bg-[var(--color-surface)] shadow-sm"
      } ${tailSide === "end" ? "self-end" : "self-start"} ${className ?? ""}`}
    >
      <p className={`flex-1 leading-relaxed ${isPassage ? "text-lg text-[var(--color-ink-soft)]" : "text-2xl font-medium text-[var(--color-ink)]"}`}>
        {text}
      </p>
      <SpeakButton text={text} />
      <span
        aria-hidden
        className={`absolute -bottom-2 w-4 h-4 rotate-45 ${isPassage ? "bg-teal-50/70" : "bg-[var(--color-surface)]"} ${
          tailSide === "end" ? "end-6" : "start-6"
        }`}
      />
    </motion.div>
  );
}
