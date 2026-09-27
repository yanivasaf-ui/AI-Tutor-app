/**
 * The four UI fixes from the signed-in QA pass of 2026-09-27.
 *
 * Run: npx tsx tests/ui-fixes-2026-09-27.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gradesNamed, summaryForDisplay } from "../lib/dashboard/summary";

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

console.log("\nfix 4 — the parent summary never names a stale grade");
// The QA kid's stored summaries, 2026-09-27 (name removed); her grade is now NULL.
const HEBREW = "הצליחה בזיהוי שורש משותף במילים בתרגיל ידע מטה-לשוני. השליטה היציבה שלה בניקוד, כתיב, מבנה משפט, אוצר מילים, תהליכי כתיבה וזיהוי שורשים ממשיכה להעיד על רמה טובה המתאימה לכיתה ב.";
const MATH = "הצליחה לזהות ולהשלים נכון רצף של קפיצות ב-5 (עד 30), מה שמעיד על הבנה טובה של דפוסים מספריים.";
t("QA repro: 'המתאימה לכיתה ב' is hidden once the grade is ג or NULL, shown while it is ב", () => {
  assert.equal(summaryForDisplay(HEBREW, null), null);
  assert.equal(summaryForDisplay(HEBREW, "ג"), null);
  assert.equal(summaryForDisplay(HEBREW, "ב"), HEBREW);
});
t("a summary that names no grade is shown as is; an empty one is not shown", () => {
  assert.equal(summaryForDisplay(MATH, null), MATH);
  assert.equal(summaryForDisplay("", "ב"), null);
  assert.equal(summaryForDisplay(undefined, "ב"), null);
});
t("grade mentions are read in their written forms, and look-alike words are not grades", () => {
  assert.deepEqual(gradesNamed("מתאים לכיתה ב."), ["ב"]);
  assert.deepEqual(gradesNamed("כיתה ג' - רמה טובה"), ["ג"]);
  assert.deepEqual(gradesNamed("כיתה א׳ ואז כיתה ב"), ["א", "ב"]);
  assert.deepEqual(gradesNamed("בכיתה בית הספר, כיתה גבוהה"), []);
});
t("the dashboard renders the summary through the guard, with the kid's grade", () => {
  const page = src("app/page.tsx");
  assert.match(page, /const summary = summaryForDisplay\(profile\?\.recentSummary, kid\.grade\);/);
  assert.match(page, /\{summary && <p className="text-sm text-\[var\(--color-ink-soft\)\]">\{summary\}<\/p>\}/);
  assert.ok(!/\{profile\?\.recentSummary\}/.test(page), "no unguarded summary");
});
t("a real grade change in the app clears the stored level and summary (update, not upsert)", () => {
  const route = src("app/api/kids/route.ts");
  assert.match(route, /if \(isGrade\(body\.grade\) && body\.grade !== kid\.grade && !\(await clearGradeDependentSummaries\(supabase, id\)\)\)/);
  const store = src("lib/memory/store.ts");
  assert.match(store, /\.from\("subject_profiles"\)\s*\.update\(\{ estimated_level: "", recent_summary: "" \}\)\s*\.eq\("kid_id", kidId\);/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
