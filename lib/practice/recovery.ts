/**
 * How the exercise screen recovers when the network or server fails
 * mid-turn — deterministic, and never a raw error in front of the child
 * (QA 2026-09-26, grade ב משחקים במילים: after a CORRECT answer the screen
 * showed "משהו השתבש"; its retry re-asked the same question).
 *
 * Two places a turn can fail:
 *
 *  1. Checking an answer. The server streams the verdict first, then the
 *     prose. A failure BEFORE the verdict is retried once, quietly, with
 *     the same answer; if that fails too the answer is kept and the child
 *     can check it again ("unchecked" — never judged wrong). A failure
 *     AFTER the verdict changes nothing: the verdict was shown and spoken,
 *     it stands ("verdict-kept"), and nothing is re-asked.
 *
 *  2. Fetching the next exercise. A fault gets one quiet retry before the
 *     child sees the calm "couldn't build one" state with its retry button.
 *     The session and the topic's progress are untouched either way.
 */

export type CheckOutcome = "ok" | "verdict-kept" | "unchecked" | "superseded";

export async function checkWithRecovery(
  check: () => Promise<void>,
  opts: {
    /** Did a verdict arrive (in either attempt)? */
    sawVerdict: () => boolean;
    /** False once the child has moved on (a new answer, left the screen). */
    stillCurrent: () => boolean;
    retryMs: number;
  }
): Promise<CheckOutcome> {
  try {
    await check();
    return "ok";
  } catch {
    if (opts.sawVerdict()) return "verdict-kept";
  }
  await new Promise((r) => setTimeout(r, opts.retryMs));
  if (!opts.stillCurrent()) return "superseded";
  try {
    await check();
    return "ok";
  } catch {
    return opts.sawVerdict() ? "verdict-kept" : "unchecked";
  }
}

/** A next-exercise fetch's result; only "failed" (a fault) is retried. */
export interface NextResult {
  kind: string;
}

export async function nextWithRetry<T extends NextResult>(fetchNext: () => Promise<T>, retryMs: number): Promise<T> {
  const first = await fetchNext();
  if (first.kind !== "failed") return first;
  await new Promise((r) => setTimeout(r, retryMs));
  return fetchNext();
}
