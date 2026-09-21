/**
 * Every warmed line must actually be spoken.
 *
 * `buildingExercise` was prefetched on every mount of the exercise screen
 * and never spoken anywhere — it is only rendered as text in the loading
 * bubble. That bought a Cartesia request per mount and cached a clip
 * nothing could play. A prefetch is invisible when it is wasted: nothing
 * breaks, it just costs money on every load, so it needs a test rather
 * than a comment.
 *
 * This reads the screen's source and holds the invariant in both
 * directions for the guide lines it warms.
 *
 * Run: npx tsx tests/prefetch-waste.test.mts
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

const src = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");
const code = src
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

/** Which lines.X(...) appear inside a call of this kind. */
function linesUsedIn(call: "prefetchSpeech" | "speakAuto"): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`${call}\\(([^;]*?)\\)[,;]`, "gs");
  for (const m of code.matchAll(re)) {
    for (const l of m[1].matchAll(/lines\.([a-zA-Z]+)\(/g)) {
      if (l[1] !== "spoken") out.add(l[1]);
    }
  }
  return out;
}

const prefetched = linesUsedIn("prefetchSpeech");
const spoken = linesUsedIn("speakAuto");

console.log(`prefetched guide lines: ${[...prefetched].join(", ") || "(none)"}`);
console.log(`spoken guide lines:     ${[...spoken].join(", ") || "(none)"}\n`);

t("every guide line that is warmed is also spoken somewhere on this screen", () => {
  const wasted = [...prefetched].filter((n) => !spoken.has(n));
  assert.deepEqual(wasted, [], `warmed but never spoken (a Cartesia request per mount, for audio nothing can play): ${wasted.join(", ")}`);
});

t("buildingExercise specifically is NOT warmed — it is a text-only line", () => {
  assert.ok(!prefetched.has("buildingExercise"), "buildingExercise has no speak path; warming it is pure waste");
});

t("...and it is still rendered on screen, so removing the prefetch changed nothing a kid sees", () => {
  assert.match(src, /lines\.buildingExercise\(character, kidName\)/);
  assert.match(src, /SpeechBubble text=\{l\.text\}/);
});

t("the lines that ARE warmed are still warmed: thinking, and the three verdict openers", () => {
  assert.ok(prefetched.has("thinking"), "thinking is spoken on every voice answer and must stay warm");
  assert.match(code, /for \(const opener of Object\.values\(OPENERS\)\)[\s\S]{0,160}prefetchSpeech/);
});

t("the exercise's own question and choices are still warmed (not guide lines, but the same loop)", () => {
  assert.match(code, /prefetchSpeech\(questionSpeech\(ex\), character\)/);
  assert.match(code, /for \(const choice of ex\.choices\) prefetchSpeech\(choice, character\)/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
