"use client";

/**
 * Kids-App UX Benchmark, build-first item 6: whether a kid has already
 * seen the ~2s translucent "ghost hand" demo for a given widget KIND
 * (GroupingWidget's item-then-bucket, NumberLineWidget's tick tap,
 * TileOrderWidget's bank-item-then-slot) — shown once per kid per kind,
 * never once per exercise and never a shared/global flag (two kids on one
 * device must each get their own first look).
 *
 * Same guarded-localStorage shape as lib/speech/autoSpeak.ts: try/catch
 * around every read and write, no throw on a blocked or unavailable
 * store (private browsing, storage quota, SSR). Deliberately NO server
 * table — this is cosmetic and device-local; losing it (a cleared cache,
 * a new device) just means the demo plays again, never a functional
 * regression, so it isn't worth a schema.
 *
 * The key is VERSIONED (VERSION below): a future redesign of the demo
 * itself bumps this constant to show it again for everyone, without
 * needing to touch or migrate any already-stored per-kid state.
 */
const VERSION = "v1";

export type FirstUseDemoWidget = "number_line" | "tile_order" | "grouping";

function storageKey(kidId: string, widget: FirstUseDemoWidget): string {
  return `ai-tutor-first-use-demo-${VERSION}:${widget}:${kidId}`;
}

/**
 * `true` (safe to skip the demo) whenever this can't be determined
 * reliably — no window (SSR), no kidId, or a blocked store — rather than
 * risk showing a tap-tutorial repeatedly or throwing mid-render.
 */
export function hasSeenFirstUseDemo(kidId: string, widget: FirstUseDemoWidget): boolean {
  if (typeof window === "undefined" || !kidId) return true;
  try {
    return window.localStorage.getItem(storageKey(kidId, widget)) === "1";
  } catch {
    return true;
  }
}

export function markFirstUseDemoSeen(kidId: string, widget: FirstUseDemoWidget): void {
  if (typeof window === "undefined" || !kidId) return;
  try {
    window.localStorage.setItem(storageKey(kidId, widget), "1");
  } catch {
    // Storage blocked — nothing to persist. The demo may simply play
    // again next time, the same safe fallback isSeenFirstUseDemo takes.
  }
}
