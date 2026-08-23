import { NextRequest, NextResponse } from "next/server";
import { generateExercise } from "@/lib/exercises/generate";
import { findReusableExercise, saveExercise } from "@/lib/exercises/store";
import { getKid, getSubjectProfile } from "@/lib/memory/store";
import { Subject } from "@/lib/memory/types";

export const runtime = "nodejs";

interface ExerciseRequestBody {
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  kidId?: string;
}

export async function POST(req: NextRequest) {
  const { subject, grade, kidId } = (await req.json()) as ExerciseRequestBody;

  if (!subject || !grade) {
    return NextResponse.json({ error: "subject and grade are required" }, { status: 400 });
  }

  const kid = kidId ? await getKid(kidId) : null;

  try {
    // Check the shared bank first — reuse costs nothing, a fresh LLM call
    // does. Per Asaf's own framing: pay the generation cost once, amortize
    // it across every kid who sees the exercise afterward.
    const reused = await findReusableExercise(subject, grade, kid?.id ?? null);
    if (reused) {
      return NextResponse.json({ exercise: reused, reused: true });
    }

    const profile = kid ? await getSubjectProfile(kid.id, subject as Subject) : null;
    const generated = await generateExercise({ subject, grade, profile });
    const saved = await saveExercise(generated);
    return NextResponse.json({ exercise: saved, reused: false });
  } catch (err) {
    console.error("[exercise-generate] error:", err);
    return NextResponse.json({ error: "failed to generate exercise" }, { status: 500 });
  }
}
