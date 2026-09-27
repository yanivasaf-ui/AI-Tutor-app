import { computeAnswer, formatAnswer, type Computation, type Operator } from "./arithmetic";
import { neutralInvitation } from "@/lib/feedback/constitution";
import type { Exercise } from "./types";
import type { KidGender } from "@/lib/memory/types";

/**
 * A fixed hint ladder, in place of one freeform hint.
 *
 * The old behaviour asked a model for "one short hint, about 8 words" and
 * whatever came back was the child's only help. If it did not land, the
 * next thing they got was the answer. That is a cliff, not a ladder, and
 * the hint itself varied from run to run on the same question.
 *
 * The rungs, in order:
 *   1 rephrase       say the same question a different way
 *   2 shrink         take one smaller step out of it
 *   3 twin           a easier problem of the SAME shape, worked aloud by
 *                    the character — the child does not solve this one
 *   4 solve together walk the original through, step by step
 *   + small win      one easy question of the same shape the child DOES
 *                    answer, so the problem ends on something that worked
 *
 * Deterministic on purpose: every line here is built in code from the
 * exercise's own `computation`, so the same question always gives the same
 * help, and — the part that matters — every arithmetic claim is computed
 * rather than written. A model cannot be trusted with "20 + 30 is 50"
 * (that is the whole reason lib/exercises/arithmetic.ts exists); code can.
 * The tests re-check every generated line through
 * lineIsArithmeticallySafe(), the same gate the character's feedback
 * passes, without modifying it.
 *
 * WHEN IT RUNS: only when the child explicitly asks for a hint. It is not
 * wired to wrong answers, does not read or write the 1|2 attempt counter,
 * and never reaches openerKindFor or the verdict — those are untouched.
 *
 * EXERCISES WITH NO COMPUTATION (rubric, comprehension, tiles): the twin
 * rung is skipped, because there is no structure to build an easier twin
 * from, and the ladder is rephrase -> shrink -> solve together. Code
 * cannot paraphrase Hebrew prose, so `rephrase` there re-presents the
 * question rather than rewording it, and `shrink` points at its first
 * part; this is stated plainly rather than dressed up.
 */

export type RungKind = "rephrase" | "shrink" | "twin" | "solve" | "small-win";

export interface Rung {
  kind: RungKind;
  /** What the character says. */
  say: string;
  /** Only on `small-win`: a question the child actually answers. */
  practice?: { question: string; answer: string; computation: Computation };
}

/** Which rungs this exercise supports, in order. */
export function ladderFor(exercise: Exercise): RungKind[] {
  return hasComputation(exercise)
    ? ["rephrase", "shrink", "twin", "solve", "small-win"]
    : ["rephrase", "shrink", "solve", "small-win"];
}

function hasComputation(exercise: Exercise): boolean {
  const c = exercise.computation;
  return !!c && computeAnswer(c) !== null && c.operands.length >= 2;
}

// ---------------------------------------------------------------- words

const VERB: Record<Operator, string> = {
  "+": "מוסיפים",
  "-": "מורידים",
  "*": "כופלים ב-",
  "/": "מחלקים ל-",
};

const SIGN: Record<Operator, string> = { "+": "+", "-": "-", "*": "×", "/": "÷" };

/** "24 + 37", as the child sees it. */
export function renderComputation(c: Computation): string {
  let out = String(c.operands[0]);
  for (let i = 0; i < c.operators.length; i++) out += ` ${SIGN[c.operators[i]]} ${c.operands[i + 1]}`;
  return out;
}

/** The running total after each step, so every claim can be stated from a
 *  computed number rather than an asserted one. */
function steps(c: Computation): { text: string; total: number }[] {
  const out: { text: string; total: number }[] = [];
  let acc = c.operands[0];
  for (let i = 0; i < c.operators.length; i++) {
    const op = c.operators[i];
    const rhs = c.operands[i + 1];
    const total = computeAnswer({ operands: [acc, rhs], operators: [op] });
    if (total === null) return out;
    out.push({ text: `${acc} ${SIGN[op]} ${rhs} ${"זה"} ${formatAnswer(total)}`, total });
    acc = total;
  }
  return out;
}

