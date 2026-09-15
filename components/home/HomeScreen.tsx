"use client";

import KidHeader from "@/components/home/KidHeader";
import ProgressMap from "@/components/map/ProgressMap";
import type { CharacterId } from "@/lib/characters";
import type { Grade } from "@/lib/exercises/types";
import type { Subject } from "@/lib/memory/types";
import type { PracticeState } from "@/lib/practice/state";

interface Props {
  kid: { id: string; name: string };
  character: CharacterId;
  grade: Grade;
  practice: Partial<Record<Subject, PracticeState>>;
  loaded: boolean;
  onPickTopic: (subject: Subject, topicId: string, wasDone: boolean) => void;
  onIntroSeen: (subject: Subject) => void;
  onOpenDashboard: () => void;
  onBack: () => void;
}

/**
 * The journey — "mode A" of the entry flow: the school-year map, with the
 * character standing on it. Data comes from KidHome (one /api/kids fetch
 * for every kid screen, refreshed after each exercise) rather than each
 * screen fetching its own copy.
 *
 * The header's 40px character thumbnail is gone: the character lives on
 * the map, full-size, at the kid's stop. One character on screen, not a
 * mascot in the corner and another on the path.
 */
export default function HomeScreen({
  kid,
  character,
  grade,
  practice,
  loaded,
  onPickTopic,
  onIntroSeen,
  onOpenDashboard,
  onBack,
}: Props) {
  return (
    <div className="h-screen flex flex-col bg-[var(--color-canvas)]">
      <KidHeader kidName={kid.name} character={character} onOpenDashboard={onOpenDashboard} onBack={onBack} />
      <ProgressMap
        character={character}
        kidName={kid.name}
        grade={grade}
        practice={practice}
        loaded={loaded}
        onPickTopic={onPickTopic}
        onIntroSeen={onIntroSeen}
      />
    </div>
  );
}
