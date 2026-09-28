/**
 * Kids-App UX Benchmark, build-first item 4: NumberLineWidget used to
 * render each tick as a free-floating, flex-wrapped 56px circle
 * (h-14/min-w-14) — under the benchmark's ~76px touch-target floor, and a
 * long set wrapped onto a second/third row, which stopped reading as a
 * "line" at all. This is now a horizontally scrollable, never-wrapping row
 * with a continuous rail running through every tick and a ≥76px square tap
 * target per tick.
 *
 * Source-tripwire only, same convention as tests/parent-dashboard-label.
 * test.mts and tests/wrong-answer-cue.test.mts — no DOM harness in this
 * repo. Live rendering (touch targets, scroll behaviour, endpoint marks,
 * unusual min/max/step, viewport screenshots) was verified in a mobile
 * browser — see the commit message.
 *
 * Run: npx tsx tests/number-line-touch-target.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/exercises/NumberLineWidget.tsx", import.meta.url), "utf8");

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

console.log("the tap target floor: ~76px, on both dimensions");

t("TICK_COLUMN_WIDTH and MIN_HIT_TARGET are both at least 76 — the benchmark's floor (72px is explicitly below it)", () => {
  const widthMatch = src.match(/const TICK_COLUMN_WIDTH = (\d+);/);
  const heightMatch = src.match(/const MIN_HIT_TARGET = (\d+);/);
  assert.ok(widthMatch, "TICK_COLUMN_WIDTH must be a named, readable constant");
  assert.ok(heightMatch, "MIN_HIT_TARGET must be a named, readable constant");
  assert.ok(Number(widthMatch![1]) >= 76, `TICK_COLUMN_WIDTH is ${widthMatch![1]}px, under the 76px floor`);
  assert.ok(Number(heightMatch![1]) >= 76, `MIN_HIT_TARGET is ${heightMatch![1]}px, under the 76px floor`);
});

t("each tick button's own width and minHeight are set from those constants, not a smaller literal", () => {
  assert.match(src, /style=\{\{ width: TICK_COLUMN_WIDTH, minHeight: MIN_HIT_TARGET \}\}/);
  // Regression guard: the old 56px circle sizing (h-14 min-w-14, space-
  // joined as it appears inside an actual className) must be gone from any
  // className attribute. Matched narrowly so this doesn't trip on the
  // module doc comment above, which mentions the old classes by name
  // (with a slash, "h-14/min-w-14") as history/rationale.
  assert.ok(!/className="[^"]*\bh-14\b[^"]*"/.test(src), "the old h-14 sizing must not still be present in a className");
  assert.ok(!/className="[^"]*\bmin-w-14\b[^"]*"/.test(src), "the old min-w-14 sizing must not still be present in a className");
});

console.log("\nnever wraps: a long set scrolls, it doesn't wrap onto a second row and stop reading as a line");

t("the outer container scrolls horizontally and never wraps", () => {
  assert.match(src, /overflow-x-auto/);
  // Matched only inside an actual className attribute, so this doesn't
  // trip on the module doc comment's own "never flex-wrap" prose above.
  assert.ok(!/className="[^"]*\bflex-wrap\b[^"]*"/.test(src), "flex-wrap must be gone from any className — a wrapped set is exactly the bug this item fixes");
});

t("the row's total width is sized from the tick count, so it never gets squeezed to fit the viewport", () => {
  assert.match(src, /width: ticks\.length \* TICK_COLUMN_WIDTH/);
});

console.log("\nvisually continuous: one rail across every tick, not separate floating chips");

t("every tick draws its own edge-to-edge rail segment, and the outer row carries no gap between them — adjacent segments must touch to read as one line", () => {
  const renderBlock = src.slice(src.indexOf("return ("));
  assert.match(renderBlock, /absolute inset-x-0 top-1\/2 h-1 -translate-y-1\/2 bg-\[var\(--color-teal\)\]\/25/, "the rail segment");
  // The flex row that lays the tick buttons out side by side must not add
  // spacing between them (a gap would show as a visible break in the rail).
  const rowDiv = renderBlock.match(/<div className="flex items-stretch"[^>]*>/);
  assert.ok(rowDiv, "could not find the tick row's own container div");
  assert.ok(!/gap-/.test(rowDiv![0]), "the tick row must not have a gap className — it would break the rail's continuity");
});

t("the two endpoints get a taller, bolder tick mark than the interior ticks — the line's extent must be legible even mid-scroll", () => {
  assert.match(src, /const isEndpoint = i === 0 \|\| i === ticks\.length - 1;/);
  assert.match(src, /isEndpoint \? "w-1\.5 h-7" : "w-1 h-4"/);
});

console.log("\nbehaviour: unchanged from before this item — one tap, one submit, disabled/onManipulate honoured");

t("ticks are still built from data.min/max/step, exactly as before — this item only changes the render, not the tick set", () => {
  assert.match(src, /for \(let v = data\.min; v <= data\.max; v \+= data\.step\) ticks\.push\(v\);/);
});

t("a tap submits exactly String(v) once, before the cosmetic onManipulate hook — the answer is never delayed or blocked by it", () => {
  const onClickBlock = src.slice(src.indexOf("onClick={() => {"), src.indexOf("disabled={disabled}"));
  const submitIdx = onClickBlock.indexOf("onSubmit(String(v));");
  const manipulateIdx = onClickBlock.indexOf("onManipulate?.(\"tap\");");
  assert.ok(submitIdx >= 0, "onSubmit(String(v)) must be called");
  assert.ok(manipulateIdx > submitIdx, "onManipulate must come after onSubmit, never before or in place of it");
  assert.ok(!/onSubmit\(String\(v\)\)[\s\S]*onSubmit\(String\(v\)\)/.test(onClickBlock), "onSubmit must not be called twice");
});

t("the disabled prop is passed straight through to the native button attribute — no separate gating logic to drift out of sync", () => {
  assert.match(src, /disabled=\{disabled\}/);
});

t("still LTR inside the RTL screen, and each tick keeps an accessible label (the visual tick+rail are aria-hidden, decorative)", () => {
  assert.match(src, /dir="ltr"/);
  assert.match(src, /aria-label=\{String\(v\)\}/);
});

t("the Props type is unchanged — this item does not touch ExerciseScreen's call site", () => {
  assert.match(src, /interface Props \{\s*data: NumberLineData;\s*disabled: boolean;\s*onSubmit: \(value: string\) => void;/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
