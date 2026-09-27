/**
 * The four UI fixes from the signed-in QA pass of 2026-09-27.
 *
 * Run: npx tsx tests/ui-fixes-2026-09-27.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("fix 1 — the parents gate receives its own taps");
t("the gate renders through a portal on document.body (no ancestor's z-index can trap it)", () => {
  const gate = src("components/home/ParentGate.tsx");
  assert.match(gate, /import \{ createPortal \} from "react-dom";/);
  assert.match(gate, /return createPortal\(\s*<motion\.div\s+role="dialog"/);
  assert.match(gate, /<\/motion\.div>,\s*document\.body\s*\);/);
  assert.match(gate, /className="fixed inset-0 [^"]*z-50"/);
});
t("…which matters: KidHeader is mounted inside a `relative z-10` wrapper beside a later `z-10` sibling", () => {
  for (const p of ["components/home/ModeChoice.tsx", "components/practice/FreePractice.tsx"]) {
    assert.match(src(p), /<div className="relative z-10">\s*<KidHeader/, p);
  }
});

console.log("\nfix 2 — the station load shows visible motion");
t("the exercise-load screen shows the loading dots under the 'I'm preparing' line", () => {
  const screen = src("components/practice/ExerciseScreen.tsx");
  const load = screen.slice(screen.indexOf("if (loadingExercise || (!exercise && !loadedOnce)) {"), screen.indexOf("// No exercise."));
  assert.match(load, /lines\.buildingExercise\(character, kidName\)/);
  assert.match(load, /<LoadingDots tone="light" label=\{l\.text\} \/>/);
});
t("the dots are a status for screen readers, and still under reduced motion", () => {
  assert.match(src("components/character/LoadingDots.tsx"), /role="status" aria-label=\{label\}/);
  assert.match(src("app/globals.css"), /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.animate-bounce \{\s*animation: none;/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
