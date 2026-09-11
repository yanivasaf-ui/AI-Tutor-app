"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import MuteToggle from "@/components/character/MuteToggle";
import ProgressMap from "@/components/map/ProgressMap";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
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
  onPickTopic: (subject: Subject, topicId: string, wasDone: boolean) => void;
  onOpenDashboard: () => void;
}

/**
 * Kid's default landing screen (UI Revamp Brief Section 4.2) — the map,
 * with the character standing on it. Fetches its own slice of /api/kids's
 * dashboard payload rather than threading it through from app/page.tsx
 * (ParentDashboard fetches its own copy too — small, infrequent payload).
 *
 * The header's 40px character thumbnail is gone: the character lives on
 * the map now, full-size, at the kid's stop. One character on screen, not
 * a mascot in the corner and another on the path.
 */
export default function HomeScreen({ kid, character, grade, onPickTopic, onOpenDashboard }: Props) {
  const [recentAttempts, setRecentAttempts] = useState<RecentAttempt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);

  useEffect(() => {
    fetch("/api/kids")
      .then((res) => (res.ok ? res.json() : { dashboard: [] }))
      .then(({ dashboard }: { dashboard: { kidId: string; recentAttempts: RecentAttempt[] }[] }) => {
        const mine = dashboard.find((d) => d.kidId === kid.id);
        if (mine) setRecentAttempts(mine.recentAttempts);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [kid.id]);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-canvas)]">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xl font-bold text-[var(--color-teal-ink)]">{kid.name}</span>
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

      <ProgressMap
        character={character}
        kidName={kid.name}
        grade={grade}
        recentAttempts={recentAttempts}
        loaded={loaded}
        onPickTopic={onPickTopic}
      />

      {gateOpen && (
        <ParentGate
          character={character}
          kidName={kid.name}
          onSuccess={() => {
            setGateOpen(false);
            onOpenDashboard();
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Adult-check gate before the parent dashboard — a one-off math question,
 * not a real auth boundary (account auth already happened at login; this
 * stops a kid wandering into the parent view).
 *
 * Character-led (Task 5 item 1): the kid who tapped "להורים" — often by
 * accident, often before they can read "שאלת הורים" — used to hit a
 * silent math card. Now their character steps up, says by name that this
 * corner is for parents, and asks them to call one. The pose stays `idle`
 * per the pose-moment map: this is a hand-off, not the kid's moment, so
 * no performance — just the character, talking. The math question itself
 * is for the parent and stays silent text.
 */
function ParentGate({
  character,
  kidName,
  onSuccess,
  onCancel,
}: {
  character: CharacterId;
  kidName: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [a] = useState(() => 3 + Math.floor(Math.random() * 6));
  const [b] = useState(() => 3 + Math.floor(Math.random() * 6));
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);

  const line = lines.parentGate(kidName);
  const guide = useGuide({ owner: "gate", character, pose: "idle", line });

  function submit() {
    if (Number(answer) === a * b) {
      onSuccess();
    } else {
      setWrong(true);
      setAnswer("");
    }
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="שאלת הורים"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-[var(--color-ink)]/45 flex flex-col items-center justify-center p-6 z-50"
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="w-full max-w-xs flex flex-col items-center gap-3"
      >
        <Character character={character} pose={guide.pose} size={170} />
        <SpeechBubble text={line.text} lead={line.name} size="md" tail="top" tailAlign="center" owner="gate" character={character} className="w-full" />

        <div className="bg-[var(--color-surface)] rounded-[var(--radius-bubble)] p-6 w-full text-center mt-1">
          <p className="text-[var(--color-ink-soft)] mb-2">שאלת הורים</p>
          <p className="text-2xl font-semibold mb-4" dir="ltr">
            {a} × {b} = ?
          </p>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            dir="ltr"
            inputMode="numeric"
            aria-label="תשובה"
            className="w-full border rounded-[var(--radius-button)] px-4 py-3 text-center text-xl mb-2"
          />
          {wrong && <p className="text-[var(--color-warm)] text-sm mb-2">לא נכון, נסו שוב</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={onCancel} className="flex-1 min-h-12 rounded-[var(--radius-button)] bg-slate-100 text-[var(--color-ink-soft)]">
              ביטול
            </button>
            <button onClick={submit} className="flex-1 min-h-12 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white font-medium">
              אישור
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
