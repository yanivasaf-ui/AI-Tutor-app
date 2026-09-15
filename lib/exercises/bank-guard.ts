import {
  balancesEquation,
  computeAnswer,
  formatAnswer,
  normalizeMathText,
  parseComputation,
  questionStatesComputation,
} from "./arithmetic";
import type { Exercise, ExerciseSubtype } from "./types";

/**
 * The pre-generated exercise bank's admission gate (2026-09-14): every row
 * that goes IN must carry a structured spec code can independently verify
 * — the arithmetic guard's own rule (lib/exercises/arithmetic.ts), extended
 * here to every OTHER bankable subtype. A model is never trusted as the
 * source of truth for whether an exercise is internally consistent, only
 * for the WORDING.
 *
 * "Structured spec," per subtype:
 * - fill_in_blank: {operands, operators} — computeAnswer() derives the
 *   number (lib/exercises/arithmetic.ts, unchanged, reused here).
 * - number_line_placement: the placed value is literally stated in the
 *   question ("היכן נמצא המספר 42?") — verified against the number line's
 *   own range/step, not computed, but still independently checkable.
 * - pattern_completion: an arithmetic sequence — the common difference
 *   across the GIVEN terms determines the next one; verified the same way
 *   fill_in_blank's arithmetic is, just extracted from a sequence instead
 *   of an expression.
 * - visual_grouping / equation_balance: already had a real check at
 *   generation time (lib/exercises/generate.ts) — re-expressed here so the
 *   SAME check can run over the whole bank later, not just a fresh draft.
 * - pick_operation / spelling_correction_mc / root_pattern_mc /
 *   vowel_select_mc / phonemic_visual_mc / comprehension-as-multiple-choice:
 *   the "answer" is inherently a fixed pick among a small, model-declared
 *   set — the verifiable property isn't arithmetic truth, it's INTERNAL
 *   CONSISTENCY: correctAnswer is exactly one of the offered choices, no
 *   ambiguity. Comprehension is bank-restricted to its multiple_choice form
 *   for exactly this reason — comprehension's open-answer form has no
 *   single verifiable string.
 * - word_build / sentence_order: exact reconstruction — the tiles, in SOME
 *   order, must spell correctAnswer exactly (same letters/words, same
 *   count). generate.ts already checks this at draft time; re-verified
 *   here for the same "sweep the whole bank" reason as above.
 *
 * NOT bankable, and excluded from the seed script's subtype pool entirely:
 * - explain_thinking: correctAnswer is a rubric ("a good explanation
 *   mentions X"), not a fact — there is no single right answer to verify
 *   against, by design (lib/exercises/evaluate.ts judges it with an LLM on
 *   purpose). No structured spec exists to backfill.
 * - shape_match: the pattern lives in an emoji sequence with no reliable,
 *   general way to parse "the rule" back out in code (unlike a numeric
 *   arithmetic progression) — verifying it would mean re-implementing
 *   visual pattern recognition, not checking a spec. Excluded rather than
 *   shipping a guard that can't actually catch a wrong answer.
 *
 * What this guard does NOT check, by design (2026-09-15, BUG B): whether
 * an exercise's CONTENT actually relates to its own topic_id. A
 * number_line_placement row correctly tagged math-a-geometry but asking
 * "היכן נמצא המספר 42?" with no shape in sight passes every check above —
 * its spec (the number line's range/step, the stated value) is entirely
 * self-consistent. Structural/arithmetic consistency and topical
 * relevance are different questions; this guard answers the first one
 * only. The fix for "content doesn't match its topic" lives in
 * generate.ts's prompt (require the scenario to draw from the resolved
 * topic's own curriculum content), not here — there's no reliable way to
 * verify "is this text ABOUT shapes" in code the way "is 3+4 really 7" is
 * checkable.
 */

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

const UNVERIFIABLE_SUBTYPES = new Set<ExerciseSubtype>(["explain_thinking", "shape_match"]);

export function isBankableSubtype(subtype: ExerciseSubtype | undefined): boolean {
  return !!subtype && !UNVERIFIABLE_SUBTYPES.has(subtype);
}

