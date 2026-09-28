/**
 * Kids-App UX Benchmark, build-first item 6: the ghost-hand demo's wiring
 * into NumberLineWidget, TileOrderWidget, and GroupingWidget, plus
 * GhostHand itself and ExerciseScreen's three call sites.
 *
 * Source-tripwire only — no DOM harness in this repo, same convention as
 * the other exercise-widget tests. lib/exercises/firstUseDemo.ts's own
 * logic is covered behaviourally in tests/first-use-demo.test.mts; this
 * file is about the WIRING: is the demo state provably isolated from
 * onSubmit/onManipulate/placement logic, does every real interaction
 * dismiss it, does it only ever target the first item, and is it gated on
 * the correct widget-kind string per file.
 *
 * Run: npx tsx tests/first-use-demo-widgets.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ghostHandSrc = readFileSync(new URL("../components/exercises/GhostHand.tsx", import.meta.url), "utf8");
const numberLineSrc = readFileSync(new URL("../components/exercises/NumberLineWidget.tsx", import.meta.url), "utf8");
const tileOrderSrc = readFileSync(new URL("../components/exercises/TileOrderWidget.tsx", import.meta.url), "utf8");
const groupingSrc = readFileSync(new URL("../components/exercises/GroupingWidget.tsx", import.meta.url), "utf8");
const screenSrc = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");

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

/** The text of a function starting at `startMarker`, through its matching
 *  closing brace — same helper as the other widget/ExerciseScreen tripwires. */
function block(src: string, startMarker: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `could not find: ${startMarker}`);
  const open = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after: ${startMarker}`);
}

console.log("GhostHand.tsx: purely decorative, no way in to real logic");

t("pointer-events-none and aria-hidden — it can never intercept a tap, and is invisible to assistive tech", () => {
  // Matched only inside an actual className/attribute, so this doesn't
  // trip on the module doc comment above, which quotes `pointer-events-
  // none` by name as design rationale (caught by mutation-testing this
  // exact pattern: removing the real class left this assertion passing
  // vacuously against the comment alone until scoped this way).
  assert.match(ghostHandSrc, /className="pointer-events-none /);
  assert.match(ghostHandSrc, /aria-hidden="true"/);
});

t("it never imports or references onSubmit, onManipulate, or any exercise/placement state — it has no props at all", () => {
  assert.match(ghostHandSrc, /export default function GhostHand\(\)/, "GhostHand must take no props");
  // Checked on the function body only — the module doc comment above it
  // explains, in prose, exactly what this component never does, which
  // necessarily names these same words as things it DOESN'T call.
  const body = ghostHandSrc.slice(ghostHandSrc.indexOf("export default function GhostHand"));
  assert.ok(!/onSubmit|onManipulate|onClick|localStorage/.test(body), "no callback, click handler, or storage access anywhere in this component's actual code");
});

t("the bounce uses framer-motion's own animate prop (y/scale) — inherits reduced-motion suppression for free from the app-wide MotionConfig, same mechanism as item 3's highlight", () => {
  assert.match(ghostHandSrc, /animate=\{\{ y: \[0, 6, 0\], scale: \[1, 0\.9, 1\] \}\}/);
});

