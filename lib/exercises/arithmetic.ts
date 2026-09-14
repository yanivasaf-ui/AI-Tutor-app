import { tokenize } from "@/lib/voice/matchAnswer";

/**
 * The deterministic arithmetic core: the ONLY place in this app allowed to
 * decide what the answer to a computation is.
 *
 * Why this exists (2026-09-14, production bug): the character stated "14"
 * for a displayed 10×4. Until now, arithmetic was LLM-trusted end to end —
 * lib/exercises/generate.ts asked the model for a question AND its
 * correctAnswer as free text and shipped whatever came back unchecked, and
 * lib/exercises/evaluate.ts then fed that string to a second model call
 * that both judged the kid and (on a second miss) was told to state the
 * answer in its own words. Two independent paths could put a wrong number
 * in a child's ear, and nothing in code could tell.
 *
 * The rule now: a computation exercise carries a STRUCTURED spec
 * (operands + operators). Code computes the result from that spec, code
 * checks the displayed question really says that computation, and code
 * checks every arithmetic claim in anything the character says. A model
 * never computes, and never restates, arithmetic.
 */

export type Operator = "+" | "-" | "*" | "/";

/**
 * `operands[0] op[0] operands[1] op[1] operands[2] ...`, evaluated strictly
 * left to right.
 *
 * Left-to-right is only mathematically safe while the operators can't
 * disagree with precedence, so isValidComputation() forbids the one case
 * where they could: mixing +/- with ×/÷ in a single exercise. A × or ÷
 * exercise is a single operation; + and - may chain (equal precedence,
 * left-associative, so left-to-right IS the correct reading).
 */
export interface Computation {
  operands: number[];
  operators: Operator[];
}

const OPERATOR_CHARS: Record<string, Operator> = {
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
};

/** Unicode math signs and Hebrew-style separators → the ASCII operators,
 *  and 1,234 → 1234 so a thousands separator can't split a number. */
export function normalizeMathText(text: string): string {
  return text
    .replace(/[×✕✖·]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[–—−]/g, "-")
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
}

export function isOperator(v: unknown): v is Operator {
  return typeof v === "string" && v in OPERATOR_CHARS;
}

/** Structurally sound, and inside what grades א-ג actually do. */
export function isValidComputation(c: Computation): boolean {
  const { operands, operators } = c;
  if (!Array.isArray(operands) || !Array.isArray(operators)) return false;
  if (operands.length < 2 || operators.length !== operands.length - 1) return false;
  if (!operands.every((n) => Number.isInteger(n) && n >= 0 && n <= 1_000_000)) return false;
  if (!operators.every(isOperator)) return false;
  const hasMulDiv = operators.some((o) => o === "*" || o === "/");
  // Mixed precedence would make left-to-right the wrong reading.
  if (hasMulDiv && operators.length !== 1) return false;
  return computeAnswer(c) !== null;
}

/**
 * The answer, or null when the computation isn't one this app should ever
 * show a 6-9 year old: division by zero, a remainder, or a negative result.
 */
export function computeAnswer(c: Computation): number | null {
  const { operands, operators } = c;
  if (!Array.isArray(operands) || !Array.isArray(operators)) return null;
  if (operands.length < 2 || operators.length !== operands.length - 1) return null;
  let acc = operands[0];
  if (!Number.isFinite(acc)) return null;
  for (let i = 0; i < operators.length; i++) {
    const b = operands[i + 1];
    if (!Number.isFinite(b)) return null;
    switch (operators[i]) {
      case "+":
        acc = acc + b;
        break;
      case "-":
        acc = acc - b;
        break;
      case "*":
        acc = acc * b;
        break;
      case "/":
        if (b === 0 || acc % b !== 0) return null;
        acc = acc / b;
        break;
      default:
        return null;
    }
  }
  if (!Number.isInteger(acc) || acc < 0) return null;
  return acc;
}

