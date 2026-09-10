"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import MicButton from "@/components/character/MicButton";
import NumberLineWidget from "@/components/exercises/NumberLineWidget";
import TileOrderWidget from "@/components/exercises/TileOrderWidget";
import GroupingWidget from "@/components/exercises/GroupingWidget";
import { useSpeech, hasSeenGesture } from "@/lib/speech/useSpeech";
import { useAutoSpeak } from "@/lib/speech/autoSpeak";
import { useCelebration } from "@/lib/celebration/useCelebration";
import { useTalkingPose, type CharacterId, type CharacterPose } from "@/lib/characters";
import { matchChoice, matchNumberLine } from "@/lib/voice/matchAnswer";
import { recordTiming } from "@/lib/voice/timing";
import type { Exercise, ExerciseEvaluation } from "@/lib/exercises/types";

const SESSION_TARGET_MS = 15 * 60 * 1000;

const NOT_HEARD_PROMPT = "לא שמעתי טוב, אפשר לומר שוב?";

/**
 * Spoken "I heard you, I'm thinking" cue, gendered to the character.
 *
 * Measured: the evaluate leg is ~2.5s (real LLM round trip), which is
 * ROADMAP.md's entire ~2s budget on its own. This doesn't make the turn
 * faster — it removes the *dead silence*, which is the part a 6-year-old
 * actually can't interpret. A kid who tapped an answer is watching the
 * screen and sees the `thinking` pose; a kid who spoke may not be
 * looking, and silence reads as "it didn't hear me" -> they repeat
 * themselves over the top of the pending turn.
 *
 * Voice turns only, deliberately. Firing this on every tap answer too
 * would be chatter for a kid who already has the visual signal.
 */
const THINKING_CUE: Record<"boy" | "girl", string> = {
  boy: "רגע, אני חושב...",
  girl: "רגע, אני חושבת...",
};

interface Props {
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  /** feat: topic-scoped exercise generation — the map node's topic id, if
   *  the kid arrived here via a topic tap rather than a bare subject pick.
   *  Optional and passed straight through to /api/tutor; omitted, exercise
   *  generation is exactly the prior subject+grade behavior. */
  topicId?: string;
  kidId: string;
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
 * Replaces components/PracticeMode.tsx (UI Revamp Brief Section 4.1). The
 * generate_exercise / answer_exercise fetch calls and the evaluation flow
 * are unchanged from the original — only the presentation moved from "card
 * with a form" to "conversation with the character." Preserves the
 * hard-won fixes noted in the brief: the evaluation-loading busy signal
 * (now the `thinking` pose instead of a bare spinner) and the 15-minute
 * soft session banner logic verbatim.
 */
export default function ExerciseScreen({
  subject,
  grade,
  topicId,
  kidId,
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
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [noMatch, setNoMatch] = useState(false);

  // Shared device-level mute (lib/speech/autoSpeak.ts) — the character
  // speaks on every screen now, not just this one.
  const [autoSpeak, setAutoSpeak] = useAutoSpeak();
  const { speak, speaking, supported: speechSupported } = useSpeech();
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Latency instrumentation (ROADMAP.md's ~2s budget). turnStartedAt is
  // set when the kid releases the mic and cleared once the character
  // starts speaking the reply, so "turn" measures the full voice-in ->
  // voice-out span the kid actually experiences.
  const turnStartedAtRef = useRef<number | null>(null);
  const speakCalledAtRef = useRef<number | null>(null);

  /** Auto-speech: gated on the mute toggle AND the iOS gesture rule.
   *  Explicit 🔊 taps inside SpeechBubble bypass this deliberately. */
  const autoSpeakRef = useRef(autoSpeak);
  autoSpeakRef.current = autoSpeak;
  /** True while the utterance currently starting is the thinking cue, so
   *  the "turn" metric keeps measuring time-to-*answer* rather than
   *  time-to-acknowledgement (which would flatter the number). */
  const speakingAckRef = useRef(false);
  const speakAuto = useCallback(
    (text: string, opts?: { ack?: boolean }) => {
      if (!autoSpeakRef.current || !hasSeenGesture()) return;
      speakCalledAtRef.current = performance.now();
      speakingAckRef.current = opts?.ack === true;
      speak(text);
    },
    [speak]
  );

  // speak() resolves asynchronously inside the speech engine, so
  // "how long until the kid actually hears something" is only knowable by
  // watching the speaking flag flip. Measured here rather than by
  // changing useSpeech's shared signature.
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

  // Base semantic pose — the trigger table (brief Section 3.4), independent
  // of the talk-mouth alternation layered on top by useTalkingPose.
  const [basePose, setBasePose] = useState<CharacterPose>("hello");
  const pose = useTalkingPose(speaking, basePose);
  const { celebrate } = useCelebration(setBasePose);

  async function loadNextExercise() {
    setLoadingExercise(true);
    setEvaluation(null);
    setAnswer("");
    setNoMatch(false);
    setBasePose("idle");
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_exercise", subject, grade, kidId, topic: topicId }),
      });
      const data = await res.json();
      setExercise(data.exercise ?? null);
    } catch {
      setExercise(null);
    } finally {
      setLoadingExercise(false);
    }
  }

