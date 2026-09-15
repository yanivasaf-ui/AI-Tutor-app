"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import MicButton from "@/components/character/MicButton";
import KidHeader from "@/components/home/KidHeader";
import TopicIcon from "@/components/practice/TopicIcon";
import { TOPICS, getTopicById, type MapTopic } from "@/lib/map/topics";
import { resolveFreePracticeIntent } from "@/lib/voice/freePracticeIntent";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
import type { Line } from "@/lib/guide/lines";
import type { CharacterId } from "@/lib/characters";
import type { Grade } from "@/lib/exercises/types";
import { SUBJECT_THEME } from "@/lib/theme/subjectTheme";
import type { KidGender, Subject } from "@/lib/memory/types";

const OWNER = "free";

const SUBJECT_OPTIONS: { value: Subject; label: string }[] = [
  { value: "math", label: "מתמטיקה" },
  { value: "hebrew", label: "עברית" },
];

/** Printed on the suggested topic's button — display only, never spoken
 *  (the spoken line says "ההורים": no slash forms out loud). */
const SUGGESTION_TAG = "אמא/אבא הציעו";

interface Props {
  kidName: string;
  kidGender?: KidGender | null;
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
  kidGender,
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

  // Voice-experience fix item 2(b): topics filtered to the kid's own grade
  // everywhere — was every grade, kid's own first (see git history for
  // that version). The suggested topic is pulled out to the top rather
  // than listed twice. Computed before `line` below.
  const topics: MapTopic[] = subject
    ? TOPICS.filter((t) => t.subject === subject && t.grade === kidGrade && !(suggestionHere && t.id === suggestion!.id))
    : [];
  const visibleTopics: MapTopic[] = subject ? [...(suggestionHere ? [suggestion!] : []), ...topics] : [];

  // Voice-experience fix item 2(a): the voice never enumerates the topic
  // list anymore — was `spokenText: lines.readTopicList(...)`, reading
  // all 10+ topics aloud. One short line only; the list is now purely
  // visual + tap/voice-match, same as every other tap-driven screen.
  const line: Line =
    override ??
    (subject ? lines.freePickTopic(kidName, suggestionHere, kidGender) : lines.freePickSubject(kidName, kidGender));
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
        say(lines.freePickTopic(kidName, suggestionHere, kidGender));
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

