/**
 * TRIPWIRE, not a behaviour test — and honest about it.
 *
 * ExerciseScreen is a 1,000-line client component behind a login, and this
 * repo has no DOM test harness, so its wiring cannot be exercised here. The
 * logic it wires up IS tested behaviourally (nextPrefetch, silenceNudge,
 * micLevel). What is not covered by those is the handful of connections
 * between them and the screen, and a couple of those are load-bearing for
 * correctness. This reads the source and fails if one is cut.
 *
 * The one that matters most: `answerInFlightRef`. The overlap-turns
 * prefetch may only be used once the latest answer's practice update has
 * landed, because until then nobody knows whether the kid's level moved.
 * If that flag were never set, a stale-level exercise could be shown after
 * a level-up or a drop — a wrong-answer path served the wrong exercise.
 *
 * Run: npx tsx tests/exercise-screen-wiring.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");

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
 *  matching closing brace. */
function block(startMarker: string): string {
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

console.log("overlap turns: an answer in flight must hold the prefetch back");

t("submitAnswer marks an answer in flight BEFORE any await", () => {
  const fn = block("async function submitAnswer(");
  const set = fn.indexOf("answerInFlightRef.current = true");
  const firstAwait = fn.indexOf("await ");
  assert.ok(set >= 0, "submitAnswer must set answerInFlightRef.current = true");
  assert.ok(firstAwait < 0 || set < firstAwait, "the flag must be set before the first await, or a tap in that gap is misread as settled");
});

t("...and clears it in a `finally`, so no failure path can leave it stuck", () => {
  const fn = block("async function submitAnswer(");
  const fin = fn.lastIndexOf("finally {");
  assert.ok(fin >= 0, "submitAnswer needs a finally block");
  assert.ok(fn.slice(fin).includes("answerInFlightRef.current = false"), "the flag must be cleared inside finally");
});

t("loadNextExercise asks the prefetcher with the settled flag derived from that ref", () => {
  const fn = block("async function loadNextExercise(");
  assert.match(fn, /const settled = !answerInFlightRef\.current/);
  assert.match(fn, /prefetcher\.take\(practiceRef\.current, settled\)/);
});

t("the instant path keeps the SCREEN's newer practice state, not the prefetch's stale snapshot", () => {
  const fn = block("async function loadNextExercise(");
  assert.match(fn, /setPractice\(\(p\) => p && \{ \.\.\.p, change: null \}\)/);
  assert.ok(!/setPractice\(prefetched/.test(fn) && !/data\.practice/.test(fn.split("if (prefetched)")[1]?.split("try {")[0] ?? ""),
    "the prefetched exercise's own practice snapshot predates the answer just given and must not overwrite the newer one");
});

t("the ordinary cold path is still present after the instant path", () => {
  const fn = block("async function loadNextExercise(");
  assert.match(fn, /action: "generate_exercise"/, "the untouched cold path must remain the fallback for every doubt");
});

console.log("\nthe prefetcher is created before the first load can ask it anything");

t("the prefetcher-creating effect precedes the mount effect that calls loadNextExercise()", () => {
  const create = src.indexOf("createNextPrefetcher({");
  const mount = src.indexOf("topicStatsRef.current = { attempted: 0, correct: 0 };\n    loadNextExercise();");
  assert.ok(create >= 0 && mount >= 0);
  assert.ok(create < mount, "if the mount effect ran first, the first load would see no prefetcher at all");
});

console.log("\nnothing new is spoken without Udi");

t("a nudge only speaks through the flag-gated silenceNudgeActions().speak", () => {
  assert.match(src, /if \(actions\.speak\) speakAutoRef\.current\(actions\.speak\)/);
  assert.ok(!/SILENCE_NUDGE_LINE/.test(src), "the screen must never reference the raw line: only the gated actions");
});

console.log("\nthe character");

t("the exercise screen's character listens and can lean in", () => {
  // Inside the element's own opening tag: a mention in a nearby comment must
  // not be able to satisfy this (it did once, and hid a deleted prop).
  const tag = src.match(/<Character\s[^>]*?leanIn=\{leaning\}[^>]*?\/>/)?.[0] ?? "";
  assert.ok(tag, "could not find the exercise screen's <Character ... leanIn={leaning} /> element");
  assert.match(tag, /\bmicReactive\b/, "the character must be given micReactive");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
