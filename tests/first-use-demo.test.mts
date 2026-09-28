/**
 * Kids-App UX Benchmark, build-first item 6: the per-kid, per-widget-kind
 * "has this kid seen the ghost-hand demo" store.
 *
 * Unlike most of the exercise-widget tests, this module holds no React/DOM
 * — it's plain TS gated on `typeof window`, so its actual behaviour (not
 * just its source shape) is directly testable here by shimming a minimal
 * `window.localStorage` before each check, the same way the rest of this
 * suite verifies pure logic.
 *
 * Run: npx tsx tests/first-use-demo.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasSeenFirstUseDemo, markFirstUseDemoSeen } from "../lib/exercises/firstUseDemo";

let passed = 0;
const failures: string[] = [];
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}

/** A minimal, real Map-backed localStorage shim — good enough to exercise
 *  get/set/try-catch behaviour without a browser. */
function fakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

console.log("a fresh kid+widget pair has not seen the demo, and marking it changes that — and ONLY that pair");

t("hasSeenFirstUseDemo is false before any mark, true immediately after", () => {
  (globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage: fakeStorage() };
  assert.equal(hasSeenFirstUseDemo("kid-1", "number_line"), false);
  markFirstUseDemoSeen("kid-1", "number_line");
  assert.equal(hasSeenFirstUseDemo("kid-1", "number_line"), true);
});

t("marking one widget kind seen does not mark the other two seen for the same kid", () => {
  (globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage: fakeStorage() };
  markFirstUseDemoSeen("kid-1", "number_line");
  assert.equal(hasSeenFirstUseDemo("kid-1", "number_line"), true);
  assert.equal(hasSeenFirstUseDemo("kid-1", "tile_order"), false, "tile_order must be independent of number_line");
  assert.equal(hasSeenFirstUseDemo("kid-1", "grouping"), false, "grouping must be independent of number_line");
});

t("per-kid, never a shared/global flag: kid-2 has not seen it even after kid-1 has, for the same widget kind", () => {
  (globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage: fakeStorage() };
  markFirstUseDemoSeen("kid-1", "grouping");
  assert.equal(hasSeenFirstUseDemo("kid-1", "grouping"), true);
  assert.equal(hasSeenFirstUseDemo("kid-2", "grouping"), false, "a second kid on the same device/store must get their own first look");
});

console.log("\nthe stored key is versioned and namespaced — a future redesign can invalidate it without migrating anything");

t("the actual stored key contains a version tag, the widget kind, and the kidId — not just an opaque boolean", () => {
  // The behavioural round-trip above already proves the key is
  // discoverable by kidId+widget; this checks the module's own source for
  // the versioning/namespacing shape itself, since the literal key format
  // is an implementation detail this test shouldn't reconstruct by hand.
  const src = readFileSync(new URL("../lib/exercises/firstUseDemo.ts", import.meta.url), "utf8");
  assert.match(src, /const VERSION = "v1";/);
  assert.match(src, /`ai-tutor-first-use-demo-\$\{VERSION\}:\$\{widget\}:\$\{kidId\}`/);
});

console.log("\nsafe fallbacks: no window, no kidId, and a store that throws all default to 'already seen' (skip), never a crash");

t("no window (SSR) → hasSeenFirstUseDemo is true (skip), markFirstUseDemoSeen is a silent no-op", () => {
  delete (globalThis as unknown as { window?: unknown }).window;
  assert.equal(hasSeenFirstUseDemo("kid-1", "number_line"), true);
  assert.doesNotThrow(() => markFirstUseDemoSeen("kid-1", "number_line"));
});

t("empty kidId → treated the same as no window: true (skip), no-op mark, no throw", () => {
  (globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage: fakeStorage() };
  assert.equal(hasSeenFirstUseDemo("", "grouping"), true);
  assert.doesNotThrow(() => markFirstUseDemoSeen("", "grouping"));
});

t("a storage that throws on every call (private-mode Safari's classic failure) never crashes either function, and reads back as 'seen' (skip)", () => {
  const throwing: Storage = {
    getItem: () => {
      throw new Error("storage blocked");
    },
    setItem: () => {
      throw new Error("storage blocked");
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
  (globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage: throwing };
  assert.doesNotThrow(() => hasSeenFirstUseDemo("kid-1", "number_line"));
  assert.equal(hasSeenFirstUseDemo("kid-1", "number_line"), true, "a broken store must read as already-seen, never force the demo to error out");
  assert.doesNotThrow(() => markFirstUseDemoSeen("kid-1", "number_line"));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
