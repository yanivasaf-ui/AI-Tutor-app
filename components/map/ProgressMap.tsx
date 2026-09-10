"use client";

import { useEffect, useRef, useState } from "react";
import Character from "@/components/character/Character";
import MapNode, { type NodeState } from "@/components/map/MapNode";
import { getTopics } from "@/lib/map/topics";
import type { CharacterId } from "@/lib/characters";
import type { Grade } from "@/lib/exercises/types";
import type { Subject } from "@/lib/memory/types";
import type { RecentAttempt } from "@/lib/dashboard/types";

interface Props {
  character: CharacterId;
  grade: Grade;
  recentAttempts: RecentAttempt[];
  onPickTopic: (subject: Subject, topicId: string) => void;
}

const SUBJECTS: { value: Subject; label: string }[] = [
  { value: "math", label: "חשבון" },
  { value: "hebrew", label: "עברית" },
];

/**
 * Duolingo-style winding path (UI Revamp Brief Section 4.2). Zigzag offset
 * per node rather than a full SVG bezier curve — reads as a winding path,
 * much simpler to keep reliable than hand-computing a smooth spline through
 * a variable-length topic list.
 *
 * Node completion is derived from `recentAttempts` (the dashboard payload's
 * recent-activity slice, not full history — per the brief's own directive
 * to derive client-side from what /api/kids already returns rather than
 * add a new endpoint). This is a real approximation: a topic completed
 * long enough ago to fall out of the recent-attempts window will show as
 * not-done again. Acceptable given the brief's explicit no-new-backend
 * constraint; worth knowing if it comes up.
 */
export default function ProgressMap({ character, grade, recentAttempts, onPickTopic }: Props) {
  const [subject, setSubject] = useState<Subject>("math");
  const currentRef = useRef<HTMLDivElement>(null);

  const topics = getTopics(subject, grade);
  const doneIds = new Set(
    recentAttempts.filter((a) => a.correct).map((a) => topics.find((t) => t.topic === a.topic)?.id).filter(Boolean)
  );

  let currentAssigned = false;
  const states: NodeState[] = topics.map((t) => {
    if (doneIds.has(t.id)) return "done";
    if (!currentAssigned) {
      currentAssigned = true;
      return "current";
    }
    return "locked";
  });
  const currentIndex = states.indexOf("current");

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [subject]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-center gap-2 py-3">
        {SUBJECTS.map((s) => (
          <button
            key={s.value}
            onClick={() => setSubject(s.value)}
            className={`px-5 py-2 rounded-[var(--radius-button)] text-base font-medium transition ${
              subject === s.value
                ? "bg-[var(--color-teal)] text-white"
                : "bg-[var(--color-surface)] text-[var(--color-ink-soft)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {topics.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-8">
          <p className="text-[var(--color-ink-soft)] text-lg">
            עוד אין נושאים ל{s(subject)} בכיתה {grade} — בקרוב!
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="flex flex-col items-center gap-10 max-w-xs mx-auto">
            {topics.map((t, i) => {
              const offset = i % 3 === 1 ? 56 : i % 3 === 2 ? -56 : 0;
              const isCurrent = states[i] === "current";
              return (
                <div
                  key={t.id}
                  ref={isCurrent ? currentRef : undefined}
                  className="relative flex items-center"
                  style={{ transform: `translateX(${offset}px)` }}
                >
                  <MapNode topic={t.topic} state={states[i]} onTap={() => onPickTopic(subject, t.id)} />
                  {isCurrent && (
                    <div className="absolute top-1/2 -translate-y-1/2 start-full ms-2">
                      <Character character={character} pose="idle" size={64} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function s(subject: Subject) {
  return subject === "math" ? "חשבון" : "עברית";
}