  useEffect(() => {
    loadNextExercise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, grade]);

  // New exercise arrived → explaining pose + auto-read, per the trigger
  // table. Gated on hasSeenGesture() (lib/speech/useSpeech.ts) — an
  // exercise that loads before the kid's first tap must not try to speak.
  useEffect(() => {
    if (!exercise) return;
    setBasePose("explaining");
    speakAuto(exercise.passage ? `${exercise.passage} ${exercise.question}` : exercise.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise]);

  async function submitAnswer(value: string, opts?: { viaVoice?: boolean }) {
    if (!exercise || !value.trim() || submitting) return;
    setSubmitting(true);
    setBasePose("thinking");
    // Voice turns get an immediate audible acknowledgement so the ~2.5s
    // evaluation isn't dead silence — see THINKING_CUE.
    if (opts?.viaVoice) speakAuto(THINKING_CUE[character], { ack: true });
    const evaluateStartedAt = performance.now();
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer_exercise", exercise, answer: value, kidId }),
      });
      const data = await res.json();
      recordTiming("evaluate", performance.now() - evaluateStartedAt);
      const result: ExerciseEvaluation = data.evaluation ?? { correct: false, feedback: "משהו השתבש, נסה/י שוב." };
      setEvaluation(result);
      if (result.correct) {
        celebrate(1, bubbleRef.current);
      } else {
        setBasePose("encouraging");
      }
      speakAuto(result.feedback);
    } catch {
      setEvaluation({ correct: false, feedback: "משהו השתבש, נסה/י שוב." });
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
    speakAuto(NOT_HEARD_PROMPT);
  }, [speakAuto]);

  /**
   * Spoken answer -> exercise answer.
   *
   * Replaces the original exact-string comparison, which effectively
   * never matched real speech: a kid answering a pick_operation exercise
   * says "שמונה פחות שלוש" while the choice reads "8 - 3", and a kid
   * answering a comprehension question says "פחד" while the choice reads
   * "פחד והיה מופתע". Both were correct and both failed. See
   * lib/voice/matchAnswer.ts for the normalization/matching rules.
   *
   * Ambiguous or unmatched input asks the kid to repeat rather than
   * guessing — submitting a wrong answer on the tutor's behalf would get
   * a child marked wrong for the recognizer's mistake, which is exactly
   * the failure the roadmap's re-ask path exists to prevent.
   *
   * tile_order and grouping stay tap-only by design: they're spatial
   * arrangement tasks with no natural spoken form. Tap remains fully
   * functional for every type, voice included (locked guardrail).
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
      // and the kid confirms. Open answers have no option set to
      // validate against, so silently submitting a mis-heard sentence
      // would be the same "marked wrong for the recognizer's mistake"
      // failure, just without a way to detect it.
      setAnswer(transcript);
      setNoMatch(false);
      turnStartedAtRef.current = null;
      return;
    }

    askToRepeat();
  }

  const sessionTargetReached = Date.now() - sessionStartedAt >= SESSION_TARGET_MS;

  if (loadingExercise && !exercise) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 py-16">
        <Character character={character} pose="idle" size={140} />
        <p className="text-[var(--color-ink-soft)]">בונה תרגיל...</p>
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 py-16 text-center px-8">
        <Character character={character} pose="thinking" size={140} />
        <p className="text-[var(--color-ink-soft)]">אין עדיין תוכן לימודי לצירוף הזה, נסה/י כיתה או נושא אחר.</p>
        <button onClick={onBackToMap} className="px-5 py-3 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white">
          חזרה למפה
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 px-4 pb-4">
      <div className="flex justify-between items-center pt-2 pb-1">
        <button onClick={onBackToMap} className="text-sm text-[var(--color-ink-soft)]">
          ← חזרה למפה
        </button>
        {/* Mute toggle for auto-speech (ROADMAP.md Phase 1A). Only gates
            automatic reading — the 🔊 inside a bubble is an explicit
            request and still speaks. Hidden entirely when the device has
            no Hebrew voice, same rule useSpeech applies to SpeakButton. */}
        {speechSupported && (
          <button
            onClick={() => setAutoSpeak(!autoSpeak)}
            aria-label={autoSpeak ? "כיבוי הקראה אוטומטית" : "הפעלת הקראה אוטומטית"}
            title={autoSpeak ? "כיבוי הקראה אוטומטית" : "הפעלת הקראה אוטומטית"}
            className="w-11 h-11 rounded-full flex items-center justify-center text-xl bg-[var(--color-surface)] shadow-sm"
          >
            {autoSpeak ? "🔊" : "🔇"}
          </button>
        )}
      </div>

      <div className="flex items-end justify-between gap-2 mb-2">
        <Character character={character} pose={pose} size={190} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={exercise.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col gap-3"
        >
          {exercise.passage && <SpeechBubble text={exercise.passage} variant="passage" />}

          <div ref={bubbleRef}>
            <SpeechBubble text={submitting ? "..." : exercise.question} />
          </div>

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

          {!evaluation && (
            <div className="flex justify-center mt-2">
              <MicButton
                onResult={handleVoiceResult}
                onNothingHeard={askToRepeat}
                onListeningChange={(isListening) => {
                  setListening(isListening);
                  // Turn clock starts when the kid stops talking — that's
                  // the moment they begin waiting on the character.
                  if (!isListening) turnStartedAtRef.current = performance.now();
                  if (isListening) setNoMatch(false);
                }}
                busyPhase={submitting ? "thinking" : speaking ? "speaking" : null}
                disabled={submitting}
              />
            </div>
          )}

          {noMatch && !listening && (
            <p className="text-center text-sm text-[var(--color-ink-soft)]">
              {NOT_HEARD_PROMPT} אפשר גם ללחוץ על תשובה 👆
            </p>
          )}

          {evaluation && (
            <div
              className={`rounded-[var(--radius-bubble)] px-5 py-4 border-2 mt-1 ${
                evaluation.correct
                  ? "bg-[var(--color-success-soft)] border-[var(--color-success)]"
                  : "bg-[var(--color-warm-soft)] border-[var(--color-warm)]"
              }`}
            >
              <p className="text-[var(--color-ink)] text-lg">{evaluation.feedback}</p>
            </div>
          )}

          {evaluation && !evaluation.correct && (
            <button
              onClick={() => { setEvaluation(null); setBasePose("explaining"); }}
              className="self-center min-h-12 px-6 rounded-[var(--radius-button)] bg-[var(--color-surface)] border-2 border-[var(--color-warm)]/40 text-[var(--color-ink)]"
            >
              לנסות שוב
            </button>
          )}

          {evaluation && evaluation.correct && (
            <>
              {!sessionCloseShown && sessionTargetReached && (
                <div className="rounded-[var(--radius-bubble)] bg-[var(--color-teal-soft)] px-5 py-4 flex flex-col items-center gap-3 mt-1 text-center">
                  <Character character={character} pose="celebration" size={100} />
                  <p className="text-[var(--color-ink)] font-medium">
                    סיימת בערך 15 דקות של עבודה מצוינת היום! אפשר לעצור כאן, או להמשיך לתרגל עוד קצת. 🎉
                  </p>
                </div>
              )}
              <button
                onClick={() => {
                  if (!sessionCloseShown && sessionTargetReached) {
                    setBasePose("goodbye");
                    celebrate(2, bubbleRef.current);
                    onSessionClose();
                  }
                  loadNextExercise();
                }}
                className="self-center min-h-16 px-8 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium mt-1"
              >
                עוד תרגיל!
              </button>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
