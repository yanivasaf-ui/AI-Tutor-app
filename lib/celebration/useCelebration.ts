"use client";

import { fireConfetti } from "@/components/celebration/Confetti";
import type { CharacterPose } from "@/lib/characters";

type Tier = 1 | 2 | 3;

const SOUND_FILES = {
  correct: "/sounds/correct.mp3",
  celebrate: "/sounds/celebrate.mp3",
} as const;

type SoundKey = keyof typeof SOUND_FILES;

/**
 * Sounds are one page-level set, created on the page's first pointerdown
 * (a real user gesture) — iOS Safari's gesture rule (brief Section 0).
 *
 * Why module-level (character-led redesign): this used to live in a ref
 * per hook instance, with each instance listening for *its own* first
 * pointerdown after mount. A component that mounts after the kid has
 * already tapped — the full-screen celebration overlay, which appears
 * after an async evaluation — never saw a pointerdown, so its tier-2
 * moment played no sound at all.
 *
 * The muted play()/pause() inside the gesture is the standard iOS unlock:
 * an <audio> element that has played once inside a gesture may play again
 * later outside one (after the async evaluation returns). Unverified on a
 * real iPhone from here — see the task report.
 */
const sounds: Partial<Record<SoundKey, HTMLAudioElement>> = {};

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    () => {
      for (const key of Object.keys(SOUND_FILES) as SoundKey[]) {
        const audio = new Audio(SOUND_FILES[key]);
        audio.preload = "auto";
        audio.muted = true;
        audio
          .play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
          })
          .catch(() => {
            audio.muted = false;
          });
        sounds[key] = audio;
      }
    },
    { once: true, capture: true }
  );
}

function play(key: SoundKey) {
  const audio = sounds[key];
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

/**
 * Coordinates pose → sound → confetti for a celebration moment (UI Revamp
 * Brief Section 5). `setPose` is optional — callers that already drive
 * pose from their own state (e.g. ExerciseScreen setting `correct` from
 * the evaluation result) can pass it so celebrate() keeps the character in
 * sync; a caller with no pose concept (a bare confetti burst) can omit it.
 */
export function useCelebration(setPose?: (pose: CharacterPose) => void) {
  function celebrate(tier: Tier, originEl?: HTMLElement | null) {
    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (tier === 1) {
      setPose?.("correct");
      play("correct");
      if (!reducedMotion) fireConfetti(originEl, 40, false);
    } else {
      setPose?.("celebration");
      play("celebrate");
      if (!reducedMotion) fireConfetti(originEl, 150, true);
    }
  }

  return { celebrate };
}
