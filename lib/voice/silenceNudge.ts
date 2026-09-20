/**
 * "Silence gets a response" — the state machine behind the character's
 * gentle lean-in when a kid has gone quiet in an answer window.
 *
 * feat: local UX wins item 2. MECHANISM ONLY: this decides WHEN. What the
 * character does about it (a lean, and — disabled — a spoken line) is
 * decided by lib/guide/nudges.ts and the screen. No network, no speech,
 * no React: a timer and a flag, so it can be tested on a fake clock.
 *
 * The rules:
 *  - The window OPENS when the kid is expected to answer and nothing else
 *    is going on (the character has stopped talking, nothing is being
 *    judged). The clock starts then, not when the exercise appeared — a
 *    kid listening to the question is not being silent.
 *  - Any activity restarts the clock. If a nudge had fired, activity ends
 *    it: the character relaxes, and a later stretch of silence can nudge
 *    again. It never repeats on its own without the kid doing something.
 *  - CLOSING the window (an answer submitted, the screen changing) cancels
 *    the clock and relaxes a nudge that was showing.
 */
export const SILENCE_NUDGE_MS = 8000;

export interface SilenceNudgeOptions {
  onNudge: () => void;
  /** A showing nudge has ended (activity, or the window closed). */
  onRelax: () => void;
  thresholdMs?: number;
  /** Injectable so tests can drive time by hand. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SilenceNudge {
  /** The kid is now expected to answer; start counting silence. */
  open(): void;
  /** Something the kid did: a tap, a drag, a keystroke. */
  activity(): void;
  /** No longer expecting an answer. */
  close(): void;
  readonly nudged: boolean;
  readonly isOpen: boolean;
}

export function createSilenceNudge(opts: SilenceNudgeOptions): SilenceNudge {
  const threshold = opts.thresholdMs ?? SILENCE_NUDGE_MS;
  const now = opts.now ?? (() => Date.now());
  const set =
    opts.setTimer ??
    ((fn: () => void, ms: number) => {
      const h = setTimeout(fn, ms);
      (h as { unref?: () => void }).unref?.();
      return h;
    });
  const clear = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let open = false;
  let nudged = false;
  let handle: unknown = null;
  /** When the kid last did anything. Recording it is a plain assignment,
   *  so a finger dragging (dozens of pointer events a second) costs
   *  nothing — no timer is restarted per event. The timer instead checks
   *  this when it fires and re-arms for whatever silence is still owed,
   *  which also keeps the threshold EXACT: 8s after the last activity,
   *  not 8s after some throttled restart of a timer. */
  let lastActivityAt = 0;

  const stopTimer = () => {
    if (handle !== null) clear(handle);
    handle = null;
  };
  const arm = (ms: number) => {
    stopTimer();
    handle = set(onFire, ms);
  };
  const onFire = () => {
    handle = null;
    if (!open || nudged) return;
    const silentFor = now() - lastActivityAt;
    if (silentFor >= threshold) {
      nudged = true;
      opts.onNudge();
    } else {
      arm(threshold - silentFor); // the kid was active meanwhile: wait out the rest
    }
  };
  const relax = () => {
    if (!nudged) return;
    nudged = false;
    opts.onRelax();
  };

  return {
    open() {
      open = true;
      relax();
      // No need to stamp lastActivityAt here: this arms a full-length timer
      // from now, and whatever stamp exists is by definition no newer than
      // this moment, so the timer's own check can only ever agree with it.
      arm(threshold);
    },
    activity() {
      if (!open) return;
      lastActivityAt = now();
      if (nudged) {
        relax();
        arm(threshold);
      }
    },
    close() {
      open = false;
      stopTimer();
      relax();
    },
    get nudged() {
      return nudged;
    },
    get isOpen() {
      return open;
    },
  };
}
