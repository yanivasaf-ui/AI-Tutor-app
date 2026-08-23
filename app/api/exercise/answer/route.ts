import { NextRequest, NextResponse } from "next/server";
import { evaluateExerciseAnswer } from "@/lib/exercises/evaluate";
import { Exercise } from "@/lib/exercises/types";
import { recordAttempt } from "@/lib/exercises/store";
import { getKid, getSubjectProfile, updateSubjectProfile } from "@/lib/memory/store";
import { updateSubjectProfileFromExchange } from "@/lib/memory/update";
import { Subject, emptySubjectProfile } from "@/lib/memory/types";

export const runtime = "nodejs";

interface AnswerRequestBody {
  exercise: Exercise;
  answer: string;
  kidId?: string;
}

export async function POST(req: NextRequest) {
  const { exercise, answer, kidId } = (await req.json()) as AnswerRequestBody;

  if (!exercise || !answer) {
    return NextResponse.json({ error: "exercise and answer are required" }, { status: 400 });
  }

  let evaluation;
  try {
    evaluation = await evaluateExerciseAnswer(exercise, answer);
  } catch (err) {
    console.error("[exercise-evaluate] error:", err);
    return NextResponse.json({ error: "failed to evaluate answer" }, { status: 500 });
  }

  const kid = kidId ? await getKid(kidId) : null;
  if (kid) {
    // The exact, structured per-kid record Asaf asked for — which exercise,
    // which kid, right or wrong — distinct from the free-text profile
    // summary below (that's for in-context LLM pacing judgment; this is
    // for "has this kid seen this exercise, and what's the bank's real
    // success-rate signal on it").
    try {
      await recordAttempt({
        kidId: kid.id,
        exerciseId: exercise.id,
        subject: exercise.subject,
        correct: evaluation.correct,
        errorNote: evaluation.errorNote,
      });
    } catch (err) {
      console.error("[exercise-answer] attempt logging failed:", err);
    }

    const current =
      (await getSubjectProfile(kid.id, exercise.subject as Subject)) ?? emptySubjectProfile();
    try {
      const patch = await updateSubjectProfileFromExchange(current, {
        grade: exercise.grade,
        subject: exercise.subject,
        kidName: kid.name,
        userMessage: `[תרגיל: ${exercise.question}] תשובת התלמיד/ה: ${answer}`,
        tutorReply: evaluation.feedback,
        exercise: {
          topic: exercise.topic,
          correct: evaluation.correct,
          errorNote: evaluation.errorNote,
        },
      });
      if (patch) {
        await updateSubjectProfile(kid.id, exercise.subject as Subject, patch);
      }
    } catch (err) {
      console.error("[exercise-answer] memory update failed:", err);
    }
  }

  return NextResponse.json({ evaluation });
}