function fail(reason: string): GuardResult {
  return { ok: false, reason };
}
const ok: GuardResult = { ok: true };

/** Every digit run in `text`, as numbers, in order — for pulling a stated
 *  value (number-line placement) or a sequence (pattern completion) out of
 *  a question's own wording. */
function digitsIn(text: string): number[] {
  return (normalizeMathText(text).match(/\d+/g) ?? []).map(Number);
}

function verifyFillInBlank(ex: Exercise): GuardResult {
  const parsed = parseComputation(ex.computation);
  if (!parsed) return fail("no valid computation spec");
  if (!questionStatesComputation(ex.question, parsed)) return fail("question doesn't state its own computation");
  const answer = computeAnswer(parsed);
  if (answer === null) return fail("computation has no valid result");
  if (formatAnswer(answer) !== ex.correctAnswer.trim()) return fail(`correctAnswer "${ex.correctAnswer}" != computed ${answer}`);
  return ok;
}

function verifyMultipleChoiceExact(ex: Exercise): GuardResult {
  if (ex.type !== "multiple_choice") return fail(`type is "${ex.type}", not multiple_choice`);
  if (!ex.choices || ex.choices.length < 2) return fail("fewer than 2 choices");
  const matches = ex.choices.filter((c) => c === ex.correctAnswer);
  if (matches.length !== 1) return fail(`correctAnswer appears ${matches.length} times in choices (must be exactly 1)`);
  return ok;
}

function verifyNumberLinePlacement(ex: Exercise): GuardResult {
  if (ex.type !== "number_line" || !ex.numberLine) return fail("not a number_line exercise");
  const value = Number(ex.correctAnswer);
  if (!Number.isFinite(value)) return fail(`correctAnswer "${ex.correctAnswer}" isn't a number`);
  if (!digitsIn(ex.question).includes(value)) return fail(`question never states the value ${value}`);
  const { min, max, step } = ex.numberLine;
  if (value < min || value > max) return fail(`${value} outside [${min}, ${max}]`);
  if (step > 0 && (value - min) % step !== 0) return fail(`${value} not aligned to step ${step} from ${min}`);
  return ok;
}

/** Extracts a numeric sequence from a "5, 10, 15, 20, ___" style question —
 *  every digit run up to (not including) the blank placeholder. */
function verifyPatternCompletion(ex: Exercise): GuardResult {
  if (ex.type !== "tile_order" || !ex.tiles) return fail("not a tile_order exercise");
  const blankIndex = ex.question.search(/_{2,}|…/);
  const givenText = blankIndex >= 0 ? ex.question.slice(0, blankIndex) : ex.question;
  const given = digitsIn(givenText);
  if (given.length < 3) return fail(`fewer than 3 given terms in "${ex.question}"`);
  const diffs = given.slice(1).map((n, i) => n - given[i]);
  if (!diffs.every((d) => d === diffs[0])) return fail(`not a constant-difference sequence: ${given.join(",")}`);
  const next = given[given.length - 1] + diffs[0];
  if (String(next) !== ex.correctAnswer.trim()) return fail(`sequence ${given.join(",")} continues with ${next}, not "${ex.correctAnswer}"`);
  if (!ex.tiles.items.includes(ex.correctAnswer)) return fail("correctAnswer isn't among the offered tiles");
  return ok;
}

function verifyVisualGrouping(ex: Exercise): GuardResult {
  if (ex.type !== "grouping" || !ex.grouping) return fail("not a grouping exercise");
  const { items, groupCount } = ex.grouping;
  if (groupCount < 2 || items.length % groupCount !== 0) return fail(`${items.length} items doesn't split evenly into ${groupCount} groups`);
  const expected = String(items.length / groupCount);
  if (ex.correctAnswer.trim() !== expected) return fail(`correctAnswer "${ex.correctAnswer}" != ${expected}`);
  return ok;
}

