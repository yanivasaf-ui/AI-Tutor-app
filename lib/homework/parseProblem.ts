import { computeAnswer, type Computation, type Operator } from "@/lib/exercises/arithmetic";
import { tokenize } from "@/lib/voice/matchAnswer";

/**
 * What a parent typed, turned into something the homework prototype can
 * either work through or politely decline.
 *
 * Three outcomes, and the boundaries between them are the whole job:
 *
 *  - `arithmetic`  a computation the character can walk a child through.
 *  - `asking-for-answer`  a request for the tutor to DO the homework.
 *    Declined on purpose: the entire point of this mode is that the child
 *    produces the answer. This is a separate outcome from "not maths"
 *    because it deserves a different, non-confusing reply.
 *  - `not-math`  everything else, declined politely and by name.
 *
 * THE LINE THAT MATTERS, stated because it is not obvious: "כמה זה 24 + 37?"
 * is a PROBLEM, even though it is literally a question asking for an
 * answer — that is simply how an arithmetic exercise is written. What is
 * declined is a request aimed at the TUTOR: "תגיד לי את התשובה",
 * "תפתור לי את זה". The difference is an imperative directed at the
 * helper, not the presence of a question mark.
 *
 * Reuses lib/voice/matchAnswer.ts's tokenizer (read-only here) so a
 * problem written in Hebrew words — "עשרים ועוד שלושים" — parses exactly
 * like "20 + 30", and lib/exercises/arithmetic.ts to decide whether the
 * expression is one this app can actually evaluate. Neither is modified.
 */

export type ParsedProblem =
  | { kind: "arithmetic"; computation: Computation; answer: number; canonical: string }
  | { kind: "asking-for-answer" }
  | { kind: "not-math"; reason: "no-expression" | "unsupported-result" };

/**
 * Imperatives aimed at the helper. Each is a verb of giving or solving —
 * it is the request that is declined, not the arithmetic that may sit
 * beside it, so these are checked before anything is parsed.
 */
const ANSWER_DEMANDS: RegExp[] = [
  /תגיד(י)?\s+(לי\s+)?(את\s+)?(ה)?תשובה/,
  /תן\s+לי\s+(את\s+)?(ה)?תשובה/,
  /תני\s+לי\s+(את\s+)?(ה)?תשובה/,
  /מה\s+(ה)?תשובה/,
  /תפתור|תפתרי|פתור|פתרי/,
  /תעשה\s+(לי|בשבילי)|תעשי\s+(לי|בשבילי)/,
  /עשה\s+(לי|בשבילי)|עשי\s+(לי|בשבילי)/,
  /פשוט\s+תגיד/,
  /בשבילי/,
];

export function isAskingForTheAnswer(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return ANSWER_DEMANDS.some((re) => re.test(t));
}

const OPERATORS = new Set<string>(["+", "-", "*", "/"]);

/**
 * The longest run of `number (operator number)+` in the text.
 *
 * Longest rather than first, so a problem introduced by a stray number —
 * "תרגיל 3: 24 + 37" — is read as the expression and not as the 3.
 */
export function extractExpression(text: string): Computation | null {
  const tokens = tokenize(text);
  let best: Computation | null = null;

  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+$/.test(tokens[i])) continue;
    const operands = [Number(tokens[i])];
    const operators: Operator[] = [];
    let j = i + 1;
    while (j + 1 < tokens.length && OPERATORS.has(tokens[j]) && /^\d+$/.test(tokens[j + 1])) {
      operators.push(tokens[j] as Operator);
      operands.push(Number(tokens[j + 1]));
      j += 2;
    }
    if (operators.length === 0) continue;
    if (!best || operators.length > best.operators.length) best = { operands, operators };
  }
  return best;
}

/** "24 + 37", as the child will see it written back. */
export function renderExpression(c: Computation): string {
  const sign: Record<Operator, string> = { "+": "+", "-": "-", "*": "×", "/": "÷" };
  let out = String(c.operands[0]);
  for (let i = 0; i < c.operators.length; i++) out += ` ${sign[c.operators[i]]} ${c.operands[i + 1]}`;
  return out;
}

export function parseHomeworkProblem(text: string): ParsedProblem {
  if (isAskingForTheAnswer(text)) return { kind: "asking-for-answer" };

  const computation = extractExpression(text);
  if (!computation) return { kind: "not-math", reason: "no-expression" };

  // computeAnswer owns what this app can evaluate: it refuses a division
  // with a remainder, a negative result and anything non-integer. A
  // problem it cannot evaluate is one the character cannot walk a child
  // through honestly, so it is declined rather than guessed at.
  const answer = computeAnswer(computation);
  if (answer === null) return { kind: "not-math", reason: "unsupported-result" };

  return { kind: "arithmetic", computation, answer, canonical: renderExpression(computation) };
}
