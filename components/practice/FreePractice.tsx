"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import MicButton from "@/components/character/MicButton";
import KidHeader from "@/components/home/KidHeader";
import { TOPICS, getTopicById, type MapTopic } from "@/lib/map/topics";
import { GRADES } from "@/lib/kids/grade";
import { resolveFreePracticeIntent } from "@/lib/voice/freePracticeIntent";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
import type { Line } from "@/lib/guide/lines";
import type { CharacterId } from "@/lib/characters";
import type { Grade } from "@/lib/exercises/types";
import type { Subject } from "@/lib/memory/types";

const OWNER = "free";

const SUBJECT_OPTIONS: { value: Subject; label: string; icon: string }[] = [
  { value: "math", label: "מתמטיקה", icon: "🔢" },
  { value: "hebrew", label: "עברית", icon: "📖" },
];

/** Printed on the suggested topic's button — display only, never spoken
 *  (the spoken line says "ההורים": no slash forms out loud). */
const SUGGESTION_TAG = "אמא/אבא הציעו";

interface Props {
  kidName: string;
  character: CharacterId;
  /** Orders the list (the kid's own grade first) and breaks voice ties. */
  kidGrade: Grade;
  /** The parent's "הצע תרגול" topic — first in its subject's list. */
  suggestionTopicId?: string;
  /** Coming back from an exercise, reopen the list it was picked from. */
  initialSubject?: Subject;
  onPick: (topic: MapTopic) => void;
  onBack: () => void;
  onOpenDashboard: () => void;
}

/**
 * Free practice — "mode B" of the entry flow. Subject, then every topic
 * of that subject across all three grades (all open, any order), then
 * straight into exercises. Nothing here touches the journey: exercises
 * started from this screen are answered with mode "free", and the server
 * never records map completion for those (lib/practice/state.ts). The
 * adaptive level per topic is shared with the journey — it's the same
 * topic either way.
 *
 * Voice: the mic takes a topic name at either step ("חילוק" → division)
 * or a subject name at the first — lib/voice/matchTopic.ts. Taps always
 * work; the mic is an extra path, never the only one (locked guardrail).
 */
