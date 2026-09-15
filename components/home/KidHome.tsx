"use client";

import { useCallback, useEffect, useState } from "react";
import ModeChoice from "@/components/home/ModeChoice";
import HomeScreen from "@/components/home/HomeScreen";
import FreePractice from "@/components/practice/FreePractice";
import ExerciseScreen from "@/components/practice/ExerciseScreen";
import { readLegacyStoredGrade, resolveGrade } from "@/lib/kids/grade";
import { activeSuggestion, type PracticeMode, type PracticeState } from "@/lib/practice/state";
import * as lines from "@/lib/guide/lines";
import { prefetchSpeech } from "@/lib/speech/useSpeech";
import type { CharacterId } from "@/lib/characters";
import type { Grade } from "@/lib/exercises/types";
import type { KidGender, Subject } from "@/lib/memory/types";

export interface KidSummary {
  id: string;
  name: string;
  avatarId: string | null;
  grade: Grade | null;
  gender: KidGender | null;
}

type Practice = Partial<Record<Subject, PracticeState>>;

type View =
  | { name: "choose" }
  | { name: "journey" }
  | { name: "free"; subject?: Subject }
  | { name: "exercise"; mode: PracticeMode; subject: Subject; grade: Grade; topicId: string; wasDone?: boolean };

interface KidsPayload {
  kids: { id: string; grade: Grade | null; subjects: Partial<Record<Subject, { practice?: PracticeState }>> }[];
}

/**
 * Kid-facing shell — the entry flow. After sign-in the character asks
 * which way today (ModeChoice):
 * - the journey (HomeScreen → the school-year map), where a stop tap opens
 *   ExerciseScreen in mode "journey";
 * - free practice (FreePractice → subject → any topic), opening
 *   ExerciseScreen in mode "free", at the topic's own grade.
 * Leaving an exercise goes back to where it was started from, and
 * refreshes the practice state (a completed stop, a new level).
 *
 * The one /api/kids?view=kid fetch lives here, shared by every kid screen:
 * the grade (kids.grade), and per subject the practice state — journey
 * completion, levels, the intro flag and the parent's suggestion.
 */
export default function KidHome({
  kid,
  character,
  onOpenDashboard,
}: {
  kid: KidSummary;
  character: CharacterId;
  onOpenDashboard: () => void;
}) {
  const [view, setView] = useState<View>({ name: "choose" });
  const [practice, setPractice] = useState<Practice>({});
  const [serverGrade, setServerGrade] = useState<Grade | null>(kid.grade);
  const [loaded, setLoaded] = useState(false);
  // Owned here, not in ExerciseScreen, so moving between topics or modes
  // mid-session doesn't reset the clock (project-brief.md Section 2d-2:
  // ~15 min/day, one daily session regardless of what's practiced).
  const [sessionStartedAt] = useState(() => Date.now());
  const [sessionCloseShown, setSessionCloseShown] = useState(false);
  const grade = resolveGrade({ id: kid.id, grade: serverGrade });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/kids?view=kid");
      if (!res.ok) return;
      const { kids } = (await res.json()) as KidsPayload;
      const me = kids.find((k) => k.id === kid.id);
      if (!me) return;
      setServerGrade(me.grade);
      setPractice({ math: me.subjects.math?.practice ?? {}, hebrew: me.subjects.hebrew?.practice ?? {} });
    } catch {
      // Offline or a server hiccup: the screens keep what they had.
    } finally {
      setLoaded(true);
    }
  }, [kid.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Voice-experience fix item 1: ModeChoice's question is the very first
  // thing said every session, spoken almost immediately after it mounts —
  // fired here, one render earlier (kid + character are already known;
  // ModeChoice itself hasn't mounted yet), so the Cartesia round trip has
  // a head start on the render+cue-effect gap instead of racing it cold.
  useEffect(() => {
    prefetchSpeech(lines.modeQuestion(kid.name, kid.gender).text, character);
  }, [kid.name, kid.gender, character]);

  // kids.grade backfill: a kid created before the column existed has its
  // grade only in this device's localStorage. Copy it up once, so the
  // server — and every other device — agrees from then on.
  useEffect(() => {
    if (kid.grade) return;
    const legacy = readLegacyStoredGrade(kid.id);
    if (!legacy) return;
    fetch("/api/kids", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: kid.id, grade: legacy }),
    })
      .then((res) => {
        if (res.ok) setServerGrade(legacy);
      })
      .catch(() => {});
  }, [kid.id, kid.grade]);

  function markIntroSeen(subject: Subject) {
    setPractice((p) => ({ ...p, [subject]: { ...p[subject], journeyIntroSeenAt: new Date().toISOString() } }));
    fetch("/api/kids", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: kid.id, journeyIntroSeen: subject }),
    }).catch(() => {});
  }

  if (view.name === "exercise") {
    const from = view;
    return (
      <div className="min-h-screen flex flex-col bg-[var(--color-canvas)]">
        <ExerciseScreen
          key={`${from.mode}:${from.topicId}`}
          subject={from.subject}
          grade={from.grade}
          topicId={from.topicId}
          topicWasDone={from.mode === "journey" ? from.wasDone : undefined}
          mode={from.mode}
          backLabel={from.mode === "journey" ? "חזרה למפה" : "חזרה לנושאים"}
          kidId={kid.id}
          kidName={kid.name}
          kidGender={kid.gender}
          character={character}
          sessionStartedAt={sessionStartedAt}
          sessionCloseShown={sessionCloseShown}
          onSessionClose={() => setSessionCloseShown(true)}
          onBackToMap={() => {
            setView(from.mode === "journey" ? { name: "journey" } : { name: "free", subject: from.subject });
            refresh();
          }}
          onGoHome={() => {
            setView({ name: "choose" });
            refresh();
          }}
        />
      </div>
    );
  }

  if (view.name === "journey") {
    return (
      <HomeScreen
        kid={kid}
        character={character}
        grade={grade}
        practice={practice}
        loaded={loaded}
        onPickTopic={(subject, topicId, wasDone) =>
          setView({ name: "exercise", mode: "journey", subject, grade, topicId, wasDone })
        }
        onIntroSeen={markIntroSeen}
        onOpenDashboard={onOpenDashboard}
        onBack={() => setView({ name: "choose" })}
      />
    );
  }

  if (view.name === "free") {
    return (
      <FreePractice
        kidName={kid.name}
        kidGender={kid.gender}
        character={character}
        kidGrade={grade}
        suggestionTopicId={activeSuggestion(practice)?.topicId}
        initialSubject={view.subject}
        onPick={(t) => setView({ name: "exercise", mode: "free", subject: t.subject, grade: t.grade, topicId: t.id })}
        onBack={() => setView({ name: "choose" })}
        onOpenDashboard={onOpenDashboard}
      />
    );
  }

  return (
    <ModeChoice
      kidName={kid.name}
      kidGender={kid.gender}
      character={character}
      onJourney={() => setView({ name: "journey" })}
      onFree={() => setView({ name: "free" })}
      onOpenDashboard={onOpenDashboard}
    />
  );
}
