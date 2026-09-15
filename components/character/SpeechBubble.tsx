"use client";

import { motion } from "framer-motion";
import SpeakButton from "@/components/SpeakButton";
import type { CharacterId } from "@/lib/characters";

type Tone = "default" | "success" | "warm";

const TONE_BG: Record<Tone, string> = {
  default: "bg-[var(--color-surface)]",
  success: "bg-[var(--color-success-soft)]",
  warm: "bg-[var(--color-warm-soft)]",
};

interface Props {
  /** What's shown and (via the built-in SpeakButton) what's read aloud. */
  text: string;
  /** When set, the 🔊 replay reads THIS instead of `text` — for a bubble
   *  that stays short on screen while saying more out loud (e.g. free
   *  practice's topic list: the prompt is one line, the read-aloud names
   *  every option). Mirrors lib/guide/lines.ts's Line.spokenText, which
   *  drives the automatic (non-🔊) speech for the same line — keep the
   *  two in sync at the call site so tapping 🔊 repeats what was already
   *  said, not a shorter version of it. */
  spokenText?: string;
  /** Small caption line above everything else — independent of what the
   *  character is currently saying. Only consumer today: the map's stage
   *  bubble names the current stop's topic (QA: "the map never shows the
   *  topic name" — it lived only in the node's aria-label/title before).
   *  Not read aloud by SpeakButton; the spoken line already names the
   *  topic in its own sentence. */
  eyebrow?: string;
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
  /** "passage" is a tail-less, lighter card. "hero" (kid-scene reskin,
   *  2026-09-15) is the "one strong headline" style — no bubble chrome
   *  (transparent, no shadow, no tail), big display-weight text — while
   *  keeping the exact same SpeakButton/voice-sync machinery every other
   *  variant has. Text color follows `tone`'s ink, or pass one via
   *  `className` for a saturated backdrop. */
  variant?: "default" | "passage" | "hero";
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
  /** ...and the 🔊 replay is said in that character's own voice. */
  character?: CharacterId | null;
  className?: string;
}

/**
 * One bubble = one thing the character "says" (UI Revamp Brief Section
 * 4.1/6). Every bubble is TTS-readable via SpeakButton — kept as a real
 * button, not auto-only, so a kid can replay it.
 */
export default function SpeechBubble({
  text,
  spokenText: spokenTextOverride,
  eyebrow,
  lead,
  detail,
  variant = "default",
  tone = "default",
  tail = "bottom",
  tailAlign = "end",
  tailX,
  size = "lg",
  owner,
  character,
  className,
}: Props) {
  const isPassage = variant === "passage";
  const isHero = variant === "hero";
  const bg = isHero ? "bg-transparent" : isPassage ? "bg-[var(--color-teal-soft)]/60" : TONE_BG[tone];
  const spokenText = [lead ? `${lead},` : null, detail, spokenTextOverride ?? text].filter(Boolean).join(" ");
  const showTail = !isPassage && !isHero && tail !== "none";
  const tailY = tail === "top" ? "-top-2" : "-bottom-2";
  const tailXClass =
    tailX !== undefined ? "" : tailAlign === "center" ? "inset-x-0 mx-auto" : tailAlign === "start" ? "start-8" : "end-8";
  const textClass = isHero
    ? "display text-3xl text-center"
    : isPassage
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
      className={`relative rounded-[var(--radius-bubble)] flex items-start gap-3 ${bg} ${
        isHero ? "justify-center px-2 py-1" : isPassage ? "px-5 py-4" : "px-5 py-4 shadow-sm"
      } ${className ?? ""}`}
    >
      <div className={isHero ? "min-w-0" : "flex-1 min-w-0"}>
        {eyebrow && (
          <p className="text-xs font-bold text-[var(--color-teal-ink)]/70 mb-1 line-clamp-2">{eyebrow}</p>
        )}
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
      <SpeakButton text={spokenText} owner={owner} character={character} />
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
