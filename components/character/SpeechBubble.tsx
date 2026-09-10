"use client";

import { motion } from "framer-motion";
import SpeakButton from "@/components/SpeakButton";

type Tone = "default" | "success" | "warm";

const TONE_BG: Record<Tone, string> = {
  default: "bg-[var(--color-surface)]",
  success: "bg-[var(--color-success-soft)]",
  warm: "bg-[var(--color-warm-soft)]",
};

interface Props {
  /** What's shown and (via the built-in SpeakButton) what's read aloud. */
  text: string;
  /** The kid's name (character-led redesign, Task 5 item 5). Rendered
   *  first, bold, in the brand ink — a pre-reader often recognises their
   *  own written name before any other word, so this is the one part of
   *  the bubble a 6-year-old can reliably read. Spoken first too. */
  lead?: string;
  /** Reading material the character reads out *before* `text` in the
   *  same breath — an exercise passage before its question. Rendered
   *  between the name and the text, smaller, so the bubble reads in the
   *  same order it's spoken: name, passage, question. */
  detail?: string;
  /** "passage" is a tail-less, lighter card. */
  variant?: "default" | "passage";
  /** Feedback colouring: success-green or warm-amber. Never red. */
  tone?: Tone;
  /** Which edge points at the speaking character. */
  tail?: "top" | "bottom" | "none";
  tailAlign?: "start" | "center" | "end";
  /** Exact tail position, px from the bubble's physical left edge —
   *  overrides tailAlign. For layouts that know where the character
   *  stands (the map's guide beside its stop). */
  tailX?: number;
  size?: "lg" | "md";
  /** Which character is saying this — the 🔊 replay moves that
   *  character's mouth (lib/speech/useSpeech.ts owner model). */
  owner?: string;
  className?: string;
}

/**
 * One bubble = one thing the character "says" (UI Revamp Brief Section
 * 4.1/6). Every bubble is TTS-readable via SpeakButton — kept as a real
 * button, not auto-only, so a kid can replay it.
 */
export default function SpeechBubble({
  text,
  lead,
  detail,
  variant = "default",
  tone = "default",
  tail = "bottom",
  tailAlign = "end",
  tailX,
  size = "lg",
  owner,
  className,
}: Props) {
  const isPassage = variant === "passage";
  const bg = isPassage ? "bg-[var(--color-teal-soft)]/60" : TONE_BG[tone];
  const spokenText = [lead ? `${lead},` : null, detail, text].filter(Boolean).join(" ");
  const showTail = !isPassage && tail !== "none";
  const tailY = tail === "top" ? "-top-2" : "-bottom-2";
  const tailXClass =
    tailX !== undefined ? "" : tailAlign === "center" ? "inset-x-0 mx-auto" : tailAlign === "start" ? "start-8" : "end-8";
  const textClass = isPassage
    ? "text-lg text-[var(--color-ink-soft)]"
    : size === "md"
      ? "text-lg font-medium text-[var(--color-ink)]"
      : "text-2xl font-medium text-[var(--color-ink)]";
  const leadClass = "font-bold text-[var(--color-teal-ink)]";

  return (
    <motion.div
      initial={{ opacity: 0, y: tail === "top" ? -8 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={`relative rounded-[var(--radius-bubble)] px-5 py-4 flex items-start gap-3 ${bg} ${
        isPassage ? "" : "shadow-sm"
      } ${className ?? ""}`}
    >
      <div className="flex-1 min-w-0">
        {detail ? (
          <>
            {lead && <p className={`${leadClass} ${size === "md" ? "text-lg" : "text-2xl"}`}>{lead},</p>}
            <p className="text-lg leading-relaxed text-[var(--color-ink-soft)] mt-1 mb-3">{detail}</p>
            <p className={`leading-relaxed ${textClass}`}>{text}</p>
          </>
        ) : (
          <p className={`leading-relaxed ${textClass}`}>
            {lead && <span className={leadClass}>{lead}, </span>}
            {text}
          </p>
        )}
      </div>
      <SpeakButton text={spokenText} owner={owner} />
      {showTail && (
        <span
          aria-hidden
          className={`absolute ${tailY} ${tailXClass} w-4 h-4 rotate-45 ${bg}`}
          style={tailX !== undefined ? { left: tailX - 8 } : undefined}
        />
      )}
    </motion.div>
  );
}
