/**
 * What the character does when a kid goes quiet in an answer window
 * (feat: local UX wins item 2). The TIMING lives in lib/voice/silenceNudge.ts;
 * this file is only the WHAT, kept apart so the copy can be reviewed and
 * switched on without touching any mechanism.
 *
 * The visual lean-in ships ENABLED — it is not language.
 * The spoken line ships DISABLED.
 */

/** The character leans toward the kid. Presentation only, no copy. */
export const SILENCE_NUDGE_LEANS = true;

/**
 * ⚠ NOT SHIPPED — UDI COPY REVIEW REQUIRED BEFORE THIS IS EVER ENABLED.
 *
 * `SILENCE_NUDGE_SPEAKS` is false, so nothing below is ever spoken or
 * shown. The line is a placeholder taken from the brief's example
 * ("רוצה רמז?") so the mechanism can be exercised; it is NOT approved copy.
 * Two things Udi should look at before it can be used:
 *
 *  1. Grammar rule 3 in lib/guide/lines.ts. "רוצה" is written identically
 *     for a boy and a girl but pronounced differently (rotze / rotza), and
 *     TTS has to pick one — the exact class of form that file bans,
 *     because it misgenders half the kids. A gender-aware or
 *     gender-neutral wording is needed.
 *  2. The line promises a hint, and there is no hint action before an
 *     answer exists: hints today only follow a wrong answer. Either the
 *     wording changes or a hint affordance has to exist first.
 */
export const SILENCE_NUDGE_LINE = "רוצה רמז?";

/** Ships false. Flip only after Udi has approved SILENCE_NUDGE_LINE. */
export const SILENCE_NUDGE_SPEAKS = false;

/** What a nudge should do, as a pure function of the flags above. */
export function silenceNudgeActions(): { lean: boolean; speak: string | null } {
  return {
    lean: SILENCE_NUDGE_LEANS,
    speak: SILENCE_NUDGE_SPEAKS ? SILENCE_NUDGE_LINE : null,
  };
}
