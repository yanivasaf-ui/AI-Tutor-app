/**
 * HOMEWORK_MODE — off unless explicitly switched on.
 *
 * Read on the server only, and deliberately NOT a NEXT_PUBLIC_ variable:
 * a public flag ships the prototype's existence (and its route) to every
 * browser whether or not it is enabled. Here the page itself does not
 * exist unless the flag is set.
 *
 * Anything other than "1" is off, including "true", "yes" and a typo —
 * an unrecognised value meaning "on" is how a prototype reaches a child
 * by accident.
 */
export function homeworkModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HOMEWORK_MODE === "1";
}