/** Parses the model's JSON payload into a Computation, or null. */
export function parseComputation(raw: unknown): Computation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const operands = Array.isArray(r.operands) ? r.operands.map(Number) : null;
  if (!operands) return null;
  // Accept both "operators": ["+"] and the single-operation "operator": "+".
  const operators = Array.isArray(r.operators)
    ? r.operators.map(String)
    : typeof r.operator === "string"
      ? [r.operator]
      : null;
  if (!operators) return null;
  const normalized = operators.map((o) => {
    const n = normalizeMathText(o).trim();
    return isOperator(n) ? n : null;
  });
  if (normalized.some((o) => o === null)) return null;
  const c: Computation = { operands, operators: normalized as Operator[] };
  return isValidComputation(c) ? c : null;
}

/** The numbers and operators of a text, in the order they appear. */
function mathTokens(text: string): (number | Operator)[] {
  const out: (number | Operator)[] = [];
  const re = /(\d+)|([+\-*/])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalizeMathText(text))) !== null) {
    if (m[1] !== undefined) out.push(Number(m[1]));
    else out.push(OPERATOR_CHARS[m[2]]);
  }
  return out;
}

/**
 * Does the question the child actually SEES state this exact computation?
 *
 * This is the join between the rendered text and the verified number: a
 * spec of 10×4 attached to a question that reads "10 + 4" would otherwise
 * let code "verify" 40 for a question whose answer is 14. The operand and
 * operator sequence must appear contiguously, in order, in the question.
 */
