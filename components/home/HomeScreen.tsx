"use client";

import { useEffect, useState } from "react";
import Character from "@/components/character/Character";
import ProgressMap from "@/components/map/ProgressMap";
import type { CharacterId } from "@/lib/characters";
import type { Grade } from "@/lib/exercises/types";
import type { Subject } from "@/lib/memory/types";
import type { RecentAttempt } from "@/lib/dashboard/types";

interface Kid {
  id: string;
  name: string;
  avatarId: string | null;
}

interface Props {
  kid: Kid;
  character: CharacterId;
  grade: Grade;
  onPickTopic: (subject: Subject, topicId: string) => void;
  onOpenDashboard: () => void;
}

/**
 * Kid's default landing screen (UI Revamp Brief Section 4.2) — the map,
 * not a subject/grade form. Fetches its own slice of /api/kids's dashboard
 * payload rather than threading it through from app/page.tsx, so this
 * component is self-contained (ParentDashboard fetches its own copy too —
 * small, infrequent payload per the route's own comment about this being
 * a non-issue at this app's scale).
 */
export default function HomeScreen({ kid, character, grade, onPickTopic, onOpenDashboard }: Props) {
  const [recentAttempts, setRecentAttempts] = useState<RecentAttempt[]>([]);
  const [gateOpen, setGateOpen] = useState(false);

  useEffect(() => {
    fetch("/api/kids")
      .then((res) => (res.ok ? res.json() : { dashboard: [] }))
      .then(({ dashboard }: { dashboard: { kidId: string; recentAttempts: RecentAttempt[] }[] }) => {
        const mine = dashboard.find((d) => d.kidId === kid.id);
        if (mine) setRecentAttempts(mine.recentAttempts);
      })
      .catch(() => {});
  }, [kid.id]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-canvas)]">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setGateOpen(true)}
          className="text-sm text-[var(--color-ink-soft)] px-3 py-2 rounded-[var(--radius-button)] hover:bg-[var(--color-surface)]"
        >
          להורים
        </button>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[var(--color-ink)]">{kid.name}</span>
          <Character character={character} pose="idle" size={40} />
        </div>
      </div>

      <ProgressMap character={character} grade={grade} recentAttempts={recentAttempts} onPickTopic={onPickTopic} />

      {gateOpen && <ParentGate onSuccess={() => { setGateOpen(false); onOpenDashboard(); }} onCancel={() => setGateOpen(false)} />}
    </div>
  );
}

/**
 * Simple adult-check gate before the parent dashboard — a one-off math
 * question, not a real auth boundary (the actual account auth already
 * happened at login; this just stops a kid from wandering into the
 * parent view). Regenerates the question on open.
 */
function ParentGate({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [a] = useState(() => 3 + Math.floor(Math.random() * 6));
  const [b] = useState(() => 3 + Math.floor(Math.random() * 6));
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);

  function submit() {
    if (Number(answer) === a * b) {
      onSuccess();
    } else {
      setWrong(true);
      setAnswer("");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50">
      <div className="bg-[var(--color-surface)] rounded-[var(--radius-bubble)] p-6 w-full max-w-xs text-center">
        <p className="text-[var(--color-ink-soft)] mb-2">שאלת הורים</p>
        <p className="text-2xl font-semibold mb-4" dir="ltr">{a} × {b} = ?</p>
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          dir="ltr"
          inputMode="numeric"
          className="w-full border rounded-[var(--radius-button)] px-4 py-3 text-center text-xl mb-2"
          autoFocus
        />
        {wrong && <p className="text-[var(--color-warm)] text-sm mb-2">לא נכון, נסו שוב</p>}
        <div className="flex gap-2 mt-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-[var(--radius-button)] bg-slate-100 text-[var(--color-ink-soft)]">
            ביטול
          </button>
          <button onClick={submit} className="flex-1 py-3 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white font-medium">
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}