// -------------------------------------------------------------- shrink

/**
 * One smaller step out of the problem. A chain gives up its first
 * operation; a two-term sum or difference in the tens gives up its tens;
 * a small sum becomes counting on, which is the strategy the feedback
 * constitution's praise example names.
 */
export function shrinkOf(c: Computation): Computation | null {
  if (c.operators.length >= 2) {
    return { operands: [c.operands[0], c.operands[1]], operators: [c.operators[0]] };
  }
  const [a, b] = c.operands;
  const op = c.operators[0];
  if ((op === "+" || op === "-") && a >= 10 && b >= 10) {
    const tens = { operands: [a - (a % 10), b - (b % 10)], operators: [op] };
    return computeAnswer(tens) === null ? null : tens;
  }
  return null;
}

// ---------------------------------------------------------------- twin

/** Fallbacks that are always valid for their operator. */
const SAFE_TWIN: Record<Operator, [number, number]> = {
  "+": [2, 3],
  "-": [5, 2],
  "*": [2, 3],
  "/": [6, 2],
};

/**
 * The same shape with easier numbers. Derived from the original by pulling
 * each operand down to a single digit, then VALIDATED — a derived twin
 * that would go negative or leave a remainder is replaced by a known-good
 * one for that operator rather than shipped. `offset` gives a second,
 * different twin for the small win so the child is not handed back the one
 * they just watched.
 */
export function twinOf(c: Computation, offset = 0): Computation {
  const operators = [...c.operators];
  const shrinkDigit = (n: number, i: number) => {
    const d = Math.abs(n) % 10;
    const base = d === 0 ? 2 : d > 5 ? d - 4 : d;
    return Math.max(1, base + ((offset + i) % 2));
  };
  const derived = { operands: c.operands.map(shrinkDigit), operators };
  if (isUsableTwin(derived)) return derived;

  // Rebuild left to right from known-good pairs for each operator.
  const safe: number[] = [];
  for (let i = 0; i < operators.length; i++) {
    const [x, y] = SAFE_TWIN[operators[i]];
    if (i === 0) safe.push(x + (offset % 2));
    safe.push(y);
  }
  const rebuilt = { operands: safe, operators };
  return isUsableTwin(rebuilt) ? rebuilt : { operands: [2, 3], operators: ["+" as Operator] };
}

/** Exported so the contract it enforces is testable directly: the guard
 *  protects against future edits to shrinkDigit or SAFE_TWIN, which today
 *  cannot reach it. */
export function isUsableTwin(c: Computation): boolean {
  // Single digits are what make it easier than the original. A contract
  // guard on the two places twins come from (shrinkDigit and SAFE_TWIN),
  // so a later edit to either cannot quietly start producing a "twin"
  // that is no simpler than the problem it is meant to unlock.
  if (c.operands.some((n) => !Number.isInteger(n) || n < 1 || n > 9)) return false;
  // Every intermediate result has to be reachable too — a twin that passes
  // through -1 or 2.5 is a different problem, not an easier one. That is
  // exactly what computeAnswer() already refuses (see arithmetic.ts: it
  // returns null for a negative or fractional result), so asking it about
  // each step in turn IS the check; repeating those conditions here would
  // be dead code that no input can reach.
  let acc = c.operands[0];
  for (let i = 0; i < c.operators.length; i++) {
    const next = computeAnswer({ operands: [acc, c.operands[i + 1]], operators: [c.operators[i]] });
    if (next === null) return false;
    acc = next;
  }
  return true;
}

// ---------------------------------------------------------------- rungs

/**
 * Build one rung. Returns null when this exercise does not have it (the
 * twin on a rubric question), so a caller can simply skip.
 */
