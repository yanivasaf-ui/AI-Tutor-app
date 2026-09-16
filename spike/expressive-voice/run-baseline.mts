/**
 * Expressive-voice spike — baseline leg (current provider, Cartesia).
 *
 * Produces the 5 reference clips and the measured half of the comparison
 * table. Deliberately does NOT go through lib/tts/cartesia.ts's
 * synthesizeSpeech(), because that bundles the niqqud step and the TTS
 * call into one await — this spike needs them timed separately, since
 * only the TTS half is what a provider swap would replace.
 *
 * Nothing here is imported by the app. Run:
 *   npx tsx spike/expressive-voice/run-baseline.mts <output-dir>
 *
 * Reads CARTESIA_API_KEY and ANTHROPIC_API_KEY (the latter via
 * lib/tts/vocalize.ts, the same niqqud pre-processing production applies
 * before every utterance).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { vocalize } from "../../lib/tts/vocalize";
import { CARTESIA_VOICES } from "../../lib/voices";

/** Mirrors lib/tts/cartesia.ts. Duplicated rather than exported from
 *  there: that file belongs to the in-flight voice branch, and a spike
 *  must not widen its API. */
const CARTESIA_URL = "https://api.cartesia.ai/tts/bytes";
const CARTESIA_VERSION = "2026-08-14";
const MODEL_ID = "sonic-3.6";

/**
 * One script, five registers — the same five every provider gets, so the
 * comparison is like-for-like. Hebrew at a grades 1-3 reading level: short
 * sentences, concrete words, no subordinate clauses. (d) and (e) are the
 * ones that actually separate providers: a whisper and a punchline are
 * where a flat voice stops sounding like a person.
 */
const SCRIPTS = [
  { id: "a-greeting", label: "greeting", text: "היי! כיף שבאת היום. בוא נתחיל ללמוד ביחד." },
  { id: "b-praise", label: "specific praise", text: "כל הכבוד! פתרת את כל התרגילים בלי אף טעות אחת." },
  { id: "c-encouragement", label: "encouragement after a mistake", text: "זה בסדר גמור, זה קורה לכולם. בוא ננסה שוב, לאט לאט." },
  { id: "d-whisper", label: "whispered hint", text: "רק רמז קטן, בשקט... תסתכל על הספרה הראשונה." },
  { id: "e-joke", label: "joke", text: "מה אמר הקיר לקיר? ניפגש בפינה!" },
];

interface Measured {
  id: string;
  label: string;
  charsRaw: number;
  charsVocalized: number;
  vocalizeMs: number;
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  file: string;
}

async function synthesizeMeasured(text: string, outPath: string) {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) throw new Error("CARTESIA_API_KEY is not set");

  const startedAt = performance.now();
  const res = await fetch(CARTESIA_URL, {
    method: "POST",
    headers: {
      "Cartesia-Version": CARTESIA_VERSION,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: MODEL_ID,
      transcript: text,
      voice: { id: CARTESIA_VOICES.girl },
      language: "he",
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Cartesia ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  // Time to FIRST audio byte, not to a complete file: that's the number a
  // kid actually waits through, and the only latency figure comparable
  // across providers with different streaming behaviour.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let ttfbMs = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      if (chunks.length === 0) ttfbMs = performance.now() - startedAt;
      chunks.push(value);
    }
  }
  const audio = Buffer.concat(chunks);
  await writeFile(outPath, audio);
  return { ttfbMs, totalMs: performance.now() - startedAt, bytes: audio.length };
}

const outDir = process.argv[2] ?? "spike/expressive-voice/clips";
await mkdir(outDir, { recursive: true });

const rows: Measured[] = [];
for (const s of SCRIPTS) {
  const t0 = performance.now();
  const vocalized = await vocalize(s.text);
  const vocalizeMs = performance.now() - t0;

  const file = join(outDir, `cartesia-${s.id}.mp3`);
  const { ttfbMs, totalMs, bytes } = await synthesizeMeasured(vocalized, file);

  rows.push({
    id: s.id,
    label: s.label,
    charsRaw: s.text.length,
    charsVocalized: vocalized.length,
    vocalizeMs: Math.round(vocalizeMs),
    ttfbMs: Math.round(ttfbMs),
    totalMs: Math.round(totalMs),
    bytes,
    file,
  });
  console.log(
    `${s.id.padEnd(18)} raw=${String(s.text.length).padStart(3)} voc=${String(vocalized.length).padStart(3)} ` +
      `vocalize=${String(Math.round(vocalizeMs)).padStart(5)}ms ttfb=${String(Math.round(ttfbMs)).padStart(5)}ms ` +
      `total=${String(Math.round(totalMs)).padStart(5)}ms ${(bytes / 1024).toFixed(1)}KB`
  );
  console.log(`  vocalized: ${vocalized}`);
}

const sum = (f: (r: Measured) => number) => rows.reduce((a, r) => a + f(r), 0);
const mean = (f: (r: Measured) => number) => Math.round(sum(f) / rows.length);
const charInflation = sum((r) => r.charsVocalized) / sum((r) => r.charsRaw);

console.log("\n=== BASELINE SUMMARY (Cartesia sonic-3.6, he) ===");
console.log(`clips:                 ${rows.length}`);
console.log(`chars raw (total):     ${sum((r) => r.charsRaw)}`);
console.log(`chars vocalized:       ${sum((r) => r.charsVocalized)}`);
console.log(`niqqud inflation:      ${charInflation.toFixed(2)}x  <- billed characters are the VOCALIZED count`);
console.log(`vocalize ms (mean):    ${mean((r) => r.vocalizeMs)}`);
console.log(`TTS ttfb ms (mean):    ${mean((r) => r.ttfbMs)}   min=${Math.min(...rows.map((r) => r.ttfbMs))} max=${Math.max(...rows.map((r) => r.ttfbMs))}`);
console.log(`end-to-end ms (mean):  ${mean((r) => r.vocalizeMs + r.ttfbMs)}  (vocalize + ttfb, what the kid waits)`);
console.log(`\nJSON:\n${JSON.stringify({ rows, charInflation }, null, 1)}`);
