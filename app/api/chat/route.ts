import { NextRequest, NextResponse } from "next/server";
import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { embedText } from "@/lib/rag/embed";
import { search } from "@/lib/rag/store";
import {
  buildTutorSystemPrompt,
  looksOffCurriculumOrEmotional,
} from "@/lib/prompts/tutor-system-prompt";
import { getKid, getSubjectProfile, updateSubjectProfile } from "@/lib/memory/store";
import { updateSubjectProfileFromExchange } from "@/lib/memory/update";
import { Subject } from "@/lib/memory/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ChatRequestBody {
  message: string;
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  history?: { role: "user" | "assistant"; content: string }[];
  /** Optional: when provided, wires in the persistent per-kid, per-subject
   *  memory layer (load before replying, update after replying). Omitting
   *  it keeps the endpoint working exactly as before (no kid selected). */
  kidId?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatRequestBody;
  const { message, subject, grade, history = [], kidId } = body;

  if (!message || !subject || !grade) {
    return NextResponse.json(
      { error: "message, subject, and grade are required" },
      { status: 400 }
    );
  }

  const flagged = looksOffCurriculumOrEmotional(message);
  if (flagged) {
    // Parent-dashboard flagging is not built yet — this is the hook point
    // per the locked "gentle redirect + flag to parent" decision.
    console.log(`[flag-for-parent] grade=${grade} subject=${subject} message="${message}"`);
  }

  const supabase = await getSupabaseServerClient();
  const kid = kidId ? await getKid(supabase, kidId) : null;
  const subjectProfile = kid ? await getSubjectProfile(supabase, kid.id, subject as Subject) : null;

  const queryEmbedding = await embedText(message);
  const retrieved = search(queryEmbedding, { subject, grade, topK: 4 });

  const systemPrompt = buildTutorSystemPrompt(
    grade,
    subject,
    retrieved,
    subjectProfile,
    kid?.name
  );
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: message },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const reply = textBlock && textBlock.type === "text" ? textBlock.text : "";

  // Fire-and-forget-ish, but awaited so serverless doesn't kill it before it
  // finishes: update the persistent per-kid, per-subject memory profile.
  // Never let a failure here break the reply already computed above.
  if (kid) {
    try {
      const patch = await updateSubjectProfileFromExchange(
        subjectProfile ?? {
          estimatedLevel: "",
          topicsCovered: [],
          errorPatterns: [],
          emotionalSignals: [],
          recentSummary: "",
          sessionCount: 0,
          lastUpdated: new Date().toISOString(),
        },
        {
          grade,
          subject,
          kidName: kid.name,
          userMessage: message,
          tutorReply: reply,
        }
      );
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
