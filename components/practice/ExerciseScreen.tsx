"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import MicButton from "@/components/character/MicButton";
import MuteToggle from "@/components/character/MuteToggle";
import CelebrationOverlay from "@/components/celebration/CelebrationOverlay";
import NumberLineWidget from "@/components/exercises/NumberLineWidget";
import TileOrderWidget from "@/components/exercises/TileOrderWidget";
import GroupingWidget from "@/components/exercises/GroupingWidget";
import { speak, stopSpeaking, useSpeech, hasSeenGesture } from "@/lib/speech/useSpeech";
import { isAutoSpeakOn } from "@/lib/speech/autoSpeak";
import { useCelebration } from "@/lib/celebration/useCelebration";
import { useTalkingPose, type CharacterId, type CharacterPose } from "@/lib/characters";
import * as lines from "@/lib/guide/lines";
import type { Line } from "@/lib/guide/lines";
import { matchChoice, matchNumberLine } from "@/lib/voice/matchAnswer";
import { recordTiming } from "@/lib/voice/timing";
import type { Exercise, ExerciseEvaluation } from "@/lib/exercises/types";

const SESSION_TARGET_MS = 15 * 60 * 1000;

/** This screen's character, in the speech owner model — only it lip-syncs
 *  to lines said here. */
const OWNER = "exercise";

interface Props {
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  /** feat: topic-scoped exercise generation — the map node's topic id, if
   *  the kid arrived here via a topic tap rather than a bare subject pick.
   *  Optional and passed straight through to /api/tutor; omitted, exercise
   *  generation is exactly the prior subject+grade behavior. */
  topicId?: string;
  /** Whether the map already showed this stop as done. `false` makes the
   *  first correct answer here a topic completion — a full-screen tier-2
   *  moment. Omitted = unknown, and no topic celebration fires. */
  topicWasDone?: boolean;
  kidId: string;
  /** How the character addresses the kid, in every line (Task 5 item 5). */
  kidName: string;
  character: CharacterId;
  /** Owned by the parent, not here, so switching subject/grade mid-session
   *  doesn't reset the clock (project-brief.md Section 2d-2: ~15 min/day,
   *  one daily session regardless of what's practiced within it). Same
   *  contract as the original PracticeMode.tsx. */
  sessionStartedAt: number;
  sessionCloseShown: boolean;
  onSessionClose: () => void;
  onBackToMap: () => void;
}

/**
 * The exercise, as a conversation the character leads (character-led
 * redesign, Task 5). The generate_exercise / answer_exercise calls, the
 * evaluation flow, the voice matching and the 15-minute soft-session
 * condition are unchanged; what changed is who's driving:
 *
 * - The character is the stage — 220px (170 with a reading passage),
 *   centred at the top — and there is ONE bubble under it: whatever the
 *   character is saying right now. The question; then "רגע, אני חושב/ת"
 *   while the answer is evaluated; then the feedback; or "I didn't hear
 *   you". Every one opens with the kid's name. When the bubble isn't the
 *   question, the question stays visible underneath as a quiet reminder.
 * - Pose follows the pose-moment map: thinking while an exercise is built
 *   or an answer is evaluated, explaining on the question, correct /
 *   encouraging on feedback.
 * - Everything the character says is also said out loud (useSpeech +
 *   useTalkingPose — the existing primitives), gated by the device mute
 *   and the iOS gesture rule.
 * - Topic complete and session complete are full-screen tier-2
 *   celebrations (CelebrationOverlay), not an inline banner.
 *
 * Tap answers work for every exercise type, always; the mic is an extra
 * path, never the only one (locked guardrail).
 */