function verifyEquationBalance(ex: Exercise): GuardResult {
  if (ex.type !== "tile_order" || !ex.tiles) return fail("not a tile_order exercise");
  if (!ex.tiles.items.includes(ex.correctAnswer)) return fail("correctAnswer isn't among the offered tiles");
  if (!balancesEquation(ex.question, ex.correctAnswer)) return fail(`"${ex.correctAnswer}" doesn't balance "${ex.question}"`);
  return ok;
}

/** Same multiset of units (letters for word_build, words for
 *  sentence_order) on both sides — the tiles, in SOME order, must be able
 *  to spell correctAnswer exactly. */
function verifyExactReconstruction(ex: Exercise, splitAnswer: (s: string) => string[]): GuardResult {
  if (ex.type !== "tile_order" || !ex.tiles) return fail("not a tile_order exercise");
  const want = splitAnswer(ex.correctAnswer);
  const got = [...ex.tiles.items];
  if (want.length !== got.length) return fail(`${got.length} tiles can't spell a ${want.length}-unit answer`);
  const remaining = [...got];
  for (const unit of want) {
    const at = remaining.indexOf(unit);
    if (at === -1) return fail(`tile set ${JSON.stringify(got)} can't spell "${ex.correctAnswer}"`);
    remaining.splice(at, 1);
  }
  return ok;
}

/**
 * The full admission check for one exercise. `ok: true` means every claim
 * the exercise makes about its own correctness is independently verified
 * in code — this is what "in the bank" is allowed to mean.
 */
export function verifyExercise(ex: Exercise): GuardResult {
  if (!ex.subtype) return fail("no subtype");
  if (UNVERIFIABLE_SUBTYPES.has(ex.subtype)) return fail(`${ex.subtype} has no structured spec by design`);
  switch (ex.subtype) {
    case "fill_in_blank":
      return verifyFillInBlank(ex);
    case "pick_operation":
    case "spelling_correction_mc":
    case "root_pattern_mc":
    case "vowel_select_mc":
    case "phonemic_visual_mc":
      return verifyMultipleChoiceExact(ex);
    case "comprehension":
      // Bank-restricted to its multiple_choice form — see the file header.
      return verifyMultipleChoiceExact(ex);
    case "number_line_placement":
      return verifyNumberLinePlacement(ex);
    case "pattern_completion":
      return verifyPatternCompletion(ex);
    case "visual_grouping":
      return verifyVisualGrouping(ex);
    case "equation_balance":
      return verifyEquationBalance(ex);
    case "word_build":
      return verifyExactReconstruction(ex, (s) => [...s]);
    case "sentence_order":
      return verifyExactReconstruction(ex, (s) => s.trim().split(/\s+/));
    default:
      return fail(`unhandled subtype "${ex.subtype}"`);
  }
}

/**
 * A fingerprint identifying an exercise's underlying SPEC (not its
 * wording) — two exercises with the same fingerprint in the same
 * topic+level are duplicates for banking purposes (the seed script's own
 * dedupe rule), even if the question text differs.
 */
export function specFingerprint(ex: Exercise): string {
  switch (ex.subtype) {
    case "fill_in_blank":
      return `computation:${JSON.stringify(ex.computation)}`;
    case "number_line_placement":
      return `numberLine:${JSON.stringify(ex.numberLine)}:${ex.correctAnswer}`;
    case "pattern_completion":
    case "equation_balance":
      return `tiles:${[...ex.tiles?.items ?? []].sort().join(",")}:${ex.correctAnswer}`;
    case "word_build":
    case "sentence_order":
      return `answer:${ex.correctAnswer}`;
    case "visual_grouping":
      return `grouping:${ex.grouping?.items.length}:${ex.grouping?.groupCount}`;
    case "pick_operation":
    case "spelling_correction_mc":
    case "root_pattern_mc":
    case "vowel_select_mc":
    case "phonemic_visual_mc":
    case "comprehension":
      return `choices:${[...(ex.choices ?? [])].sort().join(",")}:${ex.correctAnswer}`;
    default:
      return `question:${ex.question}`;
  }
}
