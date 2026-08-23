import { NextRequest, NextResponse } from "next/server";
import { evaluateExerciseAnswer } from "@/lib/exercises/evaluate";
import { Exercise } from "@/lib/exercises/types";
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

  const kid = kidId ? getKid(kidId) : null;
  if (kid) {
    const current =
      getSubjectProfile(kid.id, exercise.subject as Subject) ?? emptySubjectProfile();
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
        updateSubjectProfile(kid.id, exercise.subject as Subject, patch);
      }
    } catch (err) {
      console.error("[exercise-answer] memory update failed:", err);
    }
  }

  return NextResponse.json({ evaluation });
}
