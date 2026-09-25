import { allowedOperations, OPERATION_NAMES_HE, type Operation } from "@/lib/map/topics";
import type { Exercise, Grade } from "./types";

/**
 * Topic integrity for operations: an exercise may only use the operations
 * its topic allows (lib/map/topics.ts `operations`, the one source of
 * truth). Checked at admission (generate.ts) and serving (store.ts).
 *
 * 2026-09-25 acceptance case: the free-practice picker told a grade-א kid
 * there is no division, while generation — which chose its exercise shape
 * at random, blind to the topic — had filled every grade-א topic's bank
 * with division ("חלקו את המשולשים ל-3 קבוצות שוות" under shapes). Both
 * sides now read the same declaration.
 *
 * This is NOT lifted by the topic-fit escape hatch (store.ts
 * ignoreTopicFit): that hatch trades topic vocabulary for having something
 * to serve; serving an operation the grade doesn't teach is the
 * contradiction this module exists to end.
 */

const HE = "א-ת";
const PFX = "הובלמשכ";
const word = (alts: string) => new RegExp(`(?:^|[^${HE}])[${PFX}]{0,2}(?:${alts})(?![${HE}])`, "u");

const DIVISION_WORDS = word("חילוק|לחלק|חלקו|חלקי|מחלק|מחלקת|מחלקים|נחלק|תחלק|יחלק|יחולקו|חולקו|שווה בשווה");
const MULTIPLICATION_WORDS = word("כפל|כפול|כפולה|כפולות|מכפלה|פי \\d+");

export function operationsUsed(ex: Exercise): Set<Operation> {
  const used = new Set<Operation>();
  for (const o of ex.computation?.operators ?? []) {
    if (o === "+") used.add("add");
    if (o === "-") used.add("sub");
    if (o === "*") used.add("mul");
    if (o === "/") used.add("div");
  }
  if (ex.subtype === "visual_grouping") used.add("div");
  const text = [ex.question, ex.passage ?? ""].join(" ").replace(/[֑-ׇֽֿׁׂׅׄ]/g, "");
  if (/÷/.test(text) || DIVISION_WORDS.test(text)) used.add("div");
  if (/×/.test(text) || /\d\s*\*\s*\d/.test(text) || MULTIPLICATION_WORDS.test(text)) used.add("mul");
  // A pick_operation that OFFERS an operation presents it to the child as
  // something that exists here, whether or not it is the answer.
  if (ex.subtype === "pick_operation") {
    for (const c of ex.choices ?? []) {
      for (const [op, name] of Object.entries(OPERATION_NAMES_HE) as [Operation, string][]) {
        if (c.includes(name)) used.add(op);
      }
    }
  }
  return used;
}

export interface ScopeResult {
  ok: boolean;
  outOfScope: Operation[];
  allowed: Operation[];
}

export function operationScope(ex: Exercise, topicId: string | undefined, grade: Grade = ex.grade): ScopeResult {
  if (ex.subject !== "math") return { ok: true, outOfScope: [], allowed: [] };
  const allowed = allowedOperations(topicId, grade);
  const outOfScope = [...operationsUsed(ex)].filter((o) => !allowed.includes(o));
  return { ok: outOfScope.length === 0, outOfScope, allowed };
}

/** A draft that uses an operation its topic does not teach. */
export class OperationScopeError extends Error {
  readonly outOfScope: Operation[];
  readonly allowed: Operation[];
  constructor(scope: ScopeResult, question: string) {
    super(`draft uses ${scope.outOfScope.join(", ")} — allowed here: ${scope.allowed.join(", ")}. Question: "${question}"`);
    this.name = "OperationScopeError";
    this.outOfScope = scope.outOfScope;
    this.allowed = scope.allowed;
  }
}

/** Hebrew names for a list of operations, joined for a prompt. */
export function operationNames(ops: readonly Operation[]): string {
  return ops.map((o) => OPERATION_NAMES_HE[o]).join(", ");
}

/** Internal model instruction after an out-of-scope draft. */
export function operationScopeRetryHint(err: OperationScopeError): string {
  return `התרגיל הקודם נדחה: הוא השתמש ב${operationNames(err.outOfScope)}, שלא נלמד/ים בנושא הזה. מותר להשתמש רק ב: ${operationNames(err.allowed)}.`;
}
