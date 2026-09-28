/**
 * Kids-App UX Benchmark, build-first item 5: an in-app 3×4 numeric pad
 * (0-9, ⌫, ✓) for numeric open answers.
 *
 * Two things are covered: NumericPad.tsx's own render (source-tripwire —
 * no DOM harness in this repo, same convention as the other exercise
 * widgets), and its wiring into ExerciseScreen.tsx — specifically that it
 * is scoped to subtype === "fill_in_blank" and nothing broader, since
 * "open" alone also covers explain_thinking (qualitative) and
 * comprehension's short-text-answer form (not necessarily numeric).
 *
 * Run: npx tsx tests/numeric-pad.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const padSrc = readFileSync(new URL("../components/exercises/NumericPad.tsx", import.meta.url), "utf8");
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

/** The text of a function/block starting at `startMarker`, through its
 *  matching closing brace — same helper as the other ExerciseScreen tripwires. */
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

console.log("NumericPad.tsx: the full key set, in one row-major layout, nothing extra");

t("digits 1-9 are laid out as a 3-row grid and each mapped digit is wired to onDigit(d), plus a separate literal 0 key wired to onDigit(\"0\")", () => {
  assert.match(padSrc, /const DIGIT_ROWS: readonly \(readonly string\[\]\)\[\] = \[\s*\["1", "2", "3"\],\s*\["4", "5", "6"\],\s*\["7", "8", "9"\],\s*\];/);
  assert.match(padSrc, /onClick=\{\(\) => onDigit\(d\)\}/, "the mapped 1-9 keys must call onDigit(d)");
  assert.match(padSrc, /onClick=\{\(\) => onDigit\("0"\)\}/, "the explicit 0 key must call onDigit(\"0\")");
});

t("backspace and confirm are wired to their own dedicated callbacks, not a digit call", () => {
  assert.match(padSrc, /onClick=\{onBackspace\}/);
  assert.match(padSrc, /onClick=\{onConfirm\}/);
});

t("confirm is the ONLY key gated on the answer being non-empty — never submit empty (mirrors the existing שלח button's own guard)", () => {
  assert.match(padSrc, /disabled=\{disabled \|\| !value\.trim\(\)\}/);
  // The mapped 1-9 keys, the explicit 0 key, and backspace are three
  // separate source lines (the 1-9 row is one .map() call, not nine
  // literal buttons) — all three must use the plain `disabled` guard,
  // never the emptiness one.
  const plainDisabledCount = (padSrc.match(/disabled=\{disabled\}/g) ?? []).length;
  assert.equal(plainDisabledCount, 3, "expected exactly 3 source occurrences of the plain disabled guard: the mapped 1-9 row, the 0 key, and backspace");
});

t("no new Hebrew copy: digit labels are bare numerals, ⌫/✓ carry English (non-Hebrew) aria-labels", () => {
  assert.match(padSrc, /aria-label="Backspace"/);
  assert.match(padSrc, /aria-label="Confirm"/);
  // The JSDoc comment quotes fill_in_blank's own existing Hebrew generation
  // prompt as rationale (why no minus/decimal key), and an inline "//"
  // comment inside the render references the existing שלח button's label
  // for context — neither is new UI or spoken copy. Strip every "//" line
  // comment before scanning so only what actually renders is checked.
  const renderBlock = padSrc.slice(padSrc.indexOf("return ("));
  const renderOnly = renderBlock
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.ok(!/[֐-׿]/.test(renderOnly), "no Hebrew characters in the rendered JSX (comments aside)");
});

t("no minus or decimal key — fill_in_blank's own generation prompt guarantees a non-negative whole number, so digits+backspace+confirm is complete", () => {
  assert.ok(!/["']-["']/.test(padSrc.replace(/disabled \|\| !value\.trim\(\)/g, "")), "no literal minus-sign key");
  assert.ok(!/["']\.["']/.test(padSrc), "no literal decimal-point key");
});

t("this component never reads or writes its own copy of the answer — `value` is read-only (for the confirm guard), everything else flows out through the three callbacks", () => {
  // No local useState/useRef holding an answer-shaped value.
  assert.ok(!/useState/.test(padSrc) && !/useRef/.test(padSrc), "must hold no local state of its own — the caller's `answer` state is the only source of truth");
});

console.log("\nExerciseScreen.tsx wiring: scoped to fill_in_blank, nothing broader");

t("NumericPad is imported and rendered only when exercise.type is 'open' AND subtype is specifically 'fill_in_blank'", () => {
  assert.match(screenSrc, /import NumericPad from "@\/components\/exercises\/NumericPad";/);
  assert.match(
    screenSrc,
    /\{!evaluation && exercise\.type === "open" && exercise\.subtype === "fill_in_blank" && \(/
  );
});

t("it is NOT gated on exercise.type === \"open\" alone — that would also catch explain_thinking (qualitative) and comprehension's open form (short text, not necessarily numeric)", () => {
  // The numeric-pad gate must name the subtype explicitly, not just the type.
  const padBlock = screenSrc.slice(
    screenSrc.indexOf('exercise.type === "open" && exercise.subtype === "fill_in_blank"'),
    screenSrc.indexOf("<NumericPad") + 200
  );
  assert.ok(!/explain_thinking/.test(padBlock), "explain_thinking must never be named as eligible for the numeric pad");
});

t("the pad's callbacks route through the SAME answer state and the SAME submitAnswer the free-text input already uses — no parallel submission path", () => {
  const padCallSite = screenSrc.slice(screenSrc.indexOf("<NumericPad"), screenSrc.indexOf("<NumericPad") + 400);
  assert.match(padCallSite, /value=\{answer\}/);
  assert.match(padCallSite, /onDigit=\{\(d\) => setAnswer\(\(a\) => a \+ d\)\}/);
  assert.match(padCallSite, /onBackspace=\{\(\) => setAnswer\(\(a\) => a\.slice\(0, -1\)\)\}/);
  assert.match(padCallSite, /onConfirm=\{\(\) => submitAnswer\(answer\)\}/);
  assert.match(padCallSite, /disabled=\{submitting\}/);
});

t("the free-text input and its שלח button are untouched — still there, still the fallback for every non-fill_in_blank open exercise", () => {
  // A plain start->end slice, not the generic function-shaped block()
  // helper: this marker is a JSX `{condition && (` conditional, not a
  // `name(args) { ... }` function, so block()'s own paren/brace search
  // finds the wrong tokens here. The numeric-pad's own doc comment
  // (inserted immediately after this block, in the same commit) is a
  // stable, unique end anchor.
  const start = screenSrc.indexOf('{!evaluation && exercise.type === "open" && (');
  const end = screenSrc.indexOf("Kids-App UX Benchmark item 5", start);
  assert.ok(start >= 0 && end > start, "could not isolate the free-text open-answer block");
  const openBlock = screenSrc.slice(start, end);
  assert.match(openBlock, /placeholder="התשובה שלי\.\.\."/);
  assert.match(openBlock, /onClick=\{\(\) => submitAnswer\(answer\)\}/);
  assert.match(openBlock, /disabled=\{submitting \|\| !answer\.trim\(\)\}/);
});

t("voice input (micApplies) is untouched by this item — it does not name subtype or NumericPad anywhere near it", () => {
  const micIdx = screenSrc.indexOf("const micApplies =");
  assert.ok(micIdx >= 0, "could not find micApplies");
  const micLine = screenSrc.slice(micIdx, screenSrc.indexOf("\n", micIdx));
  assert.ok(!/fill_in_blank|NumericPad/.test(micLine), "micApplies must be unconditioned by this item's numeric-pad logic");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
