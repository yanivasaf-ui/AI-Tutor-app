import { getAnthropicClient } from "@/lib/llm/anthropic";

/**
 * Voice-experience fix item 5 (2026-09-15, TTS accuracy): root cause of
 * the reported misreadings (confirmed example: ירק — vegetable — read
 * aloud as ירוק, green) is unvocalized Hebrew going straight to Cartesia.
 * Hebrew script normally omits vowels; a TTS engine then has to guess a
 * pronunciation from spelling alone, and picks the wrong one whenever two
 * real words share a spelling. Niqqud (vowel points) removes the
 * ambiguity before it ever reaches the TTS engine.
 *
 * Picked LLM vocalization over Dicta's API or the nakdimon model after
 * weighing the options against this app's actual constraints: Dicta's
 * public nakdan API is a third external network dependency with its own
 * latency and uptime (on top of Anthropic + Cartesia already in this
 * path); nakdimon is a real model but needs a Python/ONNX runtime this
 * app deliberately avoids for anything on the hot path (see app/api/
 * tutor/route.ts's own header comment on `embedText`'s onnxruntime cold-
 * start cost, and why it's dynamically imported instead of paying that
 * cost on every function cold start). The Anthropic client is already
 * configured and warm here; a fast model plus an aggressive cache (below)
 * keeps this from becoming a second per-utterance LLM call on the hot
 * path in steady state — see synthesizeSpeech's cache in cartesia.ts,
 * this module's own cache is the fallback for whatever isn't cached
 * there yet.
 */

const VOCALIZE_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `הוסף/י ניקוד מלא (תנועות) לטקסט העברי הבא, כדי שמנוע הקראה (TTS) יקרא אותו בהגייה הנכונה.
כללים מחייבים:
- אסור לשנות אף מילה, אסור להוסיף או להוריד מילים, אסור לתקן טעויות.
- כל תו שאינו עברי (מספרים, סימני פיסוק, רווחים, אותיות לועזיות, אימוג'ים) נשאר בדיוק כפי שהוא, באותו מקום.
- כשמילה כתובה בלי ניקוד יכולה להתפרש בכמה דרכים (למשל "ירק" = יֶרֶק/ירקות לעומת יָרֹק/צבע), בחר/י את הניקוד שמתאים להקשר המשפט.
- החזר/י אך ורק את הטקסט המנוקד עצמו — בלי הסבר, בלי markdown, בלי גרשיים מסביב.`;

const CACHE_MAX = 300;
const cache = new Map<string, string>();

function cachePut(key: string, value: string) {
  cache.set(key, value);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Text with no Hebrew letters at all (a bare number, pure punctuation)
 *  has nothing for niqqud to disambiguate — skip the LLM round trip. */
const HAS_HEBREW = /[א-ת]/;

/**
 * Adds niqqud to `text`. Never throws — a vocalization failure (network,
 * rate limit, empty response) falls back to speaking the original
 * unvocalized text rather than blocking speech entirely; a kid hearing a
 * possibly-mispronounced line is a better failure mode than the tutor
 * going silent. Cached by exact text for the life of this server
 * instance — repeats (a replayed line, a reused bank question) are free
 * after the first.
 */
export async function vocalize(text: string): Promise<string> {
  if (!text || !HAS_HEBREW.test(text)) return text;
  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  const t0 = Date.now();
  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: VOCALIZE_MODEL,
      max_tokens: Math.min(1500, Math.max(200, text.length * 3)),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });
    const block = response.content.find((b) => b.type === "text");
    const vocalized = block && block.type === "text" ? block.text.trim() : "";
    console.log(`[tts-vocalize] ms=${Date.now() - t0} chars=${text.length} ok=${!!vocalized}`);
    if (!vocalized) return text;
    cachePut(text, vocalized);
    return vocalized;
  } catch (err) {
    console.error(
      `[tts-vocalize] failed after ${Date.now() - t0}ms, speaking unvocalized:`,
      err instanceof Error ? err.message : err
    );
    return text;
  }
}

/** Test-only: clears the module cache between cases. */
export function __clearVocalizeCacheForTests() {
  cache.clear();
}
