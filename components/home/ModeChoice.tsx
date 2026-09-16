"use client";

import { motion } from "framer-motion";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import KidHeader from "@/components/home/KidHeader";
import { JourneyIcon, PracticeIcon } from "@/components/home/ModeIcons";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
import type { CharacterId } from "@/lib/characters";
import type { KidGender } from "@/lib/memory/types";
import type { OpenerFact } from "@/lib/memory/kidMemory";

const OWNER = "mode";

/**
 * The first screen after sign-in: the character asks whether to continue
 * on the journey or practise something specific, and two big buttons
 * answer it. The icons carry the choice for a kid who can't read the
 * labels yet; the question is said out loud (the 🔊 and a tap on the
 * character repeat it — the iOS gesture rule can hold back the automatic
 * first line on a fresh page load).
 *
 * Kid-scene reskin (2026-09-15 QA fix round): brought into the same
 * composition as Home (FreePractice's subject-picker step) — warm
 * cream + teal stage, oversized character overlapping the top of one
 * white main card, illustrated mode cards instead of stock-emoji
 * buttons. This screen was previously out of the reskin's scope; PR
 * visual QA on branch design/kid-scene-reskin put it back in.
 */
export default function ModeChoice({
  kidName,
  kidGender,
  openerFact,
  character,
  onJourney,
  onFree,
  onCheckIn,
  onOpenDashboard,
}: {
  kidName: string;
  kidGender?: KidGender | null;
  /** feat: continuity greeting — one concrete thing from last time. Null on
   *  a first session, and then this screen is exactly what it was. */
  openerFact?: OpenerFact | null;
  character: CharacterId;
  onJourney: () => void;
  onFree: () => void;
  /** feat: scoped kid chat — the daily check-in, the second and last place
   *  a chat surface exists. Secondary on purpose: it is an offer, never the
   *  way into the session. */
  onCheckIn: () => void;
  onOpenDashboard: () => void;
}) {
  const line = openerFact
    ? lines.continuityGreeting(kidName, openerFact, kidGender)
    : lines.modeQuestion(kidName, kidGender);
  const guide = useGuide({ owner: OWNER, character, pose: "hello", line });

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-[var(--color-canvas)]">
      <div
        aria-hidden
        className="absolute left-[-40px] right-[-40px] top-[130px] h-[420px] pointer-events-none"
        style={{ background: "var(--color-teal-soft)", borderRadius: "48% 48% 38% 38% / 30% 30% 24% 24%" }}
      />
      <div className="relative z-10">
        <KidHeader kidName={kidName} character={character} onOpenDashboard={onOpenDashboard} />
      </div>
      <div className="relative z-10 flex-1 flex flex-col items-center gap-3 px-4 pb-10">
        <button type="button" onClick={() => guide.say(line)} aria-label="להקשיב שוב" className="mt-1">
          <Character character={character} pose={guide.pose} size={240} />
        </button>
        <SpeechBubble
          key={lines.spoken(line)}
          text={line.text}
          variant="hero"
          owner={OWNER}
          character={character}
          className="w-full max-w-md text-[var(--color-ink)]"
        />
        {/* the main card — the character overlaps its top edge, same rule
            as Home's "one strong headline, one main card" composition */}
        <div className="relative z-10 w-full max-w-md bg-[var(--color-surface)] rounded-[var(--radius-stage)] shadow-lg -mt-2 px-4 pt-6 pb-5 flex flex-col gap-3">
          <ModeCard label="המסלול שלנו" onPick={onJourney} tone="teal">
            <JourneyIcon />
          </ModeCard>
          <ModeCard label="תרגול חופשי" onPick={onFree} tone="gold">
            <PracticeIcon />
          </ModeCard>
          <button
            onClick={onCheckIn}
            className="min-h-11 text-sm text-[var(--color-ink-soft)] underline self-center"
          >
            רוצים לספר לי משהו?
          </button>
        </div>
      </div>
    </div>
  );
}

/** Illustrated mode tile — same "soft gradient + decorative circles +
 *  bespoke icon" language as FreePractice's SubjectCard, so this screen
 *  and Home read as one family rather than two different button systems. */
function ModeCard({
  label,
  onPick,
  tone,
  children,
}: {
  label: string;
  onPick: () => void;
  tone: "teal" | "gold";
  children: React.ReactNode;
}) {
  const colors =
    tone === "teal"
      ? { soft: "var(--color-teal-soft)", bg: "var(--color-teal)", deep: "var(--color-teal-ink)" }
      : { soft: "var(--color-canvas-deep)", bg: "var(--color-gold)", deep: "var(--color-gold-deep)" };
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={onPick}
      className="relative overflow-hidden rounded-[1.6rem] py-4 px-5 flex items-center gap-4 text-start"
      style={{
        background: `linear-gradient(160deg, ${colors.soft} 0%, color-mix(in srgb, ${colors.soft} 55%, white) 100%)`,
        boxShadow: `0 6px 0 ${colors.soft}, 0 8px 16px color-mix(in srgb, ${colors.deep} 20%, transparent)`,
      }}
    >
      <span aria-hidden className="absolute -top-4 -end-4 w-16 h-16 rounded-full opacity-50" style={{ background: colors.soft }} />
      <span
        aria-hidden
        className="relative shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-white"
        style={{ background: colors.bg }}
      >
        {children}
      </span>
      <span className="display relative text-xl" style={{ color: colors.deep }}>
        {label}
      </span>
    </motion.button>
  );
}
