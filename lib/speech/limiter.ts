/**
 * A first-in-first-out concurrency limiter. No imports, so it is testable
 * without a DOM.
 *
 * WHY THIS EXISTS. Cartesia rejects concurrent requests beyond the plan's
 * limit with `429 concurrency_limited`, and our /api/tutor `speak` route
 * turns every upstream failure into `502 tts_failed`. An exercise screen
 * used to fire five warm-up prefetches at once on mount. Measured
 * 2026-09-20 against the real API, prefetching before that burst existed
 * (2 lines) failed 0/16 requests; with 5 lines at once, 6/40 (15%). A
 * failed prefetch is silent, but it costs the child the cache hit the
 * prefetch was there to buy, and it competes with the live line for the
 * same account-wide limit.
 *
 * The limiter caps how many prefetches are in flight; it does NOT touch
 * live speaks, which must never queue behind a warm-up.
 */
export interface Limiter {
  /** Runs `task` when a slot is free. The slot is held until the returned
   *  promise settles — including on rejection or a synchronous throw, so a
   *  failing task can never leak a slot and starve the queue. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Tasks currently holding a slot. */
  readonly active: number;
  /** Tasks waiting for one. */
  readonly queued: number;
}

export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1) throw new Error(`limiter max must be a positive integer, got ${max}`);
  let active = 0;
  const waiting: (() => void)[] = [];

  const pump = () => {
    while (active < max && waiting.length > 0) {
      active++;
      waiting.shift()!();
    }
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          let running: Promise<T>;
          try {
            running = task();
          } catch (err) {
            running = Promise.reject(err);
          }
          running.then(resolve, reject).finally(() => {
            active--;
            pump();
          });
        });
        pump();
      });
    },
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
  };
}
