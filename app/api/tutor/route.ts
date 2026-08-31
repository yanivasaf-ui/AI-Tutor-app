import { NextRequest, NextResponse } from "next/server";
import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { embedText } from "@/lib/rag/embed";
import { search } from "@/lib/rag/store";
import {
  buildTutorSystemPrompt,
  looksOffCurriculumOrEmotional,
} from "@/lib/prompts/tutor-system-prompt";
import { generateExercise } from "@/lib/exercises/generate";
import { evaluateExerciseAnswer } from "@/lib/exercises/evaluate";
import { Exercise } from "@/lib/exercises/types";
import { findReusableExercise, saveExercise, recordAttempt } from "@/lib/exercises/store";
import { getKid, getSubjectProfile, updateSubjectProfile } from "@/lib/memory/store";
import { saveParentFlag } from "@/lib/dashboard/store";
import { updateSubjectProfileFromExchange } from "@/lib/memory/update";
import { Subject, emptySubjectProfile } from "@/lib/memory/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Consolidates what used to be /api/chat, /api/exercise, and
 * /api/exercise/answer into one route, dispatched by an `action` field.
 *
 * Why: Vercel's Hobby plan caps a deployment at 12 serverless functions.
 * Next.js compiles each route file into 2 functions (a base handler + an
 * RSC payload function) regardless of route type — 3 separate tutor-related
 * route files cost 6 functions for logic that's really one feature area.
 * One file with an action dispatcher costs 2. No behavior changed for any
 * individual action, only which URL/shape groups them.
 */

type Action = "chat" | "generate_exercise" | "answer_exercise";

interface ChatBody {
  action: "chat";
  message: string;
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  history?: { role: "user" | "assistant"; content: string }[];
  kidId?: string;
}

interface GenerateExerciseBody {
  action: "generate_exercise";
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  kidId?: string;
}

interface AnswerExerciseBody {
  action: "answer_exercise";
  exercise: Exercise;
  answer: string;
  kidId?: string;
}

type RequestBody = ChatBody | GenerateExerciseBody | AnswerExerciseBody;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RequestBody & { action?: Action };

  const supabase = await getSupabaseServerClient();

  switch (body.action) {
    case "chat":
      return handleChat(supabase, body);
    case "generate_exercise":
      return handleGenerateExercise(supabase, body);
    case "answer_exercise":
      return handleAnswerExercise(supabase, body);
    default:
      return NextResponse.json({ error: "unknown or missing action" }, { status: 400 });
  }
}

async function handleChat(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { message, subject, grade, history = [], kidId }: ChatBody
) {
  if (!message || !subject || !grade) {
    return NextResponse.json(
      { error: "message, subject, and grade are required" },
      { status: 400 }
    );
  }

  const flagged = looksOffCurriculumOrEmotional(message);

  // embedText() is the slowest single step here (a local ONNX model
  // inference) and doesn't depend on the kid/profile lookup at all — was
  // previously awaited only after both DB calls finished. Running them
  // concurrently shaves a real round-trip off every chat turn, part of
  // the "make it faster" pass (Asaf, 2026-08-31) — not a behavior change,
  // same three results, just not serialized for no reason.
  const [kid, queryEmbedding] = await Promise.all([
    kidId ? getKid(supabase, kidId) : Promise.resolve(null),
    embedText(message),
  ]);
  const subjectProfile = kid ? await getSubjectProfile(supabase, kid.id, subject as Subject) : null;

  if (flagged && kid) {
    // The "flag to parent" half of the locked "gentle redirect + flag to
    // parent" decision — this used to just console.log; now it's a real
    // row a parent can actually see on the dashboard.
    try {
      await saveParentFlag(supabase, { kidId: kid.id, subject: subject as Subject, grade, message });
    } catch (err) {
      console.error("[flag-for-parent] failed to save flag:", err);
    }
  }

  const retrieved = search(queryEmbedding, { subject, grade, topK: 4 });

  const systemPrompt = buildTutorSystemPrompt(grade, subject, retrieved, subjectProfile, kid?.name);
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    // Was 512, then 260 (model still produced 4+ sentences plus markdown/
    // greeting filler within that budget — the prompt instruction alone
    // wasn't enough, tightened separately), then 150 (tested live: cut a
    // real explanation off mid-sentence — too tight once the greeting/
    // markdown filler was already gone via the prompt fix, since a
    // genuine 2-3 sentence concept explanation needs real room). 200 is
    // the value that held a complete, on-length reply in live testing.
    max_tokens: 200,
    system: systemPrompt,
    messages: [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: message },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const reply = textBlock && textBlock.type === "text" ? textBlock.text : "";

  if (kid) {
    try {
      const patch = await updateSubjectProfileFromExchange(subjectProfile ?? emptySubjectProfile(), {
        grade,
        subject,
        kidName: kid.name,
        userMessage: message,
        tutorReply: reply,
      });
      if (patch) {
        await updateSubjectProfile(supabase, kid.id, subject as Subject, patch);
      }
    } catch (err) {
      console.error("[memory-update] error updating profile after exchange:", err);
    }
  }

  return NextResponse.json({
    reply,
    flaggedForParent: flagged,
    retrievedTopics: retrieved.map((r) => r.topic),
  });
}

