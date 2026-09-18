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
 * The marks vocalize() is allowed to add: niqqud (vowel points) and
 * cantillation (te'amim) — Unicode general category Mn, "nonspacing
 * mark". That category is exactly Hebrew's combining diacritics; it
 * correctly excludes real characters that merely live in the same
 * block, like maqaf (־, U+05BE) and sof pasuq (׃, U+05C3), which are
 * punctuation, not marks, and must never be stripped.
 */
const NIQQUD_MARKS = /\p{Mn}/gu;

function collapseSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The mater lectionis letters — yod and vav. Unpointed Hebrew (ktiv male)
 * spells vowels with these; pointed Hebrew (ktiv haser) marks the same
 * vowel with a niqqud point instead and drops the letter. חישבת becomes
 * חִשַׁבְתָּ, לספור becomes לִסְפֹּר. That is the standard, correct
 * convention — the same word, respelled for the pointed orthography, NOT
 * a different word.
 *
 * Deliberately excludes alef and he, which are also sometimes matres: they
 * carry real consonantal weight far more often, and keeping the allowed
 * set to these two is what lets the check below still reject הוא → היא.
 */
const MATRES = "יו"; // י ו

/**
 * True when `stripped` (a vocalized word with its marks removed) is
 * `original` with only mater lectionis letters DELETED — i.e. the same
 * word in defective spelling. Deletion only, never insertion or
 * substitution, and never any other letter.
 *
 * Why deletion-only rather than "ignore all yods and vavs on both sides":
 * the looser rule collapses הוא and היא to the same normalized form, so a
 * vocalizer that swapped the pronoun's gender would pass. Walking the
 * original left to right and allowing only skips keeps that rejected.
 */
function isHaserRespelling(original: string, stripped: string): boolean {
  let i = 0;
  for (const ch of stripped) {
    // Skip matres in the original that the pointed spelling dropped.
    while (i < original.length && original[i] !== ch && MATRES.includes(original[i])) i++;
    if (i >= original.length || original[i] !== ch) return false;
    i++;
  }
  // Whatever is left over must be droppable too, or a letter went missing.
  for (; i < original.length; i++) if (!MATRES.includes(original[i])) return false;
  return true;
}

/**
 * True only when `vocalized` is `text` with niqqud/te'amim added and no
 * word changed. Strip every combining mark and the result must be `text`
 * again, word for word — allowing only the ktiv male → ktiv haser
 * respelling above, which adding niqqud legitimately performs.
 *
 * This is a proof the SYSTEM_PROMPT's "never change a word" rule held,
 * not a guess at whether the output looks close enough. Caught live: the
 * vocalizer rewrote ניפגש (future) as נפגשנו (past) in 1 of 5 spike clips
 * despite that rule, and this sits directly in front of exercise
 * questions.
 *
 * The first cut of this guard compared the stripped text to the original
 * byte for byte, which rejected the defective respelling too — measured
 * 2026-09-18 on real evaluator output, it threw away 3 of 5 legitimate
 * vocalizations, so the app paid ~1s per line for a result it discarded.
 * Word count is still exact: nothing added, nothing dropped.
 */
function isFaithfulVocalization(text: string, vocalized: string): boolean {
  const originalWords = collapseSpace(text).split(" ");
  const strippedWords = collapseSpace(vocalized.replace(NIQQUD_MARKS, "")).split(" ");
  if (originalWords.length !== strippedWords.length) return false;
  return originalWords.every((w, i) => isHaserRespelling(w, strippedWords[i]));
}

/**
 * Adds niqqud to `text`. Never throws — a vocalization failure (network,
 * rate limit, empty response, or a rewrite that changed a word instead
 * of just adding niqqud) falls back to speaking the original unvocalized
 * text rather than blocking speech entirely, or worse, speaking a
 * changed word with confident pronunciation. A kid hearing a possibly-
 * ambiguous but CORRECT line is a better failure mode than one that's
 * clearly spoken but wrong. Cached by exact text for the life of this
 * server instance — repeats (a replayed line, a reused bank question)
 * are free after the first. A rejected rewrite is not cached: it isn't
 * safe to remember as "the" vocalization for this text, and the retry
 * cost on the rare mismatch is worth not locking in a bad result.
 */
/** In-flight vocalizations by exact text. A call that gave up on the
 *  deadline leaves its request running to populate the cache; a second
 *  call for the same line must join that one rather than start a second
 *  identical LLM request. */
const inFlight = new Map<string, Promise<string | null>>();

/** Resolves to the vocalized text, or null when it can't be trusted
 *  (empty, failed, or rejected by the faithfulness guard). Caches on
 *  success — including when the caller who started it has already given
 *  up and spoken the line unvocalized. */
function startVocalize(text: string): Promise<string | null> {
  const existing = inFlight.get(text);
  if (existing) return existing;

  const t0 = Date.now();
  const run = (async (): Promise<string | null> => {
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
      if (!vocalized) return null;
      if (!isFaithfulVocalization(text, vocalized)) {
        console.error(
          `[tts-vocalize] rejected — word(s) changed, speaking unvocalized. original="${text}" vocalized="${vocalized}"`
        );
        return null;
      }
      cachePut(text, vocalized);
      return vocalized;
    } catch (err) {
      console.error(
        `[tts-vocalize] failed after ${Date.now() - t0}ms, speaking unvocalized:`,
        err instanceof Error ? err.message : err
      );
      return null;
    } finally {
      inFlight.delete(text);
    }
  })();

  inFlight.set(text, run);
  return run;
}

/**
 * How long a caller will wait for niqqud before speaking the line as-is.
 *
 * Measured 2026-09-18 on real evaluator output: the niqqud call runs
 * 707-1386ms (p50 910ms), and it sits directly in front of the TTS call,
 * so every millisecond is a child waiting in silence. Unbounded, it was
 * the single largest term in that wait — larger than Cartesia's own
 * time-to-first-byte (~495ms).
 *
 * Bounding it rather than removing it keeps the quality win where it is
 * cheap and drops it where it is expensive: a fast call still vocalizes,
 * a slow one speaks immediately and STILL populates the cache, so the
 * same line is vocalized (and free) the next time it is said. Lines
 * repeat constantly in this app — the same praise, the same bank
 * question — so "correct on the repeat" is most of the benefit at a
 * fraction of the latency.
 */
export const VOCALIZE_DEADLINE_MS = 400;

export async function vocalize(text: string, opts?: { deadlineMs?: number }): Promise<string> {
  if (!text || !HAS_HEBREW.test(text)) return text;
  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  const deadlineMs = opts?.deadlineMs ?? VOCALIZE_DEADLINE_MS;
  const pending = startVocalize(text);
  // Deliberately not an AbortSignal: the point of the deadline is to stop
  // the CHILD waiting, not to stop the work. The request runs on to warm
  // the cache for the next time this line is spoken.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
    // Never hold a serverless invocation open on this timer alone.
    (timer as { unref?: () => void }).unref?.();
  });
  const winner = await Promise.race([pending, timed]);
  clearTimeout(timer);
  return winner ?? text;
}

/** Test-only: clears the module cache between cases. */
export function __clearVocalizeCacheForTests() {
  cache.clear();
  inFlight.clear();
}

/** Test-only: the mismatch proof itself, exercised directly — no network,
 *  no LLM, so it can run against the exact ניפגש/נפגשנו case caught live
 *  without depending on the model reproducing (or not reproducing) it. */
export const __isFaithfulVocalizationForTests = isFaithfulVocalization;
