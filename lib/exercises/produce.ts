import { QualityGateError } from "@/lib/authoring/quality-gate";
import { TopicFitError } from "./generate";
import { FormatFitError } from "./format-fit";
import { OperationScopeError } from "./operation-scope";
import type { Exercise } from "./types";

/**
 * What the route does when the bank had nothing to serve and a fresh
 * exercise must be generated — and what it does when the content checks
 * refuse every draft.
 *
 *   1. generate (generateExercise already retries its drafts internally);
 *   2. if every draft was refused by a CONTENT CHECK, generate once more;
 *   3. still refused: a vetted template for this topic, if there is one
 *      (Ministry questions that pass every check);
 *   4. otherwise "try again" — the child is told honestly, and nothing is
 *      served.
 *
 * What is gone, deliberately (owner, 2026-09-26): the old last resort served
 * an UNCHECKED bank row when the checks refused everything. No path here, or
 * anywhere, serves an unchecked row.
 *
 * A failure that is not a content check (the model, the network) is not
 * retried here; it propagates, as before.
 */

export type Produced =
  | { kind: "generated"; exercise: Exercise; retried: boolean }
  | { kind: "template"; template: Omit<Exercise, "id">; reason: string }
  | { kind: "try_again"; reason: string };

/** A draft refused by one of the content checks, as opposed to a fault. */
export function isCheckRejection(err: unknown): boolean {
  return err instanceof TopicFitError || err instanceof FormatFitError || err instanceof OperationScopeError || err instanceof QualityGateError;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function produceExercise(
  generate: () => Promise<Exercise>,
  template: () => Omit<Exercise, "id"> | null
): Promise<Produced> {
  try {
    return { kind: "generated", exercise: await generate(), retried: false };
  } catch (first) {
    if (!isCheckRejection(first)) throw first;
    try {
      return { kind: "generated", exercise: await generate(), retried: true };
    } catch (second) {
      if (!isCheckRejection(second)) throw second;
      const t = template();
      if (t) return { kind: "template", template: t, reason: message(second) };
      return { kind: "try_again", reason: message(second) };
    }
  }
}
