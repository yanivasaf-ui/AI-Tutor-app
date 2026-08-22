import { NextRequest, NextResponse } from "next/server";
import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { embedText } from "@/lib/rag/embed";
import { search } from "@/lib/rag/store";
import {
  buildTutorSystemPrompt,
  looksOffCurriculumOrEmotional,
} from "@/lib/prompts/tutor-system-prompt";

export const runtime = "nodejs";

interface ChatRequestBody {
  message: string;
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  history?: { role: "user" | "assistant"; content: string }[];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatRequestBody;
  const { message, subject, grade, history = [] } = body;

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

  const queryEmbedding = await embedText(message);
  const retrieved = search(queryEmbedding, { subject, grade, topK: 4 });

  const systemPrompt = buildTutorSystemPrompt(grade, subject, retrieved);
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

  return NextResponse.json({
    reply: textBlock && textBlock.type === "text" ? textBlock.text : "",
    flaggedForParent: flagged,
    retrievedTopics: retrieved.map((r) => r.topic),
  });
}
