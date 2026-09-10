"use client";

import { useCallback, useEffect, useRef } from "react";
import { hasSeenGesture, speak, stopSpeaking, useSpeech } from "@/lib/speech/useSpeech";
import { isAutoSpeakOn } from "@/lib/speech/autoSpeak";
import { useTalkingPose, type CharacterPose } from "@/lib/characters";
import { spoken, type Line } from "@/lib/guide/lines";

interface Options {
  /** Identity of this on-screen character (lib/speech/useSpeech.ts owner
   *  model) — only the character actually talking moves its mouth. */
  owner: string;
  /** The semantic pose from the pose-moment map. */
  pose: CharacterPose;
  /** What the character is saying right now. */
  line: Line | null;
  /** Re-say the line whenever this changes. Defaults to the line's text,
   *  i.e. "say it whenever it's a new line". Pass something explicit when
   *  the same words should be said again on a new event. */
  cue?: string | number | null;
}

/**
 * The character as a guide (character-led redesign, Task 5 items 3-4).
 * Built on the existing primitives — useSpeech for the voice,
 * useTalkingPose for the mouth — not a replacement for them. One call per
 * on-screen character:
 *
 * - says `line` aloud whenever `cue` changes;
 * - returns the pose to render: the caller's semantic pose, with the
 *   talk-mouth alternation layered on while *this* character speaks;
 * - returns `say()` for lines triggered by a tap — call it synchronously
 *   inside the handler, which is what iOS Safari needs for the first
 *   speech of a session;
 * - stops its own speech when it leaves the screen, so a line doesn't
 *   keep playing over the next screen.
 *
 * Automatic lines honour the iOS gesture rule (hasSeenGesture) and the
 * device mute (lib/speech/autoSpeak.ts). The 🔊 in a bubble bypasses both
 * — it's an explicit request.
 */
export function useGuide({ owner, pose, line, cue }: Options) {
  const { speaking } = useSpeech(owner);
  const shownPose = useTalkingPose(speaking, pose);

  const lineRef = useRef(line);
  lineRef.current = line;

  const say = useCallback(
    (l: Line | string) => {
      if (!isAutoSpeakOn()) return;
      speak(typeof l === "string" ? l : spoken(l), owner);
    },
    [owner]
  );

  const cueKey = cue !== undefined ? cue : line ? spoken(line) : null;
  useEffect(() => {
    const l = lineRef.current;
    if (!l || cueKey === null || !hasSeenGesture()) return;
    say(l);
  }, [cueKey, say]);

  useEffect(() => () => stopSpeaking(owner), [owner]);

  return { pose: shownPose, say, speaking };
}
