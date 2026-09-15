import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  audioExtension,
  transcribeHebrew,
  MAX_STT_BYTES,
  MIN_STT_BYTES,
  SttNotConfiguredError,
  SttVendorError,
} from "@/lib/stt/openai";

export const runtime = "nodejs";

/** Vendor budget. Kept under Vercel's default function timeout so a slow
 *  OpenAI call ends as a clean 502 the client can fall back from, not a
 *  platform 504. The client's own upload timeout (lib/stt/provider.ts) is
 *  a little longer than this, for the same reason. */
const VENDOR_TIMEOUT_MS = 8_000;

/**
 * POST /api/stt — a short push-to-talk recording in, Hebrew text out.
 *
 * Its OWN route file, deliberately not another action on /api/tutor: that
 * route shares one Vercel function across all its actions, and a cold
 * start there can end up loading the embedding stack
 * (@huggingface/transformers) — this route must never pay that, since the
 * kid is standing there waiting on the transcript. Costs one more route
 * file against the Hobby plan's 12-function cap (4 route files now).
 *
 * Body: the raw recording (not multipart), with its MediaRecorder MIME type
 * as Content-Type — webm/opus from Chrome, mp4/AAC from iOS Safari.
 * Response: { text, confidence? } — `text` is "" when nothing intelligible
 * was said (the client turns that into the existing "לא שמעתי טוב"
 * re-ask).
 *
 * Signed-in parents only, like /api/tutor's `speak`: every call spends
 * OpenAI credit, and an open endpoint would be a free transcription proxy.
 * Status codes are the client contract (lib/stt/provider.ts): 401/503 turn
 * cloud recognition off for the session, anything else non-2xx falls back
 * for the next press only.
 *
 * Never logs the transcript or the audio — it's a child's voice, and lines
 * are full of the kid's own name.
 */
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type");
  const extension = audioExtension(contentType);
  if (!contentType || !extension) {
    return NextResponse.json({ error: "unsupported_audio_type" }, { status: 415 });
  }

  // Reject oversized uploads from the declared length before reading the
  // body at all; re-check the real length after (a chunked upload has no
  // Content-Length).
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_STT_BYTES) {
    return NextResponse.json({ error: "audio_too_large" }, { status: 413 });
  }
  const audio = await req.arrayBuffer();
  if (audio.byteLength > MAX_STT_BYTES) {
    return NextResponse.json({ error: "audio_too_large" }, { status: 413 });
  }
  if (audio.byteLength < MIN_STT_BYTES) {
    return NextResponse.json({ error: "audio_too_short" }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const transcript = await transcribeHebrew(
      audio,
      extension,
      contentType,
      AbortSignal.any([req.signal, AbortSignal.timeout(VENDOR_TIMEOUT_MS)])
    );
    return NextResponse.json(transcript, {
      headers: {
        // Vendor time on its own, so latency can be split between OpenAI
        // and the network from the browser's devtools alone.
        "Server-Timing": `vendor;dur=${Date.now() - startedAt}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof SttNotConfiguredError) {
      return NextResponse.json({ error: "stt_not_configured" }, { status: 503 });
    }
    console.error(
      "[stt] transcription failed:",
      err instanceof SttVendorError ? err.message : err instanceof Error ? err.name : "unknown error"
    );
    return NextResponse.json({ error: "stt_failed" }, { status: 502 });
  }
}
