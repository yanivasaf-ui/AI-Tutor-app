import { computeAnswer, lineIsArithmeticallySafe, type Computation, type Operator } from "@/lib/exercises/arithmetic";
import { renderExpression } from "./parseProblem";
import * as copy from "./lines";

/**
 * Walking a child through their own homework, without ever doing it.
 *
 * THE ONE INVARIANT: the character never says the final answer until the
 * child has produced it. Everything here is arranged so that this is a
 * property of the code rather than a hope about a prompt — the steps are
 * derived from the computation, every number the character says is
 * computed, and the final value appears in exactly one line
 * (`copy.solved`) which is reachable only from the state the child's own
 * correct answer moves us into.
 *
 * WHY NO MODEL. A model asked to be Socratic will, sooner or later, be
 * helpful and give the answer — and there is no way to test that it will
 * not. A deterministic walk can be tested exhaustively, which is exactly
 * what tests/homework-socratic.test.mts does: it drives whole sessions
 * with nothing but wrong answers and asserts the final number never
 * appears.
 *
 * The steps, by shape of problem:
 *   chained (a ⊕ b ⊕ c)  one step per operation, left to right, which is
 *                        the order lib/exercises/arithmetic.ts evaluates in
 *   two-digit + or -     tens, then units, then the whole thing
 *   anything else        one step: the problem itself
 *
 * The last step is ALWAYS the whole problem, so the number the child
 * finally produces is the answer to their homework and not to a fragment
 * of it.
 *
 * lib/exercises/arithmetic.ts is used, never modified: computeAnswer
 * produces every number, and lineIsArithmeticallySafe re-checks every line
 * before it is handed back.
 */

export interface Step {
  /** The expression this step asks about, e.g. "20 + 30". */
  expression: string;
  /** Its value, computed — never written by hand. */
  value: number;
  /** True for the step whose value is the answer to the whole problem. */
  final: boolean;
}

export type Phase = "asking" | "solved";

export interface SessionState {
  computation: Computation;
  canonical: string;
  answer: number;
  steps: Step[];
  index: number;
  /** Wrong answers at the CURRENT step. Resets on advancing. */
  attempts: number;
  phase: Phase;
  /** Steps the child has already solved, for `recall`. */
  solvedParts: string[];
}

/** What the character says after a turn. Ordered, and all of it safe. */
export interface Turn {
  lines: string[];
  state: SessionState;
}

function stepFor(c: Computation): Step[] {
  return collapseIfLeaky(buildSteps(c), computeAnswer(c)!, renderExpression(c));
}

/**
 * A non-final step whose value happens to EQUAL the answer would hand the
 * child the goal while confirming a fragment — "30 - 20 זה 10" when the
 * answer is also 10. That is a degenerate decomposition (there was
 * nothing to take apart), so the whole problem becomes one step instead.
 * Structural, so the invariant never depends on noticing the collision at
 * the moment a line is built.
 */
function collapseIfLeaky(steps: Step[], answer: number, whole: string): Step[] {
  const leaks = steps.some((s) => !s.final && s.value === answer);
  return leaks || steps.length === 0 ? [{ expression: whole, value: answer, final: true }] : steps;
}

function buildSteps(c: Computation): Step[] {
  const whole = renderExpression(c);
  const answer = computeAnswer(c)!;

  // A chain is walked one operation at a time, left to right — the same
  // order the evaluator uses, so no step can disagree with the result.
  if (c.operators.length >= 2) {
    const steps: Step[] = [];
    let acc = c.operands[0];
    for (let i = 0; i < c.operators.length; i++) {
      const rhs = c.operands[i + 1];
      const value = computeAnswer({ operands: [acc, rhs], operators: [c.operators[i]] });
      if (value === null) break;
      const last = i === c.operators.length - 1;
      steps.push({
        expression: `${acc} ${sign(c.operators[i])} ${rhs}`,
        value,
        // The last operation's value IS the answer, but the child should
        // meet the whole problem at the end, so it is asked as `whole`.
        final: last,
      });
      acc = value;
    }
    if (steps.length > 0) {
      steps[steps.length - 1] = { expression: whole, value: answer, final: true };
      return steps;
    }
  }

  // Two-digit addition or subtraction: tens, then units, then all of it.
  const [a, b] = c.operands;
  const op = c.operators[0];
  if (c.operands.length === 2 && (op === "+" || op === "-") && a >= 10 && b >= 10) {
    const tens = computeAnswer({ operands: [a - (a % 10), b - (b % 10)], operators: [op] });
    const units = computeAnswer({ operands: [a % 10, b % 10], operators: [op] });
    // No `units !== 0` check: if both units were 0 the tens step would
    // equal the answer, and collapseIfLeaky has already thrown the
    // decomposition away. Repeating it here would be unreachable.
    if (tens !== null && units !== null) {
      return [
        { expression: `${a - (a % 10)} ${sign(op)} ${b - (b % 10)}`, value: tens, final: false },
        { expression: `${a % 10} ${sign(op)} ${b % 10}`, value: units, final: false },
        { expression: whole, value: answer, final: true },
      ];
    }
  }

  return [{ expression: whole, value: answer, final: true }];
}