export default function ExerciseScreen({
  subject,
  grade,
  topicId,
  topicWasDone,
  kidId,
  kidName,
  character,
  sessionStartedAt,
  sessionCloseShown,
  onSessionClose,
  onBackToMap,
}: Props) {
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<ExerciseEvaluation | null>(null);
  const [loadingExercise, setLoadingExercise] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  /** The last load failed (network, 5xx, unreadable response) — as opposed
   *  to the API genuinely having nothing for this topic. Different
   *  screens: one offers a retry, the other a way back to the map. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  /** The OS/browser refused microphone access on the last attempt — a
   *  more specific dead end than noMatch's generic "didn't hear you"
   *  (2026-09-12 iPhone QA: "voice input fails"). Cleared the moment
   *  listening starts again, same as noMatch. */
  const [micDenied, setMicDenied] = useState(false);
  const [topicCelebration, setTopicCelebration] = useState(false);
  const [sessionGoodbye, setSessionGoodbye] = useState(false);
  /** Set once this visit's topic has been celebrated (or was already done
   *  before we got here) — a topic completes once. */
  const topicDoneRef = useRef(topicWasDone !== false);

  const { speaking } = useSpeech(OWNER);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Latency instrumentation (ROADMAP.md's ~2s budget). turnStartedAt is
  // set when the kid releases the mic and cleared once the character
  // starts speaking the reply, so "turn" measures the full voice-in ->
  // voice-out span the kid actually experiences.
  const turnStartedAtRef = useRef<number | null>(null);
  const speakCalledAtRef = useRef<number | null>(null);

  /** True while the utterance currently starting is the thinking cue, so
   *  the "turn" metric keeps measuring time-to-*answer* rather than
   *  time-to-acknowledgement (which would flatter the number). */
  const speakingAckRef = useRef(false);

  /** Automatic speech: gated on the device mute AND the iOS gesture rule.
   *  Explicit 🔊 taps inside a bubble bypass this deliberately. */
  const speakAuto = useCallback((text: string, opts?: { ack?: boolean }) => {
    if (!isAutoSpeakOn() || !hasSeenGesture()) return;
    speakCalledAtRef.current = performance.now();
    speakingAckRef.current = opts?.ack === true;
    speak(text, OWNER, character);
  }, [character]);

  // Leaving mid-sentence (back to map) must not keep talking over the map.
  useEffect(() => () => stopSpeaking(OWNER), []);

  // speak() resolves asynchronously inside the speech engine, so
  // "how long until the kid actually hears something" is only knowable by
  // watching the speaking flag flip.
  useEffect(() => {
    if (!speaking) return;
    const calledAt = speakCalledAtRef.current;
    if (calledAt !== null) {
      recordTiming("speak-start", performance.now() - calledAt);
      speakCalledAtRef.current = null;
    }
    if (turnStartedAtRef.current !== null) {
      if (speakingAckRef.current) {
        // Time-to-acknowledgement: what the kid hears first. The turn
        // itself is still in flight, so leave the clock running.
        recordTiming("ack", performance.now() - turnStartedAtRef.current);
      } else {
        recordTiming("turn", performance.now() - turnStartedAtRef.current);
        turnStartedAtRef.current = null;
      }
    }
  }, [speaking]);

  // Base semantic pose (the pose-moment map), with the talk-mouth
  // alternation layered on top while this character speaks.
  const [basePose, setBasePose] = useState<CharacterPose>("thinking");
  const pose = useTalkingPose(speaking, basePose);
  const { celebrate } = useCelebration(setBasePose);

  /** The question as said out loud — same words, same order as its
   *  bubble: name, passage, question. Grouping's tap-to-place instruction
   *  is appended in the same breath (also shown as a caption — see the
   *  render below) since the interaction isn't otherwise self-explanatory
   *  (2026-09-12 iPhone QA: grouping was an unexplained dead end). */
  function questionSpeech(ex: Exercise) {
    return [`${kidName},`, ex.passage, ex.question, ex.type === "grouping" ? lines.groupingInstructions().text : null]
      .filter(Boolean)
      .join(" ");
  }

  async function loadNextExercise() {
    setLoadingExercise(true);
    setEvaluation(null);
    setAnswer("");
    setNoMatch(false);
    setTopicCelebration(false);
    setBasePose("thinking");
    setLoadFailed(false);
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_exercise", subject, grade, kidId, topic: topicId }),
      });
      // A body that isn't JSON (a platform error page, a cut-off response)
      // is a failure, not an empty topic.
      const data = (await res.json().catch(() => null)) as { exercise?: Exercise | null; error?: string } | null;
      if (res.ok && data?.exercise) {
        setExercise(data.exercise);
      } else if (res.status === 404 && data?.error === "no_content") {
        // The one genuine "nothing to practice here" answer — see
        // NoCurriculumContentError in lib/exercises/generate.ts.
        setExercise(null);
      } else {
        // 5xx, any other error status, or a 200 with no exercise in it.
        setExercise(null);
        setLoadFailed(true);
      }
    } catch {
      // fetch itself threw: offline, DNS, connection dropped.
      setExercise(null);
      setLoadFailed(true);
    } finally {
      setLoadingExercise(false);
      setLoadedOnce(true);
    }
  }

  useEffect(() => {
    loadNextExercise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, grade]);

  // New exercise arrived → explaining pose + read aloud. Gated on
  // hasSeenGesture() — an exercise that loads before the kid's first tap
  // must not try to speak.
  useEffect(() => {
    if (!exercise) return;
    setBasePose("explaining");
    speakAuto(questionSpeech(exercise));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise]);

  // No exercise: say which dead end this is, out loud — "nothing here yet"
  // and "something broke" are different situations with different ways out.
  useEffect(() => {
    if (!loadedOnce || loadingExercise || exercise) return;
    setBasePose("thinking");
    speakAuto(lines.spoken(loadFailed ? lines.somethingBroke(kidName) : lines.noContent(kidName)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedOnce, loadingExercise, exercise, loadFailed]);

  async function submitAnswer(value: string, opts?: { viaVoice?: boolean }) {
    if (!exercise || !value.trim() || submitting) return;
    setSubmitting(true);
    setNoMatch(false);
    setBasePose("thinking");
    // Voice turns get an immediate audible acknowledgement so the ~2.5s
    // evaluation isn't dead silence. A kid who tapped is watching the
    // screen and sees the thinking pose; a kid who spoke may not be
    // looking, and silence reads as "it didn't hear me" -> they repeat
    // themselves over the pending turn. Voice turns only: on tap answers
    // it would be chatter on top of a visual signal they already have.
    if (opts?.viaVoice) speakAuto(lines.spoken(lines.thinking(character, kidName)), { ack: true });
    const evaluateStartedAt = performance.now();
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer_exercise", exercise, answer: value, kidId }),
      });
      const data = await res.json();
      recordTiming("evaluate", performance.now() - evaluateStartedAt);
      const result: ExerciseEvaluation = data.evaluation ?? { correct: false, feedback: lines.somethingBroke(kidName).text };
      setEvaluation(result);
      if (result.correct) {
        // Tier-2 moments take the whole screen and say their own line;
        // everything else is the tier-1 burst from the bubble. The session
        // condition is the same one the old inline banner used (see
        // showSessionOverlay below) — only its presentation changed.
        const sessionMoment = !sessionCloseShown && Date.now() - sessionStartedAt >= SESSION_TARGET_MS;
        const topicMoment = !!topicId && !topicDoneRef.current;
        if (topicMoment) topicDoneRef.current = true;
        if (sessionMoment || topicMoment) {
          setBasePose("correct");
          if (!sessionMoment) setTopicCelebration(true);
          return;
        }
        celebrate(1, bubbleRef.current);
      } else {
        setBasePose("encouraging");
      }
      speakAuto(lines.spoken(lines.feedback(kidName, result.feedback)));
    } catch {
      setEvaluation({ correct: false, feedback: lines.somethingBroke(kidName).text });
      setBasePose("encouraging");
    } finally {
      setSubmitting(false);
    }
  }

  /** Character asks the kid to repeat — spoken, not just printed, since a
   *  kid who needs voice input is often a kid who can't read the hint.
   *  ROADMAP.md Phase 1A: "if STT confidence is low, the character asks
   *  'מה? לא שמעתי, אפשר שוב?' instead of guessing." */
  const askToRepeat = useCallback(() => {
    turnStartedAtRef.current = null; // this turn didn't complete
    setNoMatch(true);
    setBasePose("encouraging");
    speakAuto(lines.spoken(lines.notHeard(kidName)));
  }, [speakAuto, kidName]);

  /** Distinguishes "the OS refused microphone access" from genuinely
   *  hearing nothing (2026-09-12 iPhone QA: "voice input fails" — the
   *  generic notHeard copy invites trying again louder, which does
   *  nothing when the mic is blocked; every retry would fail the same
   *  way until a permission setting changes). Every other reason
   *  ("no-speech", "network", ...) already gets the generic re-ask via
   *  onNothingHeard/askToRepeat — this only adds a distinct branch for
   *  the one reason that isn't actually "try again". */
  const handleMicError = useCallback(
    (reason: string) => {
      if (reason !== "not-allowed" && reason !== "service-not-allowed") return;
      turnStartedAtRef.current = null;
      setMicDenied(true);
      setBasePose("encouraging");
      speakAuto(lines.spoken(lines.micBlocked(kidName)));
    },
    [speakAuto, kidName]
  );

  /**
   * Spoken answer -> exercise answer. See lib/voice/matchAnswer.ts for the
   * normalization/matching rules. Ambiguous or unmatched input asks the
   * kid to repeat rather than guessing — submitting a wrong answer on the
   * tutor's behalf would get a child marked wrong for the recognizer's
   * mistake. tile_order and grouping stay tap-only by design: spatial
   * arrangement tasks with no natural spoken form.
   */
  function handleVoiceResult(transcript: string) {
    if (!exercise) return;

    if (exercise.type === "multiple_choice" && exercise.choices) {
      const matchStartedAt = performance.now();
      const match = matchChoice(transcript, exercise.choices);
      recordTiming("match", performance.now() - matchStartedAt);
      if (match.kind === "choice") {
        setNoMatch(false);
        submitAnswer(match.value, { viaVoice: true });
        return;
      }
      askToRepeat();
      return;
    }

    if (exercise.type === "number_line" && exercise.numberLine) {
      const match = matchNumberLine(transcript, exercise.numberLine);
      if (match.kind === "value") {
        setNoMatch(false);
        submitAnswer(match.value, { viaVoice: true });
        return;
      }
      askToRepeat();
      return;
    }

    if (exercise.type === "open") {
      // Free text isn't auto-submitted — the transcript fills the input
      // and the kid confirms (no option set to validate a mis-hearing
      // against).
      setAnswer(transcript);
      setNoMatch(false);
      turnStartedAtRef.current = null;
      return;
    }

    askToRepeat();
  }

  const sessionTargetReached = Date.now() - sessionStartedAt >= SESSION_TARGET_MS;
  // Exactly the old banner's condition — the 15-minute soft-session logic
  // is untouched; it now renders as a full-screen moment instead.
  const showSessionOverlay = !!evaluation?.correct && !sessionCloseShown && sessionTargetReached;

  const topBar = (
    <div className="flex justify-between items-center pt-2 pb-1">
      <button onClick={onBackToMap} className="min-h-11 px-1 text-sm text-[var(--color-ink-soft)]">
        ← חזרה למפה
      </button>
      <MuteToggle />
    </div>
  );

  // Building an exercise — first load or the next one. The character
  // thinks; the old question is gone, so it can't be answered while its
  // replacement is on the way.
  if (loadingExercise || (!exercise && !loadedOnce)) {
    const l = lines.buildingExercise(character, kidName);
    return (
      <div className="flex flex-col flex-1 px-4 pb-4">
        {topBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-10">
          <Character character={character} pose={pose} size={220} />
          <SpeechBubble text={l.text} lead={l.name} tail="top" tailAlign="center" owner={OWNER} character={character} className="w-full max-w-md" />
        </div>
      </div>
    );
  }

  // No exercise. A failed load gets "something broke" and a retry; a
  // genuinely empty topic gets "nothing here yet" and the way back. Both
  // keep the `thinking` pose — `encouraging` is the wrong-answer pose, and
  // a server hiccup isn't the kid's mistake.
  if (!exercise) {
    const l = loadFailed ? lines.somethingBroke(kidName) : lines.noContent(kidName);
    const primary = "min-h-16 px-8 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium";
    const secondary = "min-h-14 px-8 rounded-[var(--radius-button)] bg-[var(--color-surface)] text-[var(--color-ink)] text-lg font-medium shadow-sm";
    return (
      <div className="flex flex-col flex-1 px-4 pb-4">
        {topBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-10">
          <Character character={character} pose={pose} size={220} />
          <SpeechBubble
            text={l.text}
            lead={l.name}
            tone={loadFailed ? "warm" : "default"}
            tail="top"
            tailAlign="center"
            owner={OWNER}
            character={character}
            className="w-full max-w-md"
          />
          {loadFailed && (
            <button onClick={() => loadNextExercise()} className={primary}>
              לנסות שוב
            </button>
          )}
          <button onClick={onBackToMap} className={loadFailed ? secondary : primary}>
            חזרה למפה
          </button>
        </div>
      </div>
    );
  }

  // What the character is saying right now — the one bubble. micDenied
  // ranks ahead of noMatch: it's a more specific, more actionable dead end
  // than the generic "didn't hear you".
  let main: { line: Line; detail?: string; tone: "default" | "success" | "warm" };
  if (submitting) main = { line: lines.thinking(character, kidName), tone: "default" };
  else if (evaluation)
    main = { line: lines.feedback(kidName, evaluation.feedback), tone: evaluation.correct ? "success" : "warm" };
  else if (micDenied && !listening) main = { line: lines.micBlocked(kidName), tone: "warm" };
  else if (noMatch && !listening) main = { line: lines.notHeard(kidName), tone: "warm" };
  else main = { line: lines.question(kidName, exercise.question), detail: exercise.passage, tone: "default" };
  const showQuestionReminder = submitting || ((noMatch || micDenied) && !listening && !evaluation) || (!!evaluation && !evaluation.correct);
  // Voice never works for these two: tile_order/grouping are spatial
  // arrangement tasks with no natural spoken form (locked design), and
  // grouping specifically was a real dead end in iPhone QA even before
  // voice entered into it — showing a mic that can only ever fail is
  // worse than no mic at all. Tap stays fully usable either way.
  const micApplies = exercise.type !== "tile_order" && exercise.type !== "grouping";

  return (
    <div className="flex flex-col flex-1 px-4 pb-4">
      {topBar}

      <div className="flex justify-center">
        <Character character={character} pose={pose} size={exercise.passage ? 170 : 220} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={exercise.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col gap-3 mt-2"
        >
          <div ref={bubbleRef}>
            <SpeechBubble
              key={lines.spoken(main.line)}
              text={main.line.text}
              lead={main.line.name}
              detail={main.detail}
              tone={main.tone}
              tail="top"
              tailAlign="center"
              owner={OWNER} character={character}
            />
          </div>

          {showQuestionReminder && (
            <p className="text-center text-lg text-[var(--color-ink-soft)] px-2">{exercise.question}</p>
          )}

          {!evaluation && exercise.type === "grouping" && (
            <p className="text-center text-base text-[var(--color-ink-soft)] px-2 -mt-1">
              {lines.groupingInstructions().text}
            </p>
          )}

          {!evaluation && exercise.type === "multiple_choice" && exercise.choices && (
            <div className="flex flex-col gap-2 mt-1">
              {exercise.choices.map((choice, i) => (
                <motion.button
                  key={i}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => submitAnswer(choice)}
                  disabled={submitting}
                  className="min-h-16 rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/30 bg-[var(--color-surface)] text-2xl font-medium text-[var(--color-ink)] px-5 disabled:opacity-50"
                  dir={/^[\d+\-*/=.,\s]+$/.test(choice) ? "ltr" : undefined}
                >
                  {choice}
                </motion.button>
              ))}
            </div>
          )}

          {!evaluation && exercise.type === "number_line" && exercise.numberLine && (
            <NumberLineWidget data={exercise.numberLine} disabled={submitting} onSubmit={submitAnswer} />
          )}

          {!evaluation && exercise.type === "tile_order" && exercise.tiles && (
            <TileOrderWidget data={exercise.tiles} disabled={submitting} onSubmit={submitAnswer} />
          )}

          {!evaluation && exercise.type === "grouping" && exercise.grouping && (
            <GroupingWidget data={exercise.grouping} disabled={submitting} onSubmit={submitAnswer} />
          )}

          {!evaluation && exercise.type === "open" && (
            <div className="flex gap-2">
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitAnswer(answer)}
                placeholder="התשובה שלי..."
                className="flex-1 min-h-16 rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/30 px-5 text-2xl"
                disabled={submitting}
              />
              <button
                onClick={() => submitAnswer(answer)}
                disabled={submitting || !answer.trim()}
                className="min-h-16 px-6 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium disabled:opacity-50"
              >
                שלח
              </button>
            </div>
          )}

          {!evaluation && micApplies && (
            <div className="flex justify-center mt-2">
              <MicButton
                onResult={handleVoiceResult}
                onNothingHeard={askToRepeat}
                onError={handleMicError}
                onListeningChange={(isListening) => {
                  setListening(isListening);
                  // Turn clock starts when the kid stops talking — that's
                  // the moment they begin waiting on the character.
                  if (!isListening) turnStartedAtRef.current = performance.now();
                  if (isListening) {
                    setNoMatch(false);
                    setMicDenied(false);
                  }
                }}
                busyPhase={submitting ? "thinking" : speaking ? "speaking" : null}
                disabled={submitting}
              />
            </div>
          )}

          {evaluation && !evaluation.correct && (
            <button
              onClick={() => {
                setEvaluation(null);
                setBasePose("explaining");
                speakAuto(questionSpeech(exercise));
              }}
              className="self-center min-h-14 px-8 rounded-[var(--radius-button)] bg-[var(--color-surface)] border-2 border-[var(--color-warm)]/40 text-lg text-[var(--color-ink)]"
            >
              לנסות שוב
            </button>
          )}

          {evaluation && evaluation.correct && (
            <button
              onClick={() => loadNextExercise()}
              className="self-center min-h-16 px-8 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium mt-1"
            >
              עוד תרגיל!
            </button>
          )}
        </motion.div>
      </AnimatePresence>

      {showSessionOverlay && (
        <CelebrationOverlay
          character={character}
          pose={sessionGoodbye ? "goodbye" : "celebration"}
          line={sessionGoodbye ? lines.goodbye(kidName) : lines.sessionComplete(kidName)}
          actions={
            sessionGoodbye
              ? [
                  {
                    label: "למפה",
                    primary: true,
                    onClick: () => {
                      onSessionClose();
                      onBackToMap();
                    },
                  },
                ]
              : [
                  {
                    label: "עוד קצת!",
                    primary: true,
                    onClick: () => {
                      onSessionClose();
                      loadNextExercise();
                    },
                  },
                  { label: "סיימנו להיום", onClick: () => setSessionGoodbye(true) },
                ]
          }
        />
      )}

      {topicCelebration && !showSessionOverlay && (
        <CelebrationOverlay
          character={character}
          line={lines.topicComplete(kidName)}
          actions={[
            { label: "לתחנה הבאה", primary: true, onClick: onBackToMap },
            { label: "עוד תרגול כאן", onClick: () => loadNextExercise() },
          ]}
        />
      )}
    </div>
  );
}
