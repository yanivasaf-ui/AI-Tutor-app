import { CARTESIA_VOICES } from "@/lib/voices";
import type { CharacterId } from "@/lib/characters";
import { vocalize } from "@/lib/tts/vocalize";

/**
 * Server-side Cartesia text-to-speech (the characters' own voices).
 *
 * Request shape per docs.cartesia.ai/api-reference/tts/bytes, checked
 * 2026-09-11: POST /tts/bytes, Bearer auth, a dated Cartesia-Version
 * header, model `sonic-3.6` (current GA model; supports Hebrew). MP3 so
 * every browser — iOS Safari included — can play the result from a plain
 * <audio> element.
 *
 * Server-only: reads CARTESIA_API_KEY. Never import from client code.
 */
const CARTESIA_URL = "https://api.cartesia.ai/tts/bytes";
const CARTESIA_VERSION = "2026-08-14";
const MODEL_ID = "sonic-3.6";

/** Longest line we'll voice. The longest real lines are an exercise
 *  passage + its question; this bounds cost per request if something
 *  sends a runaway string. */
export const MAX_TTS_CHARS = 1200;

export class TtsNotConfiguredError extends Error {}

export async function synthesizeSpeech(text: string, character: CharacterId, signal?: AbortSignal): Promise<Response> {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) throw new TtsNotConfiguredError("CARTESIA_API_KEY is not set");

  // Voice-experience fix item 5: unvocalized Hebrew is the confirmed root
  // cause of the reported misreadings (ירק read as ירוק) — see vocalize.ts
  // for why this is an LLM call rather than Dicta/nakdimon. Runs for every
  // caller of synthesizeSpeech, template lines and exercise text alike;
  // vocalize() itself no-ops on non-Hebrew text and is cached by exact
  // text, so repeats after the first are free.
  const transcript = await vocalize(text);

  return fetch(CARTESIA_URL, {
    method: "POST",
    headers: {
      "Cartesia-Version": CARTESIA_VERSION,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: MODEL_ID,
      transcript,
      voice: { id: CARTESIA_VOICES[character] },
      language: "he",
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    }),
    signal,
  });
}