export function questionStatesComputation(question: string, c: Computation): boolean {
  const want: (number | Operator)[] = [];
  c.operands.forEach((n, i) => {
    want.push(n);
    if (i < c.operators.length) want.push(c.operators[i]);
  });
  const got = mathTokens(question);
  for (let i = 0; i + want.length <= got.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length; j++) {
      if (got[i + j] !== want[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** "40", for injecting into a line. */
export function formatAnswer(n: number): string {
  return String(n);
}

// ---- Guarding what the character says -----------------------------------

/** Words that introduce a result, in the character's Hebrew. */
const RESULT_WORDS = new Set(["זה", "שווה", "יוצא", "מקבלים", "התוצאה", "="]);

/**
 * matchAnswer's tokenizer reads "ארבע עשרה" (fourteen) as two numbers,
 * 4 and 10 — it handles "עשרים ושתיים"-style compounds but not teens.
 * Adjacent <1-9> followed by 10, with no operator between them, is a teen.
 */
function joinHebrewTeens(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = Number(tokens[i]);
    const b = Number(tokens[i + 1]);
    if (/^\d+$/.test(tokens[i]) && /^\d+$/.test(tokens[i + 1] ?? "") && a >= 1 && a <= 9 && b === 10) {
      out.push(String(10 + a));
      i++;
      continue;
    }
    out.push(tokens[i]);
  }
  return out;
}

export interface ArithmeticClaim {
  /** The operands/operators asserted, and the value asserted for them. */
  computation: Computation;
  claimed: number;
  truth: number;
}

/**
 * Every arithmetic claim a line makes, symbolic or spelled out in Hebrew.
 *
 * Runs over lib/voice/matchAnswer.ts's tokenizer, which already maps
 * Hebrew number words to digits and Hebrew operator words to symbols
 * ("20 ועוד 30 זה 50" → 20 + 30 ... 50), so a claim the character SPEAKS
 * is checked in the same form a child hears it — not just the symbolic
 * form a naive regex would catch.
 */
export function arithmeticClaimsIn(text: string): ArithmeticClaim[] {
  const tokens = joinHebrewTeens(tokenize(normalizeMathText(text)));
  const claims: ArithmeticClaim[] = [];

  let i = 0;
  while (i < tokens.length) {
    if (!/^\d+$/.test(tokens[i])) {
      i++;
      continue;
    }
    // Longest run of "number (op number)+" starting here.
    const operands: number[] = [Number(tokens[i])];
    const operators: Operator[] = [];
    let j = i + 1;
    while (j + 1 < tokens.length && isOperator(tokens[j]) && /^\d+$/.test(tokens[j + 1])) {
      operators.push(tokens[j] as Operator);
      operands.push(Number(tokens[j + 1]));
      j += 2;
    }
    if (operators.length === 0) {
      i++;
      continue;
    }
    // The asserted result follows the expression, introduced by a result
    // word — possibly with a little filler in between ("זה בדיוק 50").
    // Requiring a result word is what stops an unrelated neighbouring
    // number from being read as a claim.
    let k = j;
    let sawResultWord = false;
    let skipped = 0;
    while (k < tokens.length && skipped < 4 && !/^\d+$/.test(tokens[k])) {
      if (RESULT_WORDS.has(tokens[k])) sawResultWord = true;
      k++;
      skipped++;
    }
    if (sawResultWord && k < tokens.length && /^\d+$/.test(tokens[k])) {
      const computation: Computation = { operands, operators };
      const truth = computeAnswer(computation);
      if (truth !== null) claims.push({ computation, claimed: Number(tokens[k]), truth });
    }
    i = j;
  }
  return claims;
}

/** Any arithmetic the line asserts that is simply false. */
export function falseClaimsIn(text: string): ArithmeticClaim[] {
  return arithmeticClaimsIn(text).filter((c) => c.claimed !== c.truth);
}

/**
 * Does the line state a final answer that contradicts the verified one?
 * Catches "התשובה הנכונה היא 14" where the answer is 40, which no
 * claim-checker would flag (nothing is being computed, just asserted).
 */
export function statesWrongAnswer(text: string, answer: number): boolean {
  const normalized = normalizeMathText(text);
  const re = /התשובה[^0-9]{0,40}?(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    if (Number(m[1]) !== answer) return true;
  }
  return false;
}

/**
 * Place-value vocabulary the guard checks the same way it checks numbers
 * (2026-09-14, FIX 3: a real guard sweep line said "עשיריות" — tenths —
 * where "עשרות" — tens — was meant; one letter apart, a completely wrong
 * concept). `magnitude` is the power of ten the word names; negative =
 * a fraction of one.
 */
const MATH_TERMS: { word: string; magnitude: number }[] = [
  { word: "יחידות", magnitude: 0 },
  { word: "יחידה", magnitude: 0 },
  { word: "עשרות", magnitude: 1 },
  { word: "עשרה", magnitude: 1 },
  { word: "מאות", magnitude: 2 },
  { word: "מאה", magnitude: 2 },
  { word: "אלפים", magnitude: 3 },
  { word: "אלף", magnitude: 3 },
  { word: "עשיריות", magnitude: -1 },
  { word: "עשירית", magnitude: -1 },
  { word: "מאיות", magnitude: -2 },
  { word: "מאית", magnitude: -2 },
  { word: "אלפיות", magnitude: -3 },
  { word: "אלפית", magnitude: -3 },
];
/** Same one-Hebrew-prefix-letter allowance matchTopic.ts uses ("העשרות",
 *  "לעשרות", "מהיחידות" ...) so a real sentence's grammar doesn't hide the
 *  term from the scan. */
const TERM_PREFIXES = "והבלמשכ";

interface MathTermMention {
  word: string;
  magnitude: number;
}

function mathTermMentionsIn(text: string): MathTermMention[] {
  const found: MathTermMention[] = [];
  for (const raw of tokenize(normalizeMathText(text))) {
    const w = TERM_PREFIXES.includes(raw[0]) ? raw.slice(1) : raw;
    const term = MATH_TERMS.find((m) => m.word === raw || m.word === w);
    if (term) found.push({ word: raw, magnitude: term.magnitude });
  }
  return found;
}

/** How many digits before the decimal point `n` has — 42 -> magnitude 1
 *  (its highest whole place is tens), 100 -> 2, 7 -> 0. */
function wholeMagnitude(n: number): number {
  return Math.max(0, String(Math.trunc(Math.abs(n))).length - 1);
}

/**
 * Place-value terms in `text` that don't fit `computation` — the same
 * "wrong word for this exercise" idea as falseClaimsIn, for vocabulary
 * instead of numbers. Two ways a term can be wrong:
 * - it names a FRACTION of one (עשיריות/מאיות/אלפית) — this app's whole
 *   curriculum is natural numbers (lib/map/topics.ts), so these are wrong
 *   in every line, computation or not;
 * - it names a whole place (מאות/אלפים) bigger than anything the
 *   computation's operands OR its result actually reach — "מאות" for
 *   25 + 17 (=42), where nothing involved ever has a hundreds digit.
 *   Skipped when `computation` is unavailable (nothing to check against).
 */
export function wrongMathTermsIn(text: string, computation?: Computation | null): MathTermMention[] {
  const mentions = mathTermMentionsIn(text);
  const fractional = mentions.filter((m) => m.magnitude < 0);
  if (!computation) return fractional;
  const answer = computeAnswer(computation);
  const maxMagnitude = Math.max(...computation.operands.map(wholeMagnitude), answer === null ? 0 : wholeMagnitude(answer));
  const tooLarge = mentions.filter((m) => m.magnitude >= 0 && m.magnitude > maxMagnitude);
  return [...fractional, ...tooLarge];
}

/**
 * The gate every answer-bearing line passes before the character says it.
 * True = safe to speak: it asserts no false arithmetic, contradicts no
 * verified answer, and uses no place-value word that doesn't fit.
 */
export function lineIsArithmeticallySafe(text: string, answer: number | null, computation?: Computation | null): boolean {
  if (falseClaimsIn(text).length > 0) return false;
  if (answer !== null && statesWrongAnswer(text, answer)) return false;
  if (wrongMathTermsIn(text, computation).length > 0) return false;
  return true;
}

/**
 * Evaluates a plain left-to-right expression like "3 + 4 - 2", or null when
 * it isn't one this module is willing to vouch for (mixed precedence, a
 * stray token, a non-integer or negative result). Used to check equations
 * rather than to produce answers.
 */
export function evaluateLinearExpression(text: string): number | null {
  const tokens = mathTokens(text);
  if (tokens.length === 0 || tokens.length % 2 === 0) return null;
  const operands: number[] = [];
  const operators: Operator[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i % 2 === 0) {
      if (typeof t !== "number") return null;
      operands.push(t);
    } else {
      if (typeof t === "number") return null;
      operators.push(t);
    }
  }
  // A bare side of an equation ("= 7") is one operand and no operator —
  // a valid expression, even though it isn't a valid Computation.
  if (operators.length === 0) {
    const only = operands[0];
    return Number.isInteger(only) && only >= 0 ? only : null;
  }
  const c: Computation = { operands, operators };
  return isValidComputation(c) ? computeAnswer(c) : null;
}

/**
 * Does `answer` actually balance an equation like "3 + ___ = 7"?
 *
 * equation_balance previously checked only that the answer was one of the
 * offered tiles, which let a tile that doesn't balance the equation ship as
 * the correct one. Both sides get evaluated in code instead.
 *
 * Only the trailing equation CLAUSE is evaluated, not the whole question
 * (2026-09-14, found while seeding the pre-generated bank): a natural word
 * problem states other numbers first ("לאילנה יש 5 משולשים... 5 - ___ = 2"),
 * and mathTokens() has no concept of sentence boundaries — every number in
 * the story got swept into the same token stream as the real equation, so
 * a CORRECTLY-balancing "5 - ___ = 2" was rejected outright as soon as the
 * question had any narrative before it (i.e. almost always, since that's
 * how this subtype is prompted). Splitting on sentence-ending punctuation
 * and evaluating only the last segment isolates the actual equation clause
 * the same way a person reading the question would.
 */
export function balancesEquation(question: string, answer: string): boolean {
  const filled = normalizeMathText(question)
    .replace(/_{2,}|…/g, ` ${answer} `)
    .replace(/\s+/g, " ")
    .trim();
  const clauses = filled.split(/[.?!\n]+/).map((s) => s.trim()).filter(Boolean);
  const equationClause = [...clauses].reverse().find((c) => c.includes("="));
  if (!equationClause) return false;
  const sides = equationClause.split("=");
  if (sides.length !== 2) return false;
  const left = evaluateLinearExpression(sides[0]);
  const right = evaluateLinearExpression(sides[1]);
  if (left === null || right === null) return false;
  return left === right;
}