export function buildRung(exercise: Exercise, kind: RungKind, gender?: KidGender | null): Rung | null {
  const c = exercise.computation;
  const computational = hasComputation(exercise) && c;

  if (!computational) return buildProseRung(exercise, kind, gender);

  const answer = computeAnswer(c);
  if (answer === null) return buildProseRung(exercise, kind, gender);

  switch (kind) {
    case "rephrase": {
      const [first, ...rest] = c.operands;
      const parts = rest.map((n, i) => `${VERB[c.operators[i]]}${c.operators[i] === "+" || c.operators[i] === "-" ? " " : ""}${n}`);
      return { kind, say: `${neutralInvitation(gender)} מתחילים מ-${first}, ${parts.join(", ")}. כמה יוצא?` };
    }
    case "shrink": {
      const small = shrinkOf(c);
      if (small) {
        const total = computeAnswer(small)!;
        return { kind, say: `בוא נסתכל רק על החלק הראשון: ${renderComputation(small)} זה ${formatAnswer(total)}.` };
      }
      // Nothing smaller to take out: count on from the larger number.
      const [a, b] = c.operands;
      if (c.operators[0] === "+") {
        const from = Math.max(a, b);
        const add = Math.min(a, b);
        return { kind, say: `בוא נסתכל רק על החלק הראשון: מתחילים מ-${from} וסופרים ${add} קדימה.` };
      }
      return { kind, say: `בוא נסתכל רק על החלק הראשון של ${renderComputation(c)}.` };
    }
    case "twin": {
      const twin = twinOf(c);
      const twinSteps = steps(twin);
      const twinAnswer = computeAnswer(twin)!;
      return {
        kind,
        say: `נראה קודם תרגיל קל יותר באותו סוג: ${renderComputation(twin)}. ${twinSteps
          .map((s) => s.text)
          .join(", ")}. אז ${renderComputation(twin)} זה ${formatAnswer(twinAnswer)}. עכשיו נחזור לשלנו.`,
      };
    }
    case "solve": {
      const walk = steps(c);
      return {
        kind,
        say: `${neutralInvitation(gender)} ${walk.map((s) => s.text).join(", ")}. אז ${renderComputation(c)} זה ${formatAnswer(answer)}.`,
      };
    }
    case "small-win": {
      const easy = twinOf(c, 1);
      const easyAnswer = computeAnswer(easy)!;
      return {
        kind,
        say: `עכשיו אחד קל, שלך: כמה זה ${renderComputation(easy)}?`,
        practice: { question: `כמה זה ${renderComputation(easy)}?`, answer: formatAnswer(easyAnswer), computation: easy },
      };
    }
  }
}

/**
 * The no-computation ladder. Code cannot reword Hebrew prose, so these
 * rungs re-present and narrow the question rather than pretending to
 * paraphrase it, and the last one names the strategy instead of handing
 * back a question there is no way to build an easier twin of.
 */
function buildProseRung(exercise: Exercise, kind: RungKind, gender?: KidGender | null): Rung | null {
  const question = exercise.question.replace(/\s+/g, " ").trim();
  const firstPart = question.split(/(?<=[.?!:])\s+/)[0] ?? question;
  switch (kind) {
    case "rephrase":
      return { kind, say: `${neutralInvitation(gender)} נקרא את השאלה שוב, לאט: ${question}` };
    case "shrink":
      return { kind, say: `בוא נסתכל רק על החלק הראשון: ${firstPart}` };
    case "twin":
      return null; // no structure to build an easier twin from
    case "solve":
      return { kind, say: `נפתור ביחד. התשובה היא ${exercise.correctAnswer}.` };
    case "small-win":
      // No new question: the win is naming what the child did that worked.
      return { kind, say: "עברנו על זה ביחד, צעד אחר צעד — זאת בדיוק הדרך." };
  }
}

/** Advance: the next rung after `current`, or null at the end of the
 *  ladder. A ladder that has run out stays run out — the child is never
 *  handed the same rung twice. */
export function nextRung(exercise: Exercise, current: RungKind | null): RungKind | null {
  const ladder = ladderFor(exercise);
  if (current === null) return ladder[0] ?? null;
  const i = ladder.indexOf(current);
  return i < 0 || i + 1 >= ladder.length ? null : ladder[i + 1];
}