  // Kid-scene reskin (2026-09-15): the subject-picker step is "Home" (item
  // 1 of the brief — headline + two illustrated subject cards), the
  // topic-list step is "Topic picker" (item 2 — saturated per-subject
  // stage, coherent icon set, 2-column cards, enlarged tutor). Same
  // component, same state and handlers throughout; only the visual layer
  // branches on `subject`.
  const theme = subject ? SUBJECT_THEME[subject] : null;

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{
        background: theme
          ? `linear-gradient(180deg, ${theme.bg} 0%, ${theme.accent} 40%, ${theme.accent} 100%)`
          : `radial-gradient(120% 60% at 50% 0%, #FFFDF7 0%, var(--color-canvas) 55%, var(--color-canvas-deep) 100%)`,
      }}
    >
      {!subject && (
        <div
          aria-hidden
          className="absolute left-[-40px] right-[-40px] top-[130px] h-[420px] pointer-events-none"
          style={{ background: "var(--color-teal-soft)", borderRadius: "48% 48% 38% 38% / 30% 30% 24% 24%" }}
        />
      )}
      <div className="relative z-10">
        <KidHeader
          kidName={kidName}
          character={character}
          onOpenDashboard={onOpenDashboard}
          onBack={subject ? () => chooseSubject(null) : onBack}
          compact={!subject}
          light={!!subject}
        />
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center gap-3 px-4 pb-10">
        <button type="button" onClick={() => guide.say(line)} aria-label="להקשיב שוב" className="mt-1">
          <Character character={character} pose={guide.pose} size={subject ? 158 : 240} />
        </button>

        <SpeechBubble
          key={lines.spoken(line)}
          text={line.text}
          spokenText={line.spokenText}
          variant="hero"
          owner={OWNER}
          character={character}
          className={`w-full max-w-md ${subject ? "text-white" : "text-[var(--color-ink)]"}`}
        />

        {!subject ? (
          <>
            {/* the main card — tutor overlaps its top edge, per the reskin's
                "one strong headline, one main card" rule */}
            <div className="relative z-10 w-full max-w-md bg-[var(--color-surface)] rounded-[var(--radius-stage)] shadow-lg -mt-2 px-4 pt-2 pb-5">
              <div className="grid grid-cols-2 gap-3 mt-3">
                {SUBJECT_OPTIONS.map((s) => (
                  <SubjectCard key={s.value} subject={s.value} label={s.label} onPick={() => chooseSubject(s.value)} />
                ))}
              </div>
              <div className="mt-3">{mic}</div>
            </div>
          </>
        ) : (
          <>
            {mic}
            <div className="w-full max-w-md grid grid-cols-2 gap-3">
              {suggestionHere && <TopicCard topic={suggestion!} tag={SUGGESTION_TAG} onPick={pickTopic} full />}
              {topics.map((t) => (
                <TopicCard key={t.id} topic={t} onPick={pickTopic} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Kid-scene reskin: illustrated subject tile (item 4 of the brief) —
 *  a soft-colored scene with decorative circles behind a bespoke icon,
 *  not a plain system button. Only two subjects exist, so these two
 *  icons are hand-drawn rather than pulled from TopicIcon's category set. */
function SubjectCard({ subject, label, onPick }: { subject: Subject; label: string; onPick: () => void }) {
  const theme = SUBJECT_THEME[subject];
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={onPick}
      className="relative overflow-hidden rounded-[1.6rem] pt-5 pb-3.5 px-2 text-center"
      style={{
        background: `linear-gradient(160deg, ${theme.soft} 0%, ${theme.bg} 100%)`,
        boxShadow: `0 8px 0 ${theme.bg}, 0 10px 18px color-mix(in srgb, ${theme.deep} 25%, transparent)`,
      }}
    >
      <span aria-hidden className="absolute -top-4 -start-4 w-16 h-16 rounded-full opacity-60" style={{ background: theme.bg }} />
      <span aria-hidden className="absolute -bottom-3 -end-2 w-10 h-10 rounded-full opacity-40" style={{ background: theme.accent }} />
      <svg width="52" height="52" viewBox="0 0 58 58" fill="none" className="relative mx-auto mb-1.5" aria-hidden="true">
        {subject === "math" ? (
          <>
            <rect x="10" y="8" width="38" height="4" rx="2" fill={theme.deep} />
            <rect x="10" y="46" width="38" height="4" rx="2" fill={theme.deep} />
            <line x1="18" y1="12" x2="18" y2="46" stroke={theme.bg} strokeWidth="2.4" />
            <line x1="29" y1="12" x2="29" y2="46" stroke={theme.bg} strokeWidth="2.4" />
            <line x1="40" y1="12" x2="40" y2="46" stroke={theme.bg} strokeWidth="2.4" />
            <circle cx="18" cy="20" r="6" fill={theme.soft} stroke={theme.deep} strokeWidth="1.6" />
            <circle cx="29" cy="30" r="6" fill={theme.deep} />
            <circle cx="40" cy="24" r="6" fill={theme.soft} stroke={theme.deep} strokeWidth="1.6" />
          </>
        ) : (
          <>
            <path
              d="M29 15c-5-4-14-5-19-3v30c5-2 14-1 19 3 5-4 14-5 19-3V12c-5-2-14-1-19 3z"
              fill="#fff"
              stroke={theme.deep}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M29 15v30" stroke={theme.deep} strokeWidth="1.6" />
          </>
        )}
      </svg>
      <div className="display relative text-lg" style={{ color: theme.deep }}>
        {label}
      </div>
    </motion.button>
  );
}

/** Kid-scene reskin: 2-column illustrated topic card (item 2 of the
 *  brief) — TopicIcon's coherent set instead of stock emoji, on a white
 *  card that reads cleanly against the saturated subject stage behind
 *  it. `full` spans both columns (the parent's suggested-topic card). */
function TopicCard({
  topic,
  tag,
  onPick,
  full,
}: {
  topic: MapTopic;
  tag?: string;
  onPick: (t: MapTopic) => void;
  full?: boolean;
}) {
  const iconColor = SUBJECT_THEME[topic.subject].deep;
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={() => onPick(topic)}
      data-topic-id={topic.id}
      className={`min-h-24 rounded-[1.4rem] px-3.5 py-3.5 text-start shadow-md flex flex-col items-start gap-2 ${
        full ? "col-span-2" : ""
      } ${tag ? "bg-[var(--color-warm-soft)]" : "bg-[var(--color-surface)]"}`}
    >
      {tag && (
        <span className="inline-block rounded-full bg-[var(--color-warm)] text-white text-xs font-bold px-2.5 py-0.5">
          {tag}
        </span>
      )}
      <TopicIcon topicId={topic.id} className="" style={{ color: iconColor }} />
      {/* Kid-facing label (lib/map/topics.ts's displayNameKid), never the
          Ministry-phrasing `topic` string — a grade-1 kid, often not yet
          reading fluently, can't parse "הכרת יסודות הקריאה והכתיבה:
          מודעות פונולוגית וידע שמות האותיות." `topic.topic` still drives
          everything this card doesn't render: exercise generation,
          reuse, and matching all key on it, untouched. */}
      <span className="block leading-snug font-bold text-[15px] text-[var(--color-ink)]">{topic.displayNameKid}</span>
    </motion.button>
  );
}