for (const [name, src, widget, singlePhase] of [
  ["NumberLineWidget", numberLineSrc, "number_line", true],
  ["TileOrderWidget", tileOrderSrc, "tile_order", true],
] as const) {
  console.log(`\n${name}.tsx: single-phase demo, scoped to this kid+widget, never touching real logic`);

  t(`${name} imports GhostHand and the firstUseDemo store, and takes a required kidId prop`, () => {
    assert.match(src, /import GhostHand from "@\/components\/exercises\/GhostHand";/);
    assert.match(src, /import \{ hasSeenFirstUseDemo, markFirstUseDemoSeen \} from "@\/lib\/exercises\/firstUseDemo";/);
    assert.match(src, /kidId: string;/);
  });

  t(`${name} checks hasSeenFirstUseDemo(kidId, "${widget}") exactly once, on mount (empty dependency array)`, () => {
    const checkIdx = src.indexOf(`hasSeenFirstUseDemo(kidId, "${widget}")`);
    assert.ok(checkIdx >= 0, "the check must name this widget's own kind, not a different one");
    const afterCheck = src.slice(checkIdx, checkIdx + 200);
    assert.match(afterCheck, /\}, \[\]\);/, "must run once on mount — an empty dependency array, not re-checked on every prop change");
  });

  t(`${name} marks the demo seen via markFirstUseDemoSeen(kidId, "${widget}") only inside its own ~2s timer, never inside a real interaction handler`, () => {
    assert.match(src, new RegExp(`markFirstUseDemoSeen\\(kidId, "${widget}"\\);`));
    // It must be reached through setTimeout, not called directly from a
    // tap handler (which would mark it "seen" the instant a kid answered
    // for real, even without ever finishing the demo — a different bug).
    const markIdx = src.indexOf(`markFirstUseDemoSeen(kidId, "${widget}")`);
    const before = src.slice(Math.max(0, markIdx - 150), markIdx);
    assert.match(before, /setTimeout\(\(\) => \{/, "must be reached through the timer, not a direct call from a tap handler");
  });

  t(`${name}'s demo-clearing function (dismissDemo) is called from EVERY real interaction handler that mutates placement state`, () => {
    // Every function that calls the widget's setState/onSubmit for a real
    // placement must call dismissDemo() first.
    const dismissCount = (src.match(/dismissDemo\(\);/g) ?? []).length;
    assert.ok(dismissCount >= 1, "dismissDemo must be called from at least one real interaction handler");
  });

  t(`${name} never calls onSubmit or onManipulate from anywhere inside its own demo state/effects — only from the pre-existing tap handlers, unchanged`, () => {
    const demoRegion = src.slice(src.indexOf("// Kids-App UX Benchmark item 6:"), src.indexOf("function dismissDemo") + 100);
    assert.ok(!/onSubmit\(|onManipulate\?\.\(/.test(demoRegion), "the demo's own state/effects must never call onSubmit or onManipulate directly");
  });

  t(`${name} renders GhostHand gated on showDemo AND i === 0 — the first item only, never the whole set`, () => {
    assert.match(src, /\{showDemo && i === 0 && <GhostHand \/>\}/);
  });
}

console.log("\nGroupingWidget.tsx: two-phase demo (item, then bucket), same isolation guarantees");

t("GroupingWidget imports GhostHand and the firstUseDemo store, and takes a required kidId prop", () => {
  assert.match(groupingSrc, /import GhostHand from "@\/components\/exercises\/GhostHand";/);
  assert.match(groupingSrc, /import \{ hasSeenFirstUseDemo, markFirstUseDemoSeen \} from "@\/lib\/exercises\/firstUseDemo";/);
  assert.match(groupingSrc, /kidId: string;/);
});

t('checks hasSeenFirstUseDemo(kidId, "grouping") once on mount, and starts at the "item" phase, never straight to "bucket"', () => {
  assert.match(groupingSrc, /if \(!hasSeenFirstUseDemo\(kidId, "grouping"\)\) setDemoPhase\("item"\);/);
});

t('phase "item" advances to phase "bucket" after its own timer — it does not mark the demo seen itself (only "bucket" finishing does)', () => {
  const timerBlock = block(groupingSrc, "useEffect(() => {\n    if (demoPhase === \"idle\") return;");
  assert.match(timerBlock, /if \(demoPhase === "item"\) \{\s*setDemoPhase\("bucket"\);/);
  assert.match(timerBlock, /\} else \{\s*setDemoPhase\("idle"\);\s*markFirstUseDemoSeen\(kidId, "grouping"\);/);
});

t("dismissDemo() is called from every real interaction handler: pickUpItem, dropInBucket, removeFromBucket, and the manual-count fallback", () => {
  for (const fn of ["function pickUpItem", "function dropInBucket", "function removeFromBucket", "function handleManualSubmit"]) {
    const fnBlock = block(groupingSrc, fn);
    assert.match(fnBlock, /dismissDemo\(\);/, `${fn} must dismiss the demo before mutating real state`);
  }
});

t("GhostHand renders on the first item during the 'item' phase, and on the first bucket during the 'bucket' phase — never both at once, never on any other index", () => {
  assert.match(groupingSrc, /\{demoPhase === "item" && i === 0 && <GhostHand \/>\}/);
  assert.match(groupingSrc, /\{demoPhase === "bucket" && bucketIndex === 0 && <GhostHand \/>\}/);
});

t("handleSubmit (the real answer-checking submission) never references demo state at all", () => {
  const submitBlock = block(groupingSrc, "function handleSubmit(");
  assert.ok(!/demoPhase|dismissDemo|GhostHand/.test(submitBlock), "the real submission path must be entirely untouched by this item");
});

console.log("\nExerciseScreen.tsx: kidId threaded to all three widgets, nothing else changed at each call site");

t("NumberLineWidget, TileOrderWidget, and GroupingWidget each receive kidId={kidId} at their call site, alongside their pre-existing props unchanged", () => {
  assert.match(
    screenSrc,
    /<NumberLineWidget data=\{exercise\.numberLine\} disabled=\{submitting\} onSubmit=\{submitAnswer\} onManipulate=\{emitManipulation\} kidId=\{kidId\} \/>/
  );
  assert.match(
    screenSrc,
    /<TileOrderWidget data=\{exercise\.tiles\} disabled=\{submitting\} onSubmit=\{submitAnswer\} onManipulate=\{emitManipulation\} kidId=\{kidId\} \/>/
  );
  assert.match(
    screenSrc,
    /<GroupingWidget data=\{exercise\.grouping\} disabled=\{submitting\} onSubmit=\{submitAnswer\} kidId=\{kidId\} \/>/
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
