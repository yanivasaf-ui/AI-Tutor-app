import { NextRequest, NextResponse } from "next/server";
import { generateExercise } from "@/lib/exercises/generate";
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

  const kid = kidId ? getKid(kidId) : null;
  const profile = kid ? getSubjectProfile(kid.id, subject as Subject) : null;

  try {
    const exercise = await generateExercise({ subject, grade, profile });
    return NextResponse.json({ exercise });
  } catch (err) {
    console.error("[exercise-generate] error:", err);
    return NextResponse.json({ error: "failed to generate exercise" }, { status: 500 });
  }
}
