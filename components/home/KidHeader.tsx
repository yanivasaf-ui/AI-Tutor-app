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
}: {
  kidName: string;
  character: CharacterId;
  onOpenDashboard: () => void;
  /** Shown as "← חזרה" when the screen has somewhere to go back to. */
  onBack?: () => void;
}) {
  const [gateOpen, setGateOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="min-h-11 px-2 text-sm text-[var(--color-ink-soft)] rounded-[var(--radius-button)] hover:bg-[var(--color-surface)] shrink-0"
            >
              ← חזרה
            </button>
          )}
          <span className="text-xl font-bold text-[var(--color-teal-ink)] truncate">{kidName}</span>
        </div>
        <div className="flex items-center gap-2">
          <MuteToggle />
          <button
            onClick={() => setGateOpen(true)}
            className="min-h-11 text-sm text-[var(--color-ink-soft)] px-3 rounded-[var(--radius-button)] hover:bg-[var(--color-surface)]"
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