function sign(op: Operator): string {
  return ({ "+": "+", "-": "-", "*": "×", "/": "÷" } as Record<Operator, string>)[op];
}

export function startSession(computation: Computation): Turn {
  const answer = computeAnswer(computation);
  if (answer === null) throw new Error("startSession called with a computation this app cannot evaluate");
  const canonical = renderExpression(computation);
  const steps = stepFor(computation);
  const state: SessionState = {
    computation, canonical, answer, steps, index: 0, attempts: 0, phase: "asking", solvedParts: [],
  };
  return guardTurn({ lines: [copy.opening(canonical), question(state)], state });
}

function question(state: SessionState): string {
  const step = state.steps[state.index];
  return step.final ? copy.askFinal(state.canonical) : copy.askStep(step.expression);
}

/** Numbers only, compared as numbers so "05" and "5" agree. */
function given(input: string): number | null {
  const t = input.trim().replace(/[^\d-]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The child answered the current step.
 *
 * Right: confirm THIS step and move on — or, on the final step, say the
 * answer for the first and only time. Wrong: a neutral invitation and a
 * question about strategy. Never the number, at any point, for any step
 * the child has not produced.
 */
export function submitStep(state: SessionState, input: string): Turn {
  if (state.phase === "solved") return guardTurn({ lines: [], state });

  const step = state.steps[state.index];
  const value = given(input);

  if (value !== null && value === step.value) {
    if (step.final) {
      return guardTurn({
        lines: [copy.solved(state.canonical, state.answer)],
        state: { ...state, phase: "solved", attempts: 0 },
      });
    }
    const next: SessionState = {
      ...state,
      index: state.index + 1,
      attempts: 0,
      solvedParts: [...state.solvedParts, `${step.expression} = ${step.value}`],
    };
    return guardTurn({ lines: [copy.stepConfirmed(step.expression, step.value), question(next)], state: next });
  }

  const attempts = state.attempts + 1;
  const wrongState: SessionState = { ...state, attempts };
  const lines = [copy.WRONG_INVITATIONS[Math.min(attempts - 1, copy.WRONG_INVITATIONS.length - 1)]];

  // A struggling child is given more structure, never the goal. On the
  // final step that means their own confirmed results read back — which
  // contains no number they have not already found themselves.
  if (attempts >= 2 && step.final && wrongState.solvedParts.length > 0) {
    lines.push(copy.recall(wrongState.solvedParts));
  } else {
    lines.push(copy.STRATEGY_QUESTIONS[state.computation.operators[Math.min(state.index, state.computation.operators.length - 1)]] ?? copy.STRATEGY_QUESTIONS["+"]);
  }
  lines.push(question(wrongState));
  return guardTurn({ lines, state: wrongState });
}

/**
 * The last thing every turn passes through.
 *
 * Two checks, both on lines that are about to be shown to a child:
 *  1. the existing arithmetic gate, unmodified — nothing may assert a sum
 *     that is not true;
 *  2. the invariant this mode exists for — while the phase is `asking`,
 *     no line may contain the final answer as a standalone number.
 *
 * A violation is a bug in this file, so it throws rather than degrading
 * quietly: a prototype that silently starts handing out answers is worse
 * than one that fails loudly in a test.
 */
export function guardTurn(turn: Turn): Turn {
  for (const line of turn.lines) {
    if (!lineIsArithmeticallySafe(line, turn.state.answer, turn.state.computation)) {
      throw new Error(`homework line failed the arithmetic gate: ${line}`);
    }
    if (turn.state.phase === "asking" && revealsAnswer(line, turn.state)) {
      throw new Error(`homework line revealed the answer before the child produced it: ${line}`);
    }
  }
  return turn;
}

/** The number as a standalone token, so 1 does not match 15 or 21. */
export function containsNumber(text: string, n: number): boolean {
  return new RegExp(`(?<!\\d)${n}(?!\\d)`).test(text);
}

/**
 * Does this line TELL the child the answer?
 *
 * Not the same question as "does the answer appear in it". A trivial
 * problem contains its own answer among its operands — "6 + 0 + 0" — and
 * writing the problem back is not giving anything away. So the expressions
 * the character is entitled to restate are removed first, and only what is
 * left counts. Anything asserting the answer outside them ("התשובה היא 61",
 * or a confirmation of a step that should not have been confirmed yet) has
 * nowhere to hide.
 */
export function revealsAnswer(line: string, state: SessionState): boolean {
  let rest = line;
  for (const expression of [state.canonical, ...state.steps.map((s) => s.expression)]) {
    rest = rest.split(expression).join(" ");
  }
  return containsNumber(rest, state.answer);
}
