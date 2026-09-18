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
import { speak, stopSpeaking, useSpeech, hasSeenGesture, prefetchSpeech } from "@/lib/speech/useSpeech";
import { isAutoSpeakOn } from "@/lib/speech/autoSpeak";
import { useCelebration } from "@/lib/celebration/useCelebration";
import { useTalkingPose, type CharacterId, type CharacterPose } from "@/lib/characters";
import * as lines from "@/lib/guide/lines";
import { OPENERS } from "@/lib/exercises/openers";
import type { Line } from "@/lib/guide/lines";
import { matchChoice, matchNumberLine } from "@/lib/voice/matchAnswer";
import { clearEndOfSpeech, msSinceEndOfSpeech, recordTiming } from "@/lib/voice/timing";
import { getTopicById } from "@/lib/map/topics";
import { SUBJECT_THEME } from "@/lib/theme/subjectTheme";
import type { Exercise, ExerciseEvaluation } from "@/lib/exercises/types";
import type { PracticeMode, PracticeSummary } from "@/lib/practice/state";
import type { KidGender } from "@/lib/memory/types";

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
  /** Voice-experience fix item 4 (2026-09-15): reaches the server so
   *  LLM-generated exercise feedback (lib/exercises/evaluate.ts) can
   *  address the kid in their own grammatical gender. Null/omitted falls
   *  back to the pre-existing neutral phrasing. */
  kidGender?: KidGender | null;
  character: CharacterId;
  /** Owned by the parent, not here, so switching subject/grade mid-session
   *  doesn't reset the clock (project-brief.md Section 2d-2: ~15 min/day,
   *  one daily session regardless of what's practiced within it). Same
   *  contract as the original PracticeMode.tsx. */
  sessionStartedAt: number;
  sessionCloseShown: boolean;
  onSessionClose: () => void;
  onBackToMap: () => void;
  /** Voice-experience fix item 6 (2026-09-15): a real exit all the way to
   *  ModeChoice, distinct from onBackToMap (which only returns to the map
   *  or topic list this exercise was opened from). Offered from the
   *  correct-answer burst and the topic-complete milestone, alongside
   *  their existing "keep going" action. */
  onGoHome: () => void;
  /** Where this exercise was started from. "journey" answers can complete
   *  the map stop; "free" answers never touch map progress — the server
   *  enforces it (lib/practice/state.ts recordAnswer). */
  mode?: PracticeMode;
  /** The back button's words — the map, or the free-practice list. */
  backLabel?: string;
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
 *
 * Adaptive levels (lib/practice/state.ts): every answer goes to the
 * server with its topic, mode and attempt number, and comes back with the
 * kid's level on this topic (the stars in the top bar). A wrong first
 * answer gets a hint and "לנסות שוב"; a wrong second answer on the same
 * question gets the full explanation and "לתרגיל הבא", whose exercise is
 * built a level lower.
 */
