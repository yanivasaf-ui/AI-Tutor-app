"use client";

import { motion } from "framer-motion";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import KidHeader from "@/components/home/KidHeader";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
import type { CharacterId } from "@/lib/characters";

const OWNER = "mode";

/**
 * The first screen after sign-in: the character asks whether to continue
 * on the journey or practise something specific, and two big buttons
 * answer it. The icons carry the choice for a kid who can't read the
 * labels yet; the question is said out loud (the 🔊 and a tap on the
 * character repeat it — the iOS gesture rule can hold back the automatic
 * first line on a fresh page load).
 */
export default function ModeChoice({
  kidName,
  character,
  onJourney,
  onFree,
  onOpenDashboard,
}: {
  kidName: string;
  character: CharacterId;
  onJourney: () => void;
  onFree: () => void;
  onOpenDashboard: () => void;
}) {
  const line = lines.modeQuestion(kidName);
  const guide = useGuide({ owner: OWNER, character, pose: "hello", line });
  const big =
    "w-full min-h-24 rounded-[var(--radius-bubble)] shadow-md flex items-center gap-4 px-6 text-2xl font-bold";

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-canvas)]">
      <KidHeader kidName={kidName} character={character} onOpenDashboard={onOpenDashboard} />
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 pb-10">
        <button type="button" onClick={() => guide.say(line)} aria-label="להקשיב שוב">
          <Character character={character} pose={guide.pose} size={220} />
        </button>
        <SpeechBubble
          key={lines.spoken(line)}
          text={line.text}
          lead={line.name}
          tail="top"
          tailAlign="center"
          owner={OWNER}
          character={character}
          className="w-full max-w-md"
        />
        <div className="w-full max-w-md flex flex-col gap-3 mt-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onJourney}
            className={`${big} bg-[var(--color-teal)] text-white`}
          >
            <span aria-hidden className="text-4xl">🗺️</span>
            המסלול שלנו
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onFree}
            className={`${big} bg-[var(--color-surface)] text-[var(--color-ink)] border-2 border-[var(--color-teal)]/30`}
          >
            <span aria-hidden className="text-4xl">🎯</span>
            תרגול חופשי
          </motion.button>
        </div>
      </div>
    </div>
  );
}
