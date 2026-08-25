"use client";

import { useEffect, useState } from "react";
import { AvatarBadge } from "./AvatarPicker";
import NumberLineWidget from "./exercises/NumberLineWidget";
import TileOrderWidget from "./exercises/TileOrderWidget";
import GroupingWidget from "./exercises/GroupingWidget";
import type { AvatarOption } from "@/lib/avatars";
import type { Exercise, ExerciseEvaluation } from "@/lib/exercises/types";

interface Props {
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  kidId: string;
  avatar: AvatarOption | null;
}

/**
 * The core exercise loop: generate a grounded problem, let the kid attempt
 * it, evaluate, show pedagogically-shaped feedback, repeat. This is the
 * mechanism the free-chat mode alone didn't have — see the commit message
 * for why that mattered (placement was locked to be "derived from real
 * exercise performance" with no actual exercises to derive it from).
 */
export default function PracticeMode({ subject, grade, kidId, avatar }: Props) {
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<ExerciseEvaluation | null>(null);
  const [loadingExercise, setLoadingExercise] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function loadNextExercise() {
    setLoadingExercise(true);
    setEvaluation(null);
    setAnswer("");
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_exercise", subject, grade, kidId }),
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

  async function submitAnswer(value: string) {
    if (!exercise || !value.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer_exercise", exercise, answer: value, kidId }),
      });
      const data = await res.json();
      setEvaluation(data.evaluation ?? null);
    } catch {
      setEvaluation({ correct: false, feedback: "משהו השתבש, נסה/י שוב." });
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingExercise) {
    return <div className="text-slate-400 text-sm p-4">בונה תרגיל...</div>;
  }

  if (!exercise) {
    return (
      <div className="text-slate-400 text-sm p-4">
        אין עדיין תוכן לימודי לצירוף הזה, נסה/י כיתה או נושא אחר.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 mb-4 flex flex-col gap-4">
      {exercise.passage && (
        <p className="text-slate-600 text-sm bg-slate-50 rounded-lg p-3 leading-relaxed">
          {exercise.passage}
        </p>
      )}

      <div className="flex items-start gap-2">
        {avatar && <AvatarBadge avatar={avatar} size={28} />}
        <p className="text-slate-800 font-medium">{exercise.question}</p>
      </div>

      {!evaluation && exercise.type === "multiple_choice" && exercise.choices && (
        <div className="flex flex-col gap-2">
          {exercise.choices.map((choice, i) => (
            <button
              key={i}
              onClick={() => submitAnswer(choice)}
              disabled={submitting}
              className="text-right border rounded px-3 py-2 bg-slate-50 hover:bg-blue-50 disabled:opacity-50"
            >
              {choice}
            </button>
          ))}
          {/* The evaluation call is a real LLM round-trip (several seconds) —
              without this, a kid taps an answer and sees nothing happen,
              which reads as broken and invites frantic re-tapping. Found
              by actually clicking through the app, not assumed. */}
          {submitting && (
            <div className="flex items-center gap-2 text-sm text-slate-500 pt-1">
              <span className="inline-block w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
              בודק/ת את התשובה...
            </div>
          )}
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
            className="flex-1 border rounded px-3 py-2"
            disabled={submitting}
          />
          <button
            onClick={() => submitAnswer(answer)}
            disabled={submitting || !answer.trim()}
            className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
          >
            {submitting ? "בודק/ת..." : "שלח"}
          </button>
        </div>
      )}

      {evaluation && (
        <div
          className={`rounded-lg px-3 py-2 ${
            evaluation.correct ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"
          }`}
        >
          <div className="flex items-start gap-2">
            {avatar && <AvatarBadge avatar={avatar} size={24} />}
            <p className="text-slate-700 text-sm">{evaluation.feedback}</p>
          </div>
        </div>
      )}

      {evaluation && !evaluation.correct && (
        <button
          onClick={() => setEvaluation(null)}
          className="self-start text-sm text-blue-600 hover:underline"
        >
          לנסות שוב
        </button>
      )}

      {evaluation && evaluation.correct && (
        <button
          onClick={loadNextExercise}
          className="self-start bg-blue-600 text-white rounded px-4 py-2 text-sm"
        >
          תרגיל הבא ←
        </button>
      )}
    </div>
  );
}
