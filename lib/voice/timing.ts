"use client";

/**
 * Voice-loop latency instrumentation.
 *
 * ROADMAP.md's constraint is "a 6-year-old waits ~2 seconds, not 8", so
 * the loop needs to be measurable rather than assumed. Records one span
 * per leg of a turn into a module-level ring buffer, readable from the
 * browser console via `window.__voiceTimings()` during verification.
 *
 * Deliberately not shipped to any analytics backend — it's a development
 * measurement surface, and sending a child's interaction timings anywhere
 * is a decision nobody has made.
 */

export type VoiceLeg =
  | "listen" // mic down -> transcript in hand (STT)
  | "transcribe" // mic up -> transcript in hand (cloud STT: upload + vendor). The number the ~2s-after-release target is about.
  | "match" // transcript -> matched answer (local, expected ~0ms)
  | "evaluate" // POST /api/tutor answer_exercise round trip (LLM)
  | "speak-start" // speak() called -> audio actually began (TTS)
  | "cue" // end-of-speech -> the local "I heard you" blip sounded (no network; see lib/speech/cue.ts)
  | "reply" // end-of-speech -> first audible word of the actual reply. THE number this pipeline is judged on.
  | "ack" // mic press -> character audibly acknowledges ("רגע, אני חושב...")
  | "turn"; // mic press -> character starts speaking the actual reply

export interface VoiceTiming {
  leg: VoiceLeg;
  ms: number;
  at: number;
}

const MAX = 60;
const timings: VoiceTiming[] = [];

export function recordTiming(leg: VoiceLeg, ms: number) {
  timings.push({ leg, ms: Math.round(ms), at: Date.now() });
  if (timings.length > MAX) timings.shift();
}

/**
 * When the child stopped talking — the instant the mic is released, since
 * this app is push-to-talk and release IS end-of-speech (there is no VAD;
 * see lib/stt/provider.ts). Kept here rather than threaded through props
 * because the two ends of the measurement live in different components:
 * useVoiceInput owns the release, ExerciseScreen owns the moment audio
 * first sounds.
 */
let endOfSpeechAt: number | null = null;

export function markEndOfSpeech() {
  endOfSpeechAt = performance.now();
}

/** Milliseconds since the child stopped talking, or null if no utterance
 *  is in flight (a tap answer, or a leg already recorded). */
export function msSinceEndOfSpeech(): number | null {
  return endOfSpeechAt === null ? null : performance.now() - endOfSpeechAt;
}

export function clearEndOfSpeech() {
  endOfSpeechAt = null;
}

export function getTimings(): VoiceTiming[] {
  return [...timings];
}

/** Mean/min/max per leg — what gets reported. */
export function summarizeTimings(): Record<string, { n: number; mean: number; min: number; max: number }> {
  const byLeg: Record<string, number[]> = {};
  for (const t of timings) (byLeg[t.leg] ??= []).push(t.ms);
  const out: Record<string, { n: number; mean: number; min: number; max: number }> = {};
  for (const [leg, xs] of Object.entries(byLeg)) {
    out[leg] = {
      n: xs.length,
      mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
      min: Math.min(...xs),
      max: Math.max(...xs),
    };
  }
  return out;
}

export function clearTimings() {
  timings.length = 0;
}

// Console handle for in-browser verification.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__voiceTimings = summarizeTimings;
  (window as unknown as Record<string, unknown>).__voiceTimingsRaw = getTimings;
  (window as unknown as Record<string, unknown>).__voiceTimingsClear = clearTimings;
}
