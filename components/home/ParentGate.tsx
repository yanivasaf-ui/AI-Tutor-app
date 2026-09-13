"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
import type { CharacterId } from "@/lib/characters";

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
 *
 * Own file since the entry flow: every kid screen's header (KidHeader)
 * opens it, not just the map.
 */
export default function ParentGate({
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
