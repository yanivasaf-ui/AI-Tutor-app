"use client";

import { useEffect, useRef } from "react";
import { fireConfetti } from "@/components/celebration/Confetti";
import type { CharacterPose } from "@/lib/characters";

type Tier = 1 | 2 | 3;

const SOUND_FILES = {
  correct: "/sounds/correct.mp3",
  celebrate: "/sounds/celebrate.mp3",
} as const;

/**
 * Coordinates pose → sound → confetti for a celebration moment (UI Revamp
 * Brief Section 5). `setPose` is optional — callers that already drive
 * pose from their own state (e.g. ExerciseScreen setting `correct` from
 * the evaluation result) can pass it so celebrate() keeps the character in
 * sync; a caller with no pose concept (a bare confetti burst) can omit it.
 *
 * Sounds preload on the page's first pointerdown (a real user gesture) and
 * are never autoplayed outside one — iOS Safari's gesture rule (brief
 * Section 0), same constraint SpeakButton/useSpeech follow.
 */
export function useCelebration(setPose?: (pose: CharacterPose) => void) {
  const audioRefs = useRef<Partial<Record<keyof typeof SOUND_FILES, HTMLAudioElement>>>({});
  const preloadedRef = useRef(false);

  useEffect(() => {
    function preload() {
      if (preloadedRef.current) return;
      preloadedRef.current = true;
      for (const key of Object.keys(SOUND_FILES) as (keyof typeof SOUND_FILES)[]) {
        const audio = new Audio(SOUND_FILES[key]);
        audio.load();
        audioRefs.current[key] = audio;
      }
    }
    window.addEventListener("pointerdown", preload, { once: true });
    return () => window.removeEventListener("pointerdown", preload);
  }, []);

  function celebrate(tier: Tier, originEl?: HTMLElement | null) {
    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (tier === 1) {
      setPose?.("correct");
      audioRefs.current.correct?.play().catch(() => {});
      if (!reducedMotion) fireConfetti(originEl, 40, false);
    } else {
      setPose?.("celebration");
      audioRefs.current.celebrate?.play().catch(() => {});
      if (!reducedMotion) fireConfetti(originEl, 150, true);
    }
  }

  return { celebrate };
}