export default function FreePractice({
  kidName,
  character,
  kidGrade,
  suggestionTopicId,
  initialSubject,
  onPick,
  onBack,
  onOpenDashboard,
}: Props) {
  const [subject, setSubject] = useState<Subject | null>(initialSubject ?? null);
  const [override, setOverride] = useState<Line | null>(null);
  const micDeniedRef = useRef(false);

  const suggestion = suggestionTopicId ? getTopicById(suggestionTopicId) : undefined;
  const suggestionHere = !!suggestion && suggestion.subject === subject;

  // The kid's own grade first, then the rest in order. The suggested
  // topic is pulled out to the top rather than listed twice. Computed
  // before `line` below: the read-aloud needs the exact order the list
  // renders in, buttons included.
  const gradeOrder = [kidGrade, ...GRADES.filter((g) => g !== kidGrade)];
  const groups = subject
    ? gradeOrder
        .map((g) => ({
          grade: g,
          topics: TOPICS.filter(
            (t) => t.subject === subject && t.grade === g && !(suggestionHere && t.id === suggestion!.id)
          ),
        }))
        .filter((g) => g.topics.length > 0)
    : [];
  const visibleTopics: MapTopic[] = subject
    ? [...(suggestionHere ? [suggestion!] : []), ...groups.flatMap((g) => g.topics)]
    : [];

  const basePromptLine = subject ? lines.freePickTopic(kidName, suggestionHere) : lines.freePickSubject(kidName);
  // Read every option aloud, in the order the buttons render — a
  // pre-reader's only way to choose is by ear (2026-09-14, grade-1 QA).
  // The BUBBLE stays the short prompt; the spoken form is longer —
  // Line.spokenText (lib/guide/lines.ts) is exactly this split, and
  // SpeechBubble's own spokenText prop keeps its 🔊 replay in sync with
  // it below.
  const line: Line =
    override ?? (visibleTopics.length > 0 ? { ...basePromptLine, spokenText: lines.readTopicList(basePromptLine.text, visibleTopics) } : basePromptLine);
  const guide = useGuide({ owner: OWNER, character, pose: "explaining", line, cue: subject ?? "subjects" });

  function chooseSubject(next: Subject | null) {
    setOverride(null);
    setSubject(next);
  }

  function say(l: Line) {
    setOverride(l);
    guide.say(l);
  }

  /** Tap always works on its own — this is a spoken acknowledgement on
   *  top of it, not a replacement. Said synchronously in the tap handler
   *  (iOS gesture rule), same pattern Onboarding's character pick uses.
   *  surviveUnmount (2026-09-14, FIX 1): onPick immediately unmounts this
   *  screen, and without it useGuide's own unmount cleanup silenced the
   *  label the instant after it was said — the tap never audibly spoke
   *  the topic name at all. */
  function pickTopic(t: MapTopic) {
    guide.say(t.displayNameKid, undefined, { surviveUnmount: true });
    onPick(t);
  }

  // The ONE place a spoken utterance turns into an action — resolved by
  // lib/voice/freePracticeIntent.ts, DOM-free and unit-tested there. Every
  // branch below dispatches into the exact same functions a tap uses
  // (chooseSubject, onPick), so the character's line can never differ by
  // input modality: whichever path sets (subject, override), useGuide's
  // cue effect is what speaks it, uniformly.
  function handleVoice(transcript: string) {
    const intent = resolveFreePracticeIntent(transcript, subject, kidGrade);
    switch (intent.kind) {
      case "topic":
        pickTopic(intent.topic);
        return;
      case "subject":
        chooseSubject(intent.subject);
        return;
      case "same-subject":
        // A tap can never produce this — picking a subject immediately
        // swaps the subject grid for the topic list, so there's no button
        // to re-tap. Re-say the topic prompt rather than silently doing
        // nothing or claiming the topic wasn't found: the kid gets an
        // acknowledgement either way, and the state was already correct.
        say(lines.freePickTopic(kidName, suggestionHere));
        return;
      case "not-found":
        say(lines.topicNotFound(kidName));
    }
  }

  const mic = (
    <MicButton
      onResult={handleVoice}
      onNothingHeard={() => {
        if (!micDeniedRef.current) say(lines.notHeard(kidName));
      }}
      onError={(reason) => {
        if (reason !== "not-allowed" && reason !== "service-not-allowed") return;
        micDeniedRef.current = true;
        say(lines.micBlocked(kidName));
      }}
      onListeningChange={(on) => {
        if (!on) return;
        micDeniedRef.current = false;
        setOverride(null);
      }}
      busyPhase={guide.speaking ? "speaking" : null}
    />
  );

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-canvas)]">
      <KidHeader
        kidName={kidName}
        character={character}
        onOpenDashboard={onOpenDashboard}
        onBack={subject ? () => chooseSubject(null) : onBack}
      />
      <div className="flex-1 flex flex-col items-center gap-4 px-4 pb-10">
        <button type="button" onClick={() => guide.say(line)} aria-label="להקשיב שוב">
          <Character character={character} pose={guide.pose} size={subject ? 130 : 200} />
        </button>
        <SpeechBubble
          key={lines.spoken(line)}
          text={line.text}
          spokenText={line.spokenText}
          lead={line.name}
          size={subject ? "md" : "lg"}
          tail="top"
          tailAlign="center"
          owner={OWNER}
          character={character}
          className="w-full max-w-md"
        />

        {!subject ? (
          <>
            <div className="grid grid-cols-2 gap-3 w-full max-w-md mt-1">
              {SUBJECT_OPTIONS.map((s) => (
                <motion.button
                  key={s.value}
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => chooseSubject(s.value)}
                  className="min-h-32 rounded-[var(--radius-bubble)] bg-[var(--color-surface)] shadow-md border-2 border-[var(--color-teal)]/20 flex flex-col items-center justify-center gap-2 text-2xl font-bold text-[var(--color-ink)]"
                >
                  <span aria-hidden className="text-5xl">
                    {s.icon}
                  </span>
                  {s.label}
                </motion.button>
              ))}
            </div>
            {mic}
          </>
        ) : (
          <>
            {mic}
            <div className="w-full max-w-md flex flex-col gap-2">
              {suggestionHere && <TopicButton topic={suggestion!} tag={SUGGESTION_TAG} onPick={pickTopic} />}
              {groups.map((g) => (
                <section key={g.grade} className="flex flex-col gap-2">
                  <h2 className="text-sm font-bold text-[var(--color-ink-soft)] mt-3">כיתה {g.grade}׳</h2>
                  {g.topics.map((t) => (
                    <TopicButton key={t.id} topic={t} onPick={pickTopic} />
                  ))}
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TopicButton({ topic, tag, onPick }: { topic: MapTopic; tag?: string; onPick: (t: MapTopic) => void }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={() => onPick(topic)}
      data-topic-id={topic.id}
      className={`w-full min-h-16 rounded-[var(--radius-button)] px-5 py-3 text-start text-lg font-medium text-[var(--color-ink)] shadow-sm border-2 ${
        tag ? "bg-[var(--color-teal-soft)] border-[var(--color-teal)]" : "bg-[var(--color-surface)] border-[var(--color-teal)]/20"
      }`}
    >
      {tag && (
        <span className="inline-block mb-1 rounded-full bg-[var(--color-warm)] text-white text-xs font-bold px-2.5 py-0.5">
          {tag}
        </span>
      )}
      {/* Kid-facing label (lib/map/topics.ts's displayNameKid), never the
          Ministry-phrasing `topic` string — a grade-1 kid, often not yet
          reading fluently, can't parse "הכרת יסודות הקריאה והכתיבה:
          מודעות פונולוגית וידע שמות האותיות." `topic.topic` still drives
          everything this button doesn't render: exercise generation,
          reuse, and matching all key on it, untouched. */}
      <span className="block leading-snug">{topic.displayNameKid}</span>
    </motion.button>
  );
}
