"use client";

import { useEffect, useState } from "react";

/**
 * Replaces lib/avatars.ts's 8-option emoji+gradient picker with the 2
 * finished companion characters (public/characters/{boy,girl}/). Per
 * UI Revamp Brief Section 3.1 / P-projects/ai-tutor-il/output decisions.
 *
 * Marked "use client" because useTalkingPose below is a hook — every
 * current call site is already a client component, so this doesn't
 * restrict anything, it just makes the hook usage valid.
 */
export type CharacterId = "boy" | "girl";

export type CharacterPose =
  | "idle"
  | "hello"
  | "explaining"
  | "thinking"
  | "talking-open"
  | "talking-closed"
  | "correct"
  | "encouraging"
  | "celebration"
  | "goodbye";

export const POSES: CharacterPose[] = [
  "idle",
  "hello",
  "explaining",
  "thinking",
  "talking-open",
  "talking-closed",
  "correct",
  "encouraging",
  "celebration",
  "goodbye",
];

/** Accents match the art: the girl is the teal one (purple scarf), the
 *  boy the raspberry one (teal bow tie) — per the 2026-09-10 roster
 *  decision (Sweet One = girl, Quirky One = boy). These were swapped. */
export const CHARACTERS: Record<CharacterId, { id: CharacterId; label: string; accent: string }> = {
  boy: { id: "boy", label: "החבר", accent: "var(--color-pink)" },
  girl: { id: "girl", label: "החברה", accent: "var(--color-teal)" },
};

export function poseSrc(id: CharacterId, pose: CharacterPose): string {
  return `/characters/${id}/${pose}.webp`;
}

/**
 * Migration from the old 8-option `avatarId` (hero-comet, anime-mika, ...)
 * to the new 2-character roster. Returns null for anything unrecognized —
 * including the empty/never-set case — so the caller knows to route the
 * kid through a one-time re-pick (UI Revamp Brief Section 4.3 step 2 only)
 * rather than silently guessing forever.
 */
const OLD_ID_TO_CHARACTER: Record<string, CharacterId> = {
  "hero-comet": "boy",
  "anime-kuro": "boy",
  "fantasy-pip": "boy",
  "animal-tuki": "boy",
  "hero-spark": "girl",
  "anime-mika": "girl",
  "fantasy-luna": "girl",
  "animal-mango": "girl",
};

export function normalizeCharacterId(avatarId: string | null | undefined): CharacterId | null {
  if (!avatarId) return null;
  if (avatarId === "boy" || avatarId === "girl") return avatarId;
  return OLD_ID_TO_CHARACTER[avatarId] ?? null;
}

/**
 * Talk-mouth alternation (UI Revamp Brief Section 3.3): while `speaking`,
 * cycles the pose between talking-open/talking-closed every 140ms; when
 * speech ends, returns to whatever semantic pose the caller is otherwise
 * showing (explaining, correct, encouraging, ...). Lives here rather than
 * inside Character.tsx so every screen that wires TTS to a character gets
 * the same alternation without re-implementing the interval.
 */
export function useTalkingPose(speaking: boolean, basePose: CharacterPose): CharacterPose {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!speaking) return;
    const id = setInterval(() => setOpen((v) => !v), 140);
    return () => clearInterval(id);
  }, [speaking]);

  if (!speaking) return basePose;
  return open ? "talking-open" : "talking-closed";
}
