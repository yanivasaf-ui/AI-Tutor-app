import type { CharacterId } from "@/lib/characters";

/**
 * Each character's Cartesia (Sonic) voice — Asaf's picks, 2026-09-11.
 *
 * A plain module (no "use client") so both the client character registry
 * (lib/characters.ts) and the server TTS call (lib/tts/cartesia.ts) can
 * import it. Voice IDs are public identifiers, not secrets; the API key
 * lives only in server env (CARTESIA_API_KEY).
 */
export const CARTESIA_VOICES: Record<CharacterId, string> = {
  boy: "86e30c1d-714b-4074-a1f2-1cb6b552fb49", // Quirky One, raspberry
  girl: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc", // Sweet One, teal
};