async function handleGenerateExercise(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { subject, grade, kidId }: GenerateExerciseBody
) {
  if (!subject || !grade) {
    return NextResponse.json({ error: "subject and grade are required" }, { status: 400 });
  }

  const kid = kidId ? await getKid(supabase, kidId) : null;

  try {
    const reused = await findReusableExercise(supabase, subject, grade, kid?.id ?? null);
    if (reused) {
      return NextResponse.json({ exercise: reused, reused: true });
    }

    const profile = kid ? await getSubjectProfile(supabase, kid.id, subject as Subject) : null;
    const generated = await generateExercise({ subject, grade, profile });
    const saved = await saveExercise(supabase, generated);
    return NextResponse.json({ exercise: saved, reused: false });
  } catch (err) {
    console.error("[exercise-generate] error:", err);
    return NextResponse.json({ error: "failed to generate exercise" }, { status: 500 });
  }
}

async function handleAnswerExercise(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { exercise, answer, kidId }: AnswerExerciseBody
) {
  if (!exercise || !answer) {
    return NextResponse.json({ error: "exercise and answer are required" }, { status: 400 });
  }

  // evaluateExerciseAnswer (the LLM call) and getKid (a DB lookup) don't
  // depend on each other — was previously two sequential awaits, meaning
  // the kid lookup didn't even start until the several-second LLM call
  // finished. Running them concurrently, with the same error handling
  // and early-return behavior as before, just not serialized for no
  // reason. Part of the "make it faster" pass (Asaf, 2026-08-31).
  const [evaluationOutcome, kid] = await Promise.all([
    evaluateExerciseAnswer(exercise, answer).then(
      (value) => ({ ok: true as const, value }),
      (err) => ({ ok: false as const, err })
    ),
    kidId ? getKid(supabase, kidId) : Promise.resolve(null),
  ]);

  if (!evaluationOutcome.ok) {
    console.error("[exercise-evaluate] error:", evaluationOutcome.err);
    return NextResponse.json({ error: "failed to evaluate answer" }, { status: 500 });
  }
  const evaluation = evaluationOutcome.value;

  if (kid) {
    // recordAttempt (the attempt log) and getSubjectProfile (needed for
    // the memory-layer update below) are also independent of each other
    // — same parallelization reasoning as above.
    const [, current] = await Promise.all([
      recordAttempt(supabase, {
        kidId: kid.id,
        exerciseId: exercise.id,
        subject: exercise.subject,
        correct: evaluation.correct,
        errorNote: evaluation.errorNote,
        kidAnswer: answer,
        correctAnswer: exercise.correctAnswer,
      }).catch((err) => {
        console.error("[exercise-answer] attempt logging failed:", err);
      }),
      getSubjectProfile(supabase, kid.id, exercise.subject as Subject),
    ]);
    const profileBase = current ?? emptySubjectProfile();
    try {
      const patch = await updateSubjectProfileFromExchange(profileBase, {
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
        await updateSubjectProfile(supabase, kid.id, exercise.subject as Subject, patch);
      }
    } catch (err) {
      console.error("[exercise-answer] memory update failed:", err);
    }
  }

  return NextResponse.json({ evaluation });
}
