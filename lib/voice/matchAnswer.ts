/**
 * Matching a spoken Hebrew answer to an exercise answer.
 *
 * Why this exists: the first voice wiring compared the raw transcript to
 * each choice with `===`. That effectively never matches real speech. A
 * kid answering a pick_operation exercise says "שמונה פחות שלוש" while
 * the choice reads "8 - 3"; a kid answering a comprehension question says
 * "פחד" while the choice reads "פחד והיה מופתע". Both are correct answers
 * and both failed. Voice was wired but not working.
 *
 * Approach: normalize BOTH sides into a canonical token sequence (digits
 * for number words, symbols for operator words, niqqud/punctuation
 * stripped), then compare — exact, then numeric, then containment.
 *
 * Deliberately conservative on ambiguity: if a transcript could match more
 * than one choice, that's `none/ambiguous`, not a guess. Asking a
 * 6-year-old "לא שמעתי, אפשר שוב?" is much cheaper than silently
 * submitting the wrong answer and marking them wrong for it.
 */

/** Hebrew points/cantillation (U+0591–U+05C7) — stripped before matching. */
const NIQQUD = /[֑-ׇ]/g;

/** Number words 0–20 in both grammatical genders, plus tens and 100.
 *  Scope note: grade א'-ג' nominally reaches 10,000, but spoken answers
 *  are overwhelmingly small, and Chrome's he-IL recognizer usually
 *  returns larger numbers as digits already — so this is a robustness
 *  layer over the digit path, not the primary path. */
const NUMBER_WORDS: Record<string, number> = {
  אפס: 0,
  אחת: 1, אחד: 1,
  שתיים: 2, שניים: 2, שתי: 2, שני: 2,
  שלוש: 3, שלושה: 3,
  ארבע: 4, ארבעה: 4,
  חמש: 5, חמישה: 5,
  שש: 6, שישה: 6,
  שבע: 7, שבעה: 7,
  שמונה: 8, שמונת: 8,
  תשע: 9, תשעה: 9,
  עשר: 10, עשרה: 10,
  עשרים: 20,
  שלושים: 30,
  ארבעים: 40,
  חמישים: 50,
  שישים: 60,
  שבעים: 70,
  שמונים: 80,
  תשעים: 90,
  מאה: 100,
};

const TENS = new Set([20, 30, 40, 50, 60, 70, 80, 90]);

/** Symbols that survive tokenization as standalone tokens. */
const SYMBOL_TOKENS = new Set(["+", "-", "*", "/", "="]);

/** Spoken operators -> the symbol they'd appear as in a choice string. */
const OPERATOR_WORDS: Record<string, string> = {
  ועוד: "+", פלוס: "+", וגם: "+",
  פחות: "-", מינוס: "-",
  כפול: "*", כפולה: "*",
  חלקי: "/", מחולק: "/",
  שווה: "=",
};

function stripNiqqud(s: string): string {
  return s.replace(NIQQUD, "");
}

/**
 * Canonical token sequence for comparison. Hebrew number words become
 * digits, operator words become symbols, punctuation goes away, and
 * "עשרים ושתיים"-style compounds collapse into one number.
 */
