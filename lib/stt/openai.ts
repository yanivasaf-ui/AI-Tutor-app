/**
 * Server-side Hebrew speech-to-text via OpenAI's transcription API — the
 * cloud engine behind /api/stt (lib/stt/provider.ts's cloudSpeechProvider
 * is the client half).
 *
 * Request shape per developers.openai.com/api/docs/guides/speech-to-text,
 * checked 2026-09-13: POST /v1/audio/transcriptions, Bearer auth,
 * multipart/form-data with `file` + `model`. Accepted containers: mp3,
 * mp4, mpeg, mpga, m4a, wav, webm — which covers both things a browser's
 * MediaRecorder produces here (Chrome: webm/opus; iOS Safari: mp4/AAC).
 * NOT ogg: Firefox can record ogg/opus, but the client never asks for it.
 *
 * Model: gpt-4o-mini-transcribe. OpenAI's docs now call gpt-transcribe the
 * recommended default and list gpt-4o-(mini-)transcribe as legacy — picked
 * anyway, deliberately: it's the only current model documented to return
 * per-token `logprobs` (`include[]=logprobs`), which is what turns
 * `confidence` below from a placeholder into a real number (the thing
 * ROADMAP.md's confidence-gated "מה? לא שמעתי" re-ask has been waiting
 * on), it's the faster/cheaper of the two gpt-4o transcribers, and its
 * request fields (`language`, `include[]`) are long-documented — this was
 * written without a local key to test against, so the documented shape
 * mattered. gpt-transcribe is the obvious next A/B once real Hebrew child
 * audio can be compared; swap STT_MODEL, and drop `include[]` / re-check
 * the language field, since its docs don't confirm either.
 *
 * Server-only: reads OPENAI_API_KEY. Never import from client code.
 */
const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";

export const STT_MODEL = "gpt-4o-mini-transcribe";

/**
 * Upload bounds. The client hard-stops recording at 15s and asks
 * MediaRecorder for ~32kbps (≈60KB per 15s); iOS Safari may ignore the
 * bitrate hint and record AAC at up to ~128kbps (≈240KB per 15s). The
 * server can't read an upload's duration without a media-decoding library
 * (and Chrome's webm often carries no duration header at all), so the
 * byte cap is the server-side bound on cost — sized for ~15-20s at the
 * highest bitrate a browser here produces. Anything under MIN is a tap,
 * not speech.
 */
export const MAX_STT_BYTES = 320 * 1024;
export const MIN_STT_BYTES = 1024;

const MIME_TO_EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/** The file extension OpenAI should see for this Content-Type, or null if
 *  we don't accept it. OpenAI detects the container from the uploaded
 *  file's NAME, so this extension has to be right, not just present.
 *  Codec parameters ("audio/webm;codecs=opus") are ignored. */
export function audioExtension(contentType: string | null): string | null {
  const base = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return MIME_TO_EXTENSION[base] ?? null;
}

export class SttNotConfiguredError extends Error {}

export class SttVendorError extends Error {
  constructor(
    public status: number,
    detail: string
  ) {
    super(`OpenAI transcription failed (${status}): ${detail}`);
  }
}

export interface Transcript {
  text: string;
  /** Geometric-mean token probability, 0-1 (exp of the mean logprob). A
   *  model-internal certainty signal, not a calibrated accuracy figure —
   *  useful for "should we re-ask?", not as a percent-correct claim.
   *  Absent when the vendor returns no logprobs. */
  confidence?: number;
}

export async function transcribeHebrew(
  audio: ArrayBuffer,
  extension: string,
  contentType: string,
  signal?: AbortSignal
): Promise<Transcript> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new SttNotConfiguredError("OPENAI_API_KEY is not set");

  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType }), `speech.${extension}`);
  form.append("model", STT_MODEL);
  form.append("language", "he");
  form.append("response_format", "json");
  form.append("include[]", "logprobs");

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SttVendorError(res.status, detail.slice(0, 300));
  }

  const data = (await res.json()) as { text?: unknown; logprobs?: unknown };
  return {
    text: typeof data.text === "string" ? data.text.trim() : "",
    confidence: meanTokenProbability(data.logprobs),
  };
}

export function meanTokenProbability(logprobs: unknown): number | undefined {
  if (!Array.isArray(logprobs)) return undefined;
  const values = logprobs
    .map((entry) => (entry as { logprob?: unknown })?.logprob)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length === 0) return undefined;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(Math.exp(mean) * 1000) / 1000;
}