export default function ExerciseScreen({
  subject,
  grade,
  topicId,
  topicWasDone,
  kidId,
  kidName,
  kidGender,
  character,
  sessionStartedAt,
  sessionCloseShown,
  onSessionClose,
  onBackToMap,
  onGoHome,
  mode = "journey",
  backLabel = "חזרה למפה",
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
  /** Voice-experience fix item 6: the top bar's back arrow used to leave
   *  the exercise the instant it was tapped — one stray tap mid-question
   *  and the kid lost their place with no chance to reconsider. Now it
   *  opens this confirm step instead of calling onBackToMap directly. */
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  /** 1 on a fresh question, 2 on the retry after a hint. */
  const [attempt, setAttempt] = useState<1 | 2>(1);
  /** The last evaluation is the "something broke" stand-in, not a real
   *  judgement — a retry after it doesn't use up the kid's second try. */
  const [evalFailed, setEvalFailed] = useState(false);
  /** The kid's level on this topic, from the server. Null until known,
   *  and while the first-visit diagnostic is still placing them. */
  const [practice, setPractice] = useState<PracticeSummary | null>(null);
  /** Bumped when the level changes, to replay the stars' pop. */
  const [levelBump, setLevelBump] = useState(0);
  /** Set once this visit's topic has been celebrated (or was already done
   *  before we got here) — a topic completes once. */
  const topicDoneRef = useRef(topicWasDone !== false);
  /** Kid-scene reskin (2026-09-15): how many exercises this topic visit
   *  has gone through, and how many were right first try — purely local,
   *  visual-only counters (not sent to the server, not read from it) for
   *  the exercise screen's progress strip and the milestone's "concrete
   *  earned-progress copy" (reskin brief items 4 and 5). Reset whenever
   *  the topic changes, same as loadNextExercise's own effect below. */
  const topicStatsRef = useRef({ attempted: 0, correct: 0 });
  const [progressTick, setProgressTick] = useState(0); // bumps to re-render on ref changes
  const theme = SUBJECT_THEME[subject];
  const topicLabel = topicId ? getTopicById(topicId)?.displayNameKid : undefined;

  const { speaking } = useSpeech(OWNER);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Latency instrumentation (ROADMAP.md's ~2s budget). turnStartedAt is
  // set when the kid releases the mic and cleared once the character
  // starts speaking the reply, so "turn" measures the full voice-in ->
  // voice-out span the kid actually experiences.
  const turnStartedAtRef = useRef<number | null>(null);
  /** feat: verdict-first evaluation — the opener -> prose chain. `gen`
   *  invalidates a chain whose turn has moved on (a new answer, a
   *  barge-in, leaving the screen), so a late prose line can never talk
   *  over the next question. */
  const proseGenRef = useRef(0);
  const openerDoneRef = useRef(false);
  const pendingProseRef = useRef<string | null>(null);
  const speakCalledAtRef = useRef<number | null>(null);

  /** True while the utterance currently starting is the thinking cue, so
   *  the "turn" metric keeps measuring time-to-*answer* rather than
   *  time-to-acknowledgement (which would flatter the number). */
  const speakingAckRef = useRef(false);

  /** Voice-experience fix item 3: bumped on every new exercise so an
   *  in-flight answer-readout chain (question -> choice 1 -> choice 2...)
   *  can tell it's been superseded and stop recursing into a question
   *  that's no longer on screen. */
  const readoutGenRef = useRef(0);

  /** Automatic speech: gated on the device mute AND the iOS gesture rule.
   *  Explicit 🔊 taps inside a bubble bypass this deliberately. `onEnd`
   *  (voice-experience fix item 3) chains the grades-א/ב answer readout
   *  onto the moment this specific utterance finishes. */
  const speakAuto = useCallback(
    (text: string, opts?: { ack?: boolean; onEnd?: () => void; live?: boolean }) => {
      if (!isAutoSpeakOn() || !hasSeenGesture()) return;
      speakCalledAtRef.current = performance.now();
      speakingAckRef.current = opts?.ack === true;
      speak(text, OWNER, character, { onEnd: opts?.onEnd, live: opts?.live });
    },
    [character]
  );

  // Leaving mid-sentence (back to map) must not keep talking over the map.
  useEffect(() => () => {
    stopSpeaking(OWNER);
    readoutGenRef.current++;
    proseGenRef.current++;
  }, []);

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
        // The headline number: end-of-speech -> first audible word of the
        // real reply. Measured from the mic RELEASE rather than the press,
        // so it doesn't include however long the child chose to talk.
        const sinceEnd = msSinceEndOfSpeech();
        if (sinceEnd !== null) {
          recordTiming("reply", sinceEnd);
          clearEndOfSpeech();
        }
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

  /** Voice-experience fix item 3 (2026-09-15): grades א/ב, after the
   *  question, hear every multiple-choice option read in order with a
   *  short pause between — a pre-reader can't otherwise know what the
   *  choices even say. Grade ג+ gets no automatic readout; each option
   *  gets a tap-to-hear speaker icon instead (rendered below, near the
   *  choice buttons). `gen` is this call's generation stamp
   *  (readoutGenRef) — every step checks it's still current before
   *  speaking or scheduling the next one, so a new exercise, a retry, or
   *  this screen unmounting silently drops the rest of an in-flight
   *  readout instead of talking over whatever replaced it. */
  const READOUT_PAUSE_MS = 450;
  function readChoicesInOrder(choices: string[], gen: number, i = 0) {
    if (readoutGenRef.current !== gen || i >= choices.length) return;
    setTimeout(() => {
      if (readoutGenRef.current !== gen) return;
      speak(choices[i], OWNER, character, { onEnd: () => readChoicesInOrder(choices, gen, i + 1) });
    }, READOUT_PAUSE_MS);
  }

  function speakQuestionAndMaybeReadout(ex: Exercise) {
    const gen = ++readoutGenRef.current;
    const autoRead = (grade === "א" || grade === "ב") && ex.type === "multiple_choice" && !!ex.choices?.length;
    speakAuto(questionSpeech(ex), autoRead ? { onEnd: () => readChoicesInOrder(ex.choices!, gen) } : undefined);
  }

  async function loadNextExercise() {
    setLoadingExercise(true);
    setEvaluation(null);
    setAnswer("");
    setNoMatch(false);
    setTopicCelebration(false);
    setBasePose("thinking");
    setLoadFailed(false);
    setAttempt(1);
    setEvalFailed(false);
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_exercise", subject, grade, kidId, topic: topicId }),
      });
      // A body that isn't JSON (a platform error page, a cut-off response)
      // is a failure, not an empty topic.
      const data = (await res.json().catch(() => null)) as {
        exercise?: Exercise | null;
        error?: string;
        practice?: PracticeSummary;
      } | null;
      if (res.ok && data?.exercise) {
        setExercise(data.exercise);
        setPractice((p) => data.practice ?? (p && { ...p, change: null }));
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
    topicStatsRef.current = { attempted: 0, correct: 0 };
    loadNextExercise();
    // Voice-experience fix item 1: "רגע, אני חושב/ת" and "רגע, אני מכין/ה
    // לנו תרגיל" are said on every single answer and every single new
    // exercise — the two most frequent lines on this whole screen, and
    // both fully known the moment the screen opens (character + kidName,
    // nothing else). Warmed here so by the time either is actually
    // needed, speak() finds it already cached instead of paying
    // Cartesia's round trip live, right in the middle of the loop the
    // founder reported as slow.
    // Keyed on spoken(), not .text: speak() (via useGuide/speakAuto, below
    // and at line ~598) always reads the "name, text" spoken form, which
    // differs from .text alone for every line with a `name` set — both of
    // these carry one. Prefetching under the wrong key left the cache
    // permanently missed: paid for on every load, never actually hit.
    prefetchSpeech(lines.spoken(lines.thinking(character, kidName)), character);
    prefetchSpeech(lines.spoken(lines.buildingExercise(character, kidName)), character);
    // feat: verdict-first evaluation — the three deterministic openers.
    // Exactly one of them is said on every single answer, and they never
    // vary, so warming all three here is what makes the opener audible at
    // verdict-lock instead of a Cartesia round trip later. Prefetched
    // lines are fully vocalized server-side (lib/tts/cartesia.ts).
    for (const opener of Object.values(OPENERS)) {
      prefetchSpeech(lines.spoken(lines.feedback(kidName, opener)), character);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, grade, topicId]);

  // New exercise arrived → explaining pose + read aloud. Gated on
  // hasSeenGesture() — an exercise that loads before the kid's first tap
  // must not try to speak.
  useEffect(() => {
    if (!exercise) return;
    setBasePose("explaining");
    speakQuestionAndMaybeReadout(exercise);
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

  /**
   * feat: verdict-first evaluation. The answer comes back as two NDJSON
   * lines instead of one JSON body:
   *
   *   1. the verdict + the deterministic opener — sent the moment the
   *      verdict is locked, which on a computation exercise is code only,
   *      no model call. The character starts talking here.
   *   2. the model's prose, already gated whole by lineIsArithmeticallySafe,
   *      plus the level this answer moved.
   *
   * Nothing is spoken before line 1, and the opener is chosen from the
   * locked verdict, so the character cannot praise an answer the code
   * marked wrong. The prose follows the opener gaplessly — queued on the
   * opener's own onEnd rather than a timer.
   */
  async function submitAnswer(value: string, opts?: { viaVoice?: boolean }) {
    if (!exercise || !value.trim() || submitting) return;
    setSubmitting(true);
    setNoMatch(false);
    setBasePose("thinking");
    // Voice turns get an immediate audible acknowledgement so the
    // evaluation isn't dead silence. A kid who tapped is watching the
    // screen and sees the thinking pose; a kid who spoke may not be
    // looking, and silence reads as "it didn't hear me" -> they repeat
    // themselves over the pending turn. Voice turns only: on tap answers
    // it would be chatter on top of a visual signal they already have.
    if (opts?.viaVoice) speakAuto(lines.spoken(lines.thinking(character, kidName)), { ack: true });
    const evaluateStartedAt = performance.now();
    // Guards the opener -> prose chain against a turn that has moved on
    // (a new answer, a barge-in, leaving the screen).
    const gen = ++proseGenRef.current;
    openerDoneRef.current = false;
    pendingProseRef.current = null;
    let opener = "";
    let celebrated = false;
    let sawVerdict = false;

    const speakProse = (text: string) => {
      if (gen !== proseGenRef.current || !text) return;
      // Raw text, no name prefix: the opener already addressed the kid.
      // `live` marks it as model-written prose, which per the niqqud
      // ruling is spoken unvocalized.
      speakAuto(text, { live: true });
    };

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "answer_exercise",
          exercise,
          answer: value,
          kidId,
          kidGender,
          topicId,
          mode,
          attempt,
          // feat: kid session memory — groups this answer's facts with the
          // rest of today's. sessionStartedAt is already the app's notion
          // of "one session" (owned by KidHome, survives topic switches).
          sessionId: String(sessionStartedAt),
        }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffered += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, nl).trim();
          buffered = buffered.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as {
            type: "verdict" | "prose";
            correct?: boolean;
            opener?: string;
            feedback?: string;
            practice?: PracticeSummary;
          };

          if (msg.type === "verdict") {
            sawVerdict = true;
            recordTiming("evaluate", performance.now() - evaluateStartedAt);
            const sinceEnd = msSinceEndOfSpeech();
            if (sinceEnd !== null) recordTiming("verdict", sinceEnd);
            opener = msg.opener ?? "";
            const correct = msg.correct === true;
            setEvalFailed(false);
            setEvaluation({ correct, feedback: opener });
            // Kid-scene reskin: count DISTINCT exercises, not submissions —
            // a retry (attempt 2) is still the same exercise, so only a
            // fresh question (attempt 1) advances "attempted"; "correct"
            // advances on whichever attempt actually lands it.
            if (attempt === 1) topicStatsRef.current.attempted++;
            if (correct) topicStatsRef.current.correct++;
            setProgressTick((n) => n + 1);

            if (correct) {
              // Tier-2 moments take the whole screen and say their own
              // line; everything else is the tier-1 burst from the bubble.
              const sessionMoment = !sessionCloseShown && Date.now() - sessionStartedAt >= SESSION_TARGET_MS;
              const topicMoment = !!topicId && !topicDoneRef.current;
              if (topicMoment) topicDoneRef.current = true;
              if (sessionMoment || topicMoment) {
                setBasePose("correct");
                if (!sessionMoment) setTopicCelebration(true);
                celebrated = true;
              } else {
                celebrate(1, bubbleRef.current);
              }
            } else {
              setBasePose("encouraging");
            }

            // The opener is a scripted line and prefetched, so this is
            // usually a cache hit and audible immediately.
            if (!celebrated && opener) {
              speakAuto(lines.spoken(lines.feedback(kidName, opener)), {
                onEnd: () => {
                  if (gen !== proseGenRef.current) return;
                  openerDoneRef.current = true;
                  const pending = pendingProseRef.current;
                  pendingProseRef.current = null;
                  if (pending) speakProse(pending);
                },
              });
            }
          } else if (msg.type === "prose") {
            recordTiming("prose-ready", performance.now() - evaluateStartedAt);
            if (msg.practice) {
              setPractice(msg.practice);
              if (msg.practice.change) setLevelBump((n) => n + 1);
            }
            const prose = msg.feedback ?? "";
            if (prose) {
              setEvaluation((prev) => ({
                correct: prev?.correct ?? false,
                feedback: `${opener} ${prose}`.trim(),
              }));
            }
            if (!celebrated && prose) {
              // If the opener has already finished, say it now; otherwise
              // its onEnd above picks this up the instant it does.
              if (openerDoneRef.current) speakProse(prose);
              else pendingProseRef.current = prose;
            }
          }
        }
      }
      if (!sawVerdict) throw new Error("no verdict in stream");
    } catch {
      setEvalFailed(true);
      setEvaluation({ correct: false, feedback: lines.somethingBroke(kidName).text });
      setBasePose("encouraging");
      speakAuto(lines.spoken(lines.somethingBroke(kidName)));
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

  // Kid-scene reskin (2026-09-15): topic name + a segmented progress
  // strip (reskin brief item 4) — capped visually at 5 segments per
  // topic visit, filling as topicStatsRef's local, visual-only counter
  // advances (a 6th+ exercise just keeps the strip full rather than
  // rolling over — there's no fixed "session length" in the adaptive
  // model to size it exactly against). key={progressTick} so the strip
  // actually re-renders when the ref it reads updates.
  const PROGRESS_SEGMENTS = 5;
  const filledSegments = Math.min(topicStatsRef.current.attempted, PROGRESS_SEGMENTS);
  const topBar = (
    <div className="pt-2 pb-1">
      <div className="flex justify-between items-center">
        <button onClick={() => setConfirmingLeave(true)} className="min-h-11 px-1 text-sm text-white/80">
          ← {backLabel}
        </button>
        <div className="flex items-center gap-3">
          {practice?.level && <LevelStars level={practice.level} bump={levelBump} />}
          <MuteToggle />
        </div>
      </div>
      {topicLabel && (
        <div className="mt-1.5">
          <p className="display text-center text-white text-base mb-1.5">{topicLabel}</p>
          <div key={progressTick} className="flex gap-1.5">
            {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
              <div
                key={i}
                className={`flex-1 h-2 rounded-full ${i < filledSegments ? "bg-white" : "bg-white/35"}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // Building an exercise — first load or the next one. The character
  // thinks; the old question is gone, so it can't be answered while its
  // replacement is on the way.
  // Kid-scene reskin: the per-subject saturated stage (item 4 of the
  // brief) behind every branch of this screen — loading and error states
  // included, so the backdrop doesn't flash to plain cream between them.
  const stageStyle = { background: `linear-gradient(180deg, ${theme.bg} 0%, ${theme.accent} 40%, ${theme.accent} 100%)` };

  if (loadingExercise || (!exercise && !loadedOnce)) {
    const l = lines.buildingExercise(character, kidName);
    return (
      <div className="flex flex-col flex-1 px-4 pb-4" style={stageStyle}>
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
      <div className="flex flex-col flex-1 px-4 pb-4" style={stageStyle}>
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
            {backLabel}
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
  // Second miss on the same question: the feedback is the full
  // explanation, and the way on is a new (easier) exercise, not a retry.
  const finalMiss = !!evaluation && !evaluation.correct && attempt === 2 && !evalFailed;

  return (
    <div className="flex flex-col flex-1 px-4 pb-4" style={stageStyle}>
      {topBar}

      <div className="flex justify-center">
        <Character character={character} pose={pose} size={exercise.passage ? 150 : 180} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={exercise.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
          // Kid-scene reskin: prompt + answer + mic, one large play card
          // (reskin brief item 4) — was loose stacked elements directly
          // on the screen's own background; every conditional block below
          // (choices, the number-line/tile-order/grouping widgets, the
          // open-answer input, the mic, the retry/next buttons) is
          // unchanged, only this wrapper's own styling changed.
          className="flex flex-col gap-3 mt-2 bg-[var(--color-surface)] rounded-[var(--radius-stage)] shadow-lg p-4"
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
                  className="min-h-16 rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/30 bg-[var(--color-surface)] text-2xl font-medium text-[var(--color-ink)] px-5 disabled:opacity-50 flex items-center justify-center gap-2 relative"
                  dir={/^[\d+\-*/=.,\s]+$/.test(choice) ? "ltr" : undefined}
                >
                  {/* Voice-experience fix item 3: grade ג+ gets no automatic
                      answer readout (grades א/ב do, right after the
                      question — see speakQuestionAndMaybeReadout above) —
                      tap this to hear just this one option instead. */}
                  {grade === "ג" && (
                    <span
                      role="button"
                      aria-label={`הקראת התשובה ${choice}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        speak(choice, OWNER, character);
                      }}
                      className="absolute start-3 w-8 h-8 rounded-full bg-[var(--color-teal)]/10 flex items-center justify-center text-base shrink-0"
                    >
                      🔊
                    </span>
                  )}
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
            <div className="flex items-center justify-center gap-3 mt-2 pt-3 border-t border-dashed" style={{ borderColor: theme.soft }}>
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
              {/* Kid-scene reskin: labeled, attached to the play card
                  (reskin brief item 4) — was an unlabeled floating icon. */}
              <span className="text-sm font-bold text-[var(--color-ink-soft)] max-w-40">
                אפשר גם ללחוץ כאן ולומר את התשובה
              </span>
            </div>
          )}

          {evaluation && !evaluation.correct && !finalMiss && (
            <button
              onClick={() => {
                if (!evalFailed) setAttempt(2);
                setEvaluation(null);
                setBasePose("explaining");
                speakQuestionAndMaybeReadout(exercise);
              }}
              className="self-center min-h-14 px-8 rounded-[var(--radius-button)] bg-[var(--color-surface)] border-2 border-[var(--color-warm)]/40 text-lg text-[var(--color-ink)]"
            >
              לנסות שוב
            </button>
          )}

          {finalMiss && (
            <button
              onClick={() => loadNextExercise()}
              className="self-center min-h-16 px-8 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium mt-1"
            >
              לתרגיל הבא
            </button>
          )}

          {evaluation && practice?.change === "up" && (
            <motion.p
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="self-center rounded-full bg-[var(--color-teal-soft)] text-[var(--color-teal-ink)] font-bold px-4 py-1"
            >
              עלינו רמה! ⭐
            </motion.p>
          )}

          {evaluation && evaluation.correct && (
            <div className="self-center flex flex-col items-center gap-2 mt-1">
              <button
                onClick={() => loadNextExercise()}
                className="min-h-16 px-8 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium"
              >
                עוד תרגיל!
              </button>
              {/* Voice-experience fix item 6: the burst used to offer only
                  "עוד תרגיל!" — no way home without answering another
                  question first. */}
              <button onClick={onGoHome} className="min-h-11 px-4 text-sm text-[var(--color-ink-soft)] underline">
                חזרה הביתה
              </button>
            </div>
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
                    label: mode === "free" ? "לנושאים" : "למפה",
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
          variant="milestone"
          line={{
            name: kidName,
            // Concrete earned-progress copy (reskin brief item 5) — how
            // many exercises this topic visit actually took and how many
            // landed right, not just a generic "stop finished." Falls
            // back to lines.topicComplete's generic text only if
            // attempted is somehow 0 — shouldn't happen, since a
            // celebration only fires right after a correct submitAnswer,
            // which always increments it first.
            text:
              topicStatsRef.current.attempted > 0
                ? `כל הכבוד! סיימת את כל ${topicStatsRef.current.attempted} התרגילים בנושא${
                    topicLabel ? ` "${topicLabel}"` : ""
                  }. ענית נכון על ${topicStatsRef.current.correct} מתוך ${topicStatsRef.current.attempted}.`
                : lines.topicComplete(kidName).text,
          }}
          actions={[
            { label: "לתחנה הבאה", primary: true, onClick: onBackToMap },
            { label: "עוד תרגול כאן", onClick: () => loadNextExercise() },
            { label: "חזרה הביתה", onClick: onGoHome },
          ]}
        />
      )}

      {/* Voice-experience fix item 6: the back arrow's confirm step —
          discreet trigger (the existing top-bar link), a real pause
          before anything is lost. */}
      {confirmingLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-xs bg-[var(--color-surface)] rounded-[var(--radius-stage)] shadow-lg p-5 flex flex-col items-center gap-4 text-center">
            <p className="text-lg font-bold text-[var(--color-ink)]">לצאת מהתרגיל?</p>
            <p className="text-sm text-[var(--color-ink-soft)]">התרגיל הנוכחי לא יישמר.</p>
            <div className="w-full flex flex-col gap-2">
              <button
                onClick={() => setConfirmingLeave(false)}
                className="min-h-14 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-lg font-medium"
              >
                להישאר
              </button>
              <button
                onClick={onBackToMap}
                className="min-h-12 rounded-[var(--radius-button)] bg-transparent text-[var(--color-ink-soft)] text-base"
              >
                כן, לצאת
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The kid's level on this topic, as stars — no numbers, no words a
 *  pre-reader has to parse. Pops when the level changes. */
function LevelStars({ level, bump }: { level: 1 | 2 | 3; bump: number }) {
  return (
    <motion.span
      key={bump}
      initial={bump > 0 ? { scale: 1.5 } : false}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 12 }}
      role="img"
      aria-label={`רמה ${level} מתוך 3`}
      data-level={level}
      className="text-xl tracking-wide text-[var(--color-teal)]"
      dir="ltr"
    >
      {"★".repeat(level)}
      <span className="text-slate-300">{"☆".repeat(3 - level)}</span>
    </motion.span>
  );
}
