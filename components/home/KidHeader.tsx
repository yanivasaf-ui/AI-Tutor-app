"use client";

import { useState } from "react";
import MuteToggle from "@/components/character/MuteToggle";
import ParentGate from "@/components/home/ParentGate";
import type { CharacterId } from "@/lib/characters";

/**
 * The strip across the top of every kid screen outside an exercise: the
 * kid's name, the mute toggle, and "להורים" behind the parent gate. The
 * mode choice, the map and free practice all share it, so the parent
 * corner is reachable from wherever the kid happens to be.
 */
export default function KidHeader({
  kidName,
  character,
  onOpenDashboard,
  onBack,
  compact,
  light,
}: {
  kidName: string;
  character: CharacterId;
  onOpenDashboard: () => void;
  /** Shown as "← חזרה" when the screen has somewhere to go back to. */
  onBack?: () => void;
  /** Kid-scene reskin (2026-09-15): visually demotes the mute toggle and
   *  parent-gate button — lower opacity, no name/hover chrome — on the
   *  screens where the character and the choice ahead should read as the
   *  whole point (item 1 of the reskin brief). The tap targets stay full
   *  size (accessibility floor, not a visual choice) — only their visual
   *  weight drops; every other consumer is unaffected by default. */
  compact?: boolean;
  /** Kid-scene reskin: white/light text for a saturated subject-color
   *  backdrop (the topic picker's math/Hebrew stage) — ink-soft has poor
   *  contrast there. MuteToggle keeps its own white chip either way. */
  light?: boolean;
}) {
  const [gateOpen, setGateOpen] = useState(false);
  const textColor = light ? "text-white" : "text-[var(--color-ink-soft)]";

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className={`min-h-11 px-2 text-sm rounded-[var(--radius-button)] shrink-0 ${textColor} ${
                compact ? "opacity-70" : light ? "opacity-90" : "hover:bg-[var(--color-surface)]"
              }`}
            >
              ← חזרה
            </button>
          )}
          {!compact && <span className="text-xl font-bold text-[var(--color-teal-ink)] truncate">{kidName}</span>}
        </div>
        <div className={`flex items-center gap-2 ${compact || light ? "opacity-70" : ""}`}>
          <MuteToggle />
          <button
            onClick={() => setGateOpen(true)}
            className={`min-h-11 text-sm px-3 rounded-[var(--radius-button)] ${textColor} ${light ? "" : "hover:bg-[var(--color-surface)]"}`}
          >
            להורים
          </button>
        </div>
      </div>

      {gateOpen && (
        <ParentGate
          character={character}
          kidName={kidName}
          onSuccess={() => {
            setGateOpen(false);
            onOpenDashboard();
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </>
  );
}