export function tokenize(input: string): string[] {
  const cleaned = stripNiqqud(input)
    .replace(/[׳״'"׳״]/g, "") // geresh/gershayim
    .replace(/[־\-–—]/g, " - ") // maqaf and dashes are meaningful (minus)
    .replace(/[+]/g, " + ")
    .replace(/[*×]/g, " * ")
    .replace(/[/÷]/g, " / ")
    .replace(/[=]/g, " = ")
    .replace(/[.,!?;:()[\]{}]/g, " ")
    .toLowerCase()
    .trim();

  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  const out: string[] = [];

  for (let i = 0; i < rawTokens.length; i++) {
    let tok = rawTokens[i];

    // "ו" prefix on a number word inside a compound ("ושתיים" in
    // "עשרים ושתיים") — strip it so the word resolves.
    const deVav = tok.startsWith("ו") && NUMBER_WORDS[tok.slice(1)] !== undefined ? tok.slice(1) : tok;

    if (OPERATOR_WORDS[tok] !== undefined) {
      out.push(OPERATOR_WORDS[tok]);
      continue;
    }

    if (NUMBER_WORDS[deVav] !== undefined) {
      const value = NUMBER_WORDS[deVav];
      // Compound: a tens word followed by a unit word ("עשרים ושתיים").
      if (TENS.has(value) && i + 1 < rawTokens.length) {
        const nextRaw = rawTokens[i + 1];
        const nextWord = nextRaw.startsWith("ו") ? nextRaw.slice(1) : nextRaw;
        const nextValue = NUMBER_WORDS[nextWord];
        if (nextValue !== undefined && nextValue >= 1 && nextValue <= 9) {
          out.push(String(value + nextValue));
          i++; // consumed the unit word too
          continue;
        }
      }
      out.push(String(value));
      continue;
    }

    // Operator symbols are meaningful tokens in their own right ("8 - 3"),
    // so they must survive the non-alphanumeric strip below — without this
    // the choice "8 - 3" tokenizes to ["8","3"] while the spoken
    // "שמונה פחות שלוש" tokenizes to ["8","-","3"], and they never match.
    if (SYMBOL_TOKENS.has(tok)) {
      out.push(tok);
      continue;
    }

    // Bare digits stay as-is; strip any stray non-alphanumerics.
    tok = tok.replace(/[^\p{L}\p{N}]/gu, "");
    if (tok) out.push(tok);
  }

  return out;
}

export function normalize(input: string): string {
  return tokenize(input).join(" ");
}

/** The single number a string reduces to, or null if it isn't exactly one
 *  number. "8 - 3" reduces to null (two numbers + an operator), which is
 *  what stops it from false-matching a transcript of "שמונה". */
export function toSingleNumber(input: string): number | null {
  const tokens = tokenize(input);
  const numeric = tokens.filter((t) => /^\d+$/.test(t));
  if (numeric.length !== 1 || tokens.length !== 1) return null;
  return Number(numeric[0]);
}

export type AnswerMatch =
  | { kind: "choice"; value: string }
  | { kind: "value"; value: string }
  | { kind: "none"; reason: "no-match" | "ambiguous" | "out-of-range" };

/**
 * Match a transcript against multiple-choice options.
 *
 * Order: exact normalized equality, then single-number equality, then
 * whole-token containment. Containment requires >= 2 characters so a
 * stray "א" can't latch onto a long choice. More than one candidate at
 * any tier is ambiguous — re-ask rather than guess.
 */
export function matchChoice(transcript: string, choices: string[]): AnswerMatch {
  const t = normalize(transcript);
  if (!t) return { kind: "none", reason: "no-match" };

  const normalizedChoices = choices.map((c) => ({ raw: c, norm: normalize(c) }));

  const exact = normalizedChoices.filter((c) => c.norm === t);
  if (exact.length === 1) return { kind: "choice", value: exact[0].raw };
  if (exact.length > 1) return { kind: "none", reason: "ambiguous" };

  const tNum = toSingleNumber(transcript);
  if (tNum !== null) {
    const numeric = normalizedChoices.filter((c) => toSingleNumber(c.raw) === tNum);
    if (numeric.length === 1) return { kind: "choice", value: numeric[0].raw };
    if (numeric.length > 1) return { kind: "none", reason: "ambiguous" };
  }

  // Guard against a stray single *letter* ("א") latching onto a long
  // choice by containment. A single digit is deliberately allowed
  // through: "8" is a real answer, and letting it reach the containment
  // tier is what surfaces it as ambiguous across ["8 + 3", "8 - 3"]
  // rather than silently no-matching.
  const tTokensAll = tokenize(transcript);
  const isLoneLetter = tTokensAll.length === 1 && /^\p{L}$/u.test(tTokensAll[0]);
  if (!isLoneLetter) {
    const tTokens = tTokensAll;
    const contained = normalizedChoices.filter((c) => {
      const cTokens = tokenize(c.raw);
      return containsSubsequence(cTokens, tTokens) || containsSubsequence(tTokens, cTokens);
    });
    if (contained.length === 1) return { kind: "choice", value: contained[0].raw };
    if (contained.length > 1) return { kind: "none", reason: "ambiguous" };
  }

  return { kind: "none", reason: "no-match" };
}

/** True when `needle` appears as a contiguous run of whole tokens in
 *  `haystack`. Whole-token (not substring) so "שם" can't match "שמונה". */
function containsSubsequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Match a transcript against a number-line exercise. Voice suits this
 * type especially well — the kid just says the number.
 */
export function matchNumberLine(
  transcript: string,
  spec: { min: number; max: number; step: number }
): AnswerMatch {
  const tokens = tokenize(transcript);
  const numbers = tokens.filter((t) => /^\d+$/.test(t)).map(Number);
  if (numbers.length !== 1) return { kind: "none", reason: "no-match" };

  const value = numbers[0];
  if (value < spec.min || value > spec.max) return { kind: "none", reason: "out-of-range" };

  const step = spec.step > 0 ? spec.step : 1;
  const offset = value - spec.min;
  if (offset % step !== 0) return { kind: "none", reason: "out-of-range" };

  return { kind: "value", value: String(value) };
}
