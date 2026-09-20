/**
 * Overlap turns: fetch the NEXT exercise while the kid is still working on
 * the current one, so "next" is instant instead of a cold round trip.
 *
 * feat: local UX wins item 5. Everything here is about being SAFE, because
 * an exercise fetched early is an exercise chosen with less information:
 *
 *  1. It might be stale. The adaptive level decides what gets built, and
 *     the answer the kid is about to give can change it (a level-up, a drop
 *     after a second miss, the end of the diagnostic). A prefetched
 *     exercise is used ONLY if the level it was built at is still the level
 *     the kid is now at — otherwise it is discarded and the next exercise
 *     is fetched the ordinary way. A wrong-answer path never gets an
 *     exercise built for the wrong level.
 *  2. It might be the exercise already on screen. The server only excludes
 *     exercises the kid has ATTEMPTED, and the current one is not attempted
 *     until it is answered — so without help a background fetch can hand
 *     back the very question the kid is looking at. Every request carries
 *     the ids already served, and a result that repeats one is refused here
 *     too.
 *  3. It must not act on an answer that has not landed. Whether the level
 *     moved is only known once the answer's practice update comes back; if
 *     that has not happened yet the prefetch is not used (zero added wait —
 *     the ordinary path runs immediately).
 *
 * It never touches the verdict, never locks or delays an answer, and adds
 * no traffic beyond one generate_exercise request per exercise, which
 * replaces the one that would have been made after the kid tapped "next".
 *
 * Pure: the network is injected, so all of the above is testable.
 */
import { DEFAULT_LEVEL, type Level, type PracticeSummary } from "@/lib/practice/state";
import type { Exercise } from "./types";

export type NextFetchResult =
  | { kind: "ok"; exercise: Exercise; practice?: PracticeSummary }
  | { kind: "none" } // the topic genuinely has nothing to practice
  | { kind: "failed" };

/**
 * The level a generate_exercise request made in this state gets built at.
 * Mirrors the server's levelForNextExercise (`level ?? DEFAULT_LEVEL`): a
 * kid still being placed is served at the default. `null` when there is no
 * practice state at all (no kid, or no topic), where nothing adapts.
 */
export function effectiveLevel(p: PracticeSummary | null | undefined): Level | null {
  if (!p) return null;
  return p.level ?? DEFAULT_LEVEL;
}

/** Is an exercise built at `builtAt` still right for a kid now at `now`? */
export function levelStillMatches(builtAt: Level | null, now: PracticeSummary | null | undefined): boolean {
  return builtAt === effectiveLevel(now);
}

/** How long a take() will wait on a fetch that is still in flight before
 *  giving up and letting the ordinary path run. */
export const TAKE_WAIT_MS = 5000;

export interface NextPrefetcherDeps {
  /** One generate_exercise request. `excludeIds` = ids already served. */
  fetchNext: (excludeIds: string[], signal: AbortSignal) => Promise<NextFetchResult>;
  /** Called once when a usable exercise has arrived — the place to warm its
   *  speech. Never called for a result that is discarded. */
  onReady?: (exercise: Exercise) => void;
  takeWaitMs?: number;
}

export type PrefetchStatus = "idle" | "inflight" | "ready";

export interface NextPrefetcher {
  /** Begin fetching the exercise that follows `currentId`. Idempotent for
   *  the same current exercise. `practiceNow` is the kid's latest known
   *  level state — what the request will be built against. */
  start(currentId: string, practiceNow: PracticeSummary | null | undefined): void;
  /** Record an exercise the kid has been shown (any path), so no later
   *  prefetch may return it. */
  markServed(id: string): void;
  status(): PrefetchStatus;
  /**
   * Hand over the prefetched exercise iff it is safe to use, else null.
   * `answerSettled` must be true only when the latest answer's practice
   * update has landed: otherwise whether the level moved is unknown, and
   * the answer is null immediately.
   */
  take(practiceNow: PracticeSummary | null | undefined, answerSettled: boolean): Promise<Exercise | null>;
  /** Abandon everything (the screen is going away). */
  cancel(): void;
}

interface Slot {
  forId: string;
  builtAtLevel: Level | null;
  ctrl: AbortController;
  promise: Promise<NextFetchResult>;
  result: NextFetchResult | null;
}

export function createNextPrefetcher(deps: NextPrefetcherDeps): NextPrefetcher {
  const served = new Set<string>();
  let slot: Slot | null = null;
  const takeWaitMs = deps.takeWaitMs ?? TAKE_WAIT_MS;

  const discard = () => {
    slot?.ctrl.abort();
    slot = null;
  };

  return {
    markServed(id) {
      served.add(id);
    },

    start(currentId, practiceNow) {
      if (slot?.forId === currentId) return; // already fetching / holding it
      discard();
      served.add(currentId);

      const ctrl = new AbortController();
      const mine: Slot = {
        forId: currentId,
        builtAtLevel: effectiveLevel(practiceNow),
        ctrl,
        result: null,
        promise: Promise.resolve({ kind: "failed" } as NextFetchResult),
      };
      mine.promise = deps
        .fetchNext([...served], ctrl.signal)
        .catch((): NextFetchResult => ({ kind: "failed" }))
        .then((result) => {
          mine.result = result;
          // Only announce it if it is still the wanted one and still usable.
          if (slot === mine && result.kind === "ok" && !served.has(result.exercise.id)) {
            deps.onReady?.(result.exercise);
          }
          return result;
        });
      slot = mine;
    },

    status() {
      if (!slot) return "idle";
      return slot.result ? "ready" : "inflight";
    },

    async take(practiceNow, answerSettled) {
      const mine = slot;
      if (!mine) return null;
      if (!answerSettled) {
        // The level might be about to move and we cannot tell. Do not guess:
        // fall back to the ordinary path with no added wait.
        discard();
        return null;
      }

      let result = mine.result;
      if (!result) {
        // Still in flight: joining it beats starting a fresh request, but
        // only for so long.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<null>((resolve) => {
          // Deliberately NOT unref'd: this timer's whole job is to fire and
          // unblock the wait. An unref'd one lets a Node process exit first.
          timer = setTimeout(() => resolve(null), takeWaitMs);
        });
        result = await Promise.race([mine.promise, timedOut]);
        clearTimeout(timer);
      }
      // Whatever happened while we waited, this slot is spent.
      if (slot === mine) slot = null;
      if (!result || result.kind !== "ok") {
        mine.ctrl.abort();
        return null;
      }

      const ex = result.exercise;
      if (served.has(ex.id)) return null; // the server handed back something already shown
      if (!levelStillMatches(mine.builtAtLevel, practiceNow)) return null; // built for a level the kid has left
      served.add(ex.id);
      return ex;
    },

    cancel() {
      discard();
    },
  };
}
