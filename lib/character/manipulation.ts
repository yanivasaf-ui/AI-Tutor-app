/**
 * The character acknowledges what a kid's hands are doing.
 *
 * feat: local UX wins, item 3 (feedback during manipulation). While a kid
 * places tiles, the character gives a small nod per placement and a slightly
 * bigger one when the last slot fills ("that's a full answer"); on a number
 * line, a tap gets one nod. Purely local and purely visual: no network, no
 * audio, no words.
 *
 * What this is NOT, on purpose:
 *  - Not a verdict. The nod says "I saw that", never "that's right" — it
 *    fires identically for a correct and a wrong tile, because at this
 *    moment nobody has checked anything.
 *  - Not a change to the interaction. Both widgets are tap-to-place, not
 *    drag; a number-line tap submits immediately. This adds a reaction to
 *    those taps and moves nothing: when the answer is locked and when the
 *    verdict is shown are exactly as before.
 *  - Not sound. A synthesized tick would be one more thing sharing the
 *    iPhone's audio session with speech, in the very place the TTS once
 *    went silent; a visual nod carries none of that risk. See the report.
 *  - Not new Hebrew. There is no line here to review.
 *
 * Widgets emit through this module; the Character (when asked to be
 * `reactive`) is the only listener. Neither imports the other.
 */

export type ManipulationKind = "place" | "ready" | "remove" | "tap";

/**
 * What a change in the number of filled slots means, from state that already
 * exists. `ready` is the placement that fills the last slot (it replaces
 * `place`, so the final tile gets one reaction, not two). Removing a tile is
 * an undo, not progress: no reaction.
 */
export function manipulationEvent(prevFilled: number, nextFilled: number, slotCount: number): ManipulationKind | null {
  if (nextFilled > prevFilled) return slotCount > 0 && nextFilled >= slotCount ? "ready" : "place";
  if (nextFilled < prevFilled) return "remove";
  return null;
}

export interface ReactionSpec {
  keyframes: { transform: string }[];
  durationMs: number;
}

const REST = "translateY(0) scale(1)";

/**
 * Subtle by construction: never more than ~2% of the character's height or
 * a 3% scale, over well under half a second, ending exactly at rest. `remove`
 * has none. (The character is already bobbing and breathing; this rides on
 * top of that.)
 */
export const REACTIONS: Record<ManipulationKind, ReactionSpec | null> = {
  place: { keyframes: [{ transform: REST }, { transform: "translateY(-1.1%) scale(1.012)" }, { transform: REST }], durationMs: 170 },
  tap: { keyframes: [{ transform: REST }, { transform: "translateY(-1.1%) scale(1.012)" }, { transform: REST }], durationMs: 170 },
  ready: { keyframes: [{ transform: REST }, { transform: "translateY(-2%) scale(1.03)" }, { transform: REST }], durationMs: 280 },
  remove: null,
};

/** Reactions closer together than this are dropped (except `ready`), so a
 *  kid tapping fast gets a rhythm of nods, not a pile-up. */
export const MIN_GAP_MS = 90;

export type ReactionListener = (kind: ManipulationKind) => void;

export interface ReactionBus {
  emit(kind: ManipulationKind): void;
  subscribe(listener: ReactionListener): () => void;
}

export function createReactionBus(opts: { minGapMs?: number; now?: () => number } = {}): ReactionBus {
  const minGap = opts.minGapMs ?? MIN_GAP_MS;
  const now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const listeners = new Set<ReactionListener>();
  let lastAt = -Infinity;
  return {
    emit(kind) {
      if (listeners.size === 0) return;
      const t = now();
      // `ready` is the payoff of a whole sequence and is never thinned out.
      if (kind !== "ready" && t - lastAt < minGap) return;
      lastAt = t;
      for (const l of [...listeners]) {
        try {
          l(kind);
        } catch {
          // A broken listener must never reach the widget that emitted:
          // this is decoration on top of an answer the kid is giving.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const bus = createReactionBus();
export const emitManipulation: (kind: ManipulationKind) => void = (kind) => bus.emit(kind);
export const subscribeManipulation = (listener: ReactionListener): (() => void) => bus.subscribe(listener);

/** Same rule as the mic reaction: motion, so reduced-motion users get none. */
export function shouldReactToManipulation(opts: { enabled: boolean; reducedMotion: boolean | null }): boolean {
  return opts.enabled && !opts.reducedMotion;
}
