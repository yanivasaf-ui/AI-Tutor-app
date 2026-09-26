/**
 * What happens when the content checks refuse every draft
 * (lib/exercises/produce.ts, app/api/tutor/route.ts, the kid's screen).
 *
 * The old last resort served an UNCHECKED bank row. It is removed (owner,
 * 2026-09-26). Now: one more live generation; then a vetted template if the
 * topic has one; then an honest "try again" — and nothing is served.
 *
 * Run: npx tsx tests/produce.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { produceExercise, isCheckRejection } from "../lib/exercises/produce";
import { TopicFitError } from "../lib/exercises/generate";
import { FormatFitError } from "../lib/exercises/format-fit";
import { OperationScopeError } from "../lib/exercises/operation-scope";
import { QualityGateError } from "../lib/authoring/quality-gate";
import { couldNotBuild, somethingBroke } from "../lib/guide/lines";
import { violatesConstitution } from "../lib/feedback/constitution";
import type { Exercise } from "../lib/exercises/types";

let passed = 0;
const failures: string[] = [];
async function at(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}

const exercise = { id: "g1", subject: "math", grade: "ב", type: "open", topic: "t", question: "q", correctAnswer: "1" } as Exercise;
const template = { subject: "math", grade: "ב", type: "open", topic: "t", question: "tpl", correctAnswer: "3" } as Omit<Exercise, "id">;
const REJECTIONS: [string, () => Error][] = [
  ["TopicFitError", () => new TopicFitError("off topic")],
  ["FormatFitError", () => new FormatFitError("format", "q")],
  ["OperationScopeError", () => new OperationScopeError({ ok: false, outOfScope: ["div"], allowed: ["add"] }, "q")],
  ["QualityGateError", () => new QualityGateError([{ rule: "one-task", detail: "x" }], "q")],
];
/** A generator that plays the given outcomes in order and counts calls. */
function scripted(outcomes: (Exercise | Error)[]) {
  let calls = 0;
  const fn = async () => {
    const o = outcomes[Math.min(calls++, outcomes.length - 1)];
    if (o instanceof Error) throw o;
    return o;
  };
  return { fn, calls: () => calls };
}

console.log("produceExercise");
await at("first attempt succeeds → that exercise, one call, no retry", async () => {
  const g = scripted([exercise]);
  assert.deepEqual(await produceExercise(g.fn, () => template), { kind: "generated", exercise, retried: false });
  assert.equal(g.calls(), 1);
});
for (const [name, make] of REJECTIONS) {
  await at(`${name} → exactly one more live attempt, and its exercise if it succeeds`, async () => {
    const g = scripted([make(), exercise]);
    assert.deepEqual(await produceExercise(g.fn, () => template), { kind: "generated", exercise, retried: true });
    assert.equal(g.calls(), 2);
  });
}
await at("rejected twice → the vetted template, when the topic has one (no third attempt)", async () => {
  const g = scripted([new TopicFitError("a"), new FormatFitError("b", "q")]);
  const out = await produceExercise(g.fn, () => template);
  assert.equal(out.kind, "template");
  assert.equal(g.calls(), 2);
});
await at("rejected twice and no template → try_again (nothing is served)", async () => {
  const g = scripted([new QualityGateError([{ rule: "one-task", detail: "x" }], "q"), new TopicFitError("again")]);
  const out = await produceExercise(g.fn, () => null);
  assert.equal(out.kind, "try_again");
  assert.equal(g.calls(), 2);
});
await at("a real fault (not a content check) is not retried and propagates", async () => {
  const g = scripted([new Error("model down")]);
  await assert.rejects(produceExercise(g.fn, () => template), /model down/);
  assert.equal(g.calls(), 1);
});
await at("a real fault on the retry propagates too (no template masks it)", async () => {
  const g = scripted([new TopicFitError("a"), new Error("network")]);
  await assert.rejects(produceExercise(g.fn, () => template), /network/);
});
await at("isCheckRejection: the four content checks, and nothing else", () => {
  for (const [, make] of REJECTIONS) assert.equal(isCheckRejection(make()), true);
  assert.equal(isCheckRejection(new Error("x")), false);
});

console.log("\nthe route and the kid's screen");
const route = readFileSync(new URL("../app/api/tutor/route.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../lib/exercises/store.ts", import.meta.url), "utf8");
const screen = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");
await at("the route produces through produceExercise and answers try_again with 503; no unchecked-bank path remains", () => {
  assert.match(route, /await produceExercise\(/);
  assert.match(route, /error: "try_again" \}, \{ status: 503 \}/);
  for (const gone of [/ignoreTopicFit/, /bank-hit-unfiltered/]) {
    assert.ok(!gone.test(route), `route still has ${gone}`);
    assert.ok(!gone.test(store.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), `store still has ${gone}`);
  }
});
await at("the screen turns a 503 try_again into its own retry state, with the calm line (not 'משהו השתבש')", () => {
  assert.match(screen, /res\.status === 503 && data\?\.error === "try_again"[\s\S]{0,300}setNotReady\(true\)/);
  assert.equal((screen.match(/notReady \? lines\.couldNotBuild\(kidName\) : lines\.somethingBroke\(kidName\)/g) ?? []).length, 2, "both the spoken line and the bubble");
  assert.match(screen, /\{loadFailed && \(\s*<button onClick=\{\(\) => loadNextExercise\(\)\}/, "the retry button shows for try_again too (loadFailed is set)");
});
await at("the try-again line passes the feedback constitution and differs from 'something broke'", () => {
  const l = couldNotBuild("נועה");
  assert.equal(violatesConstitution(l.text), null);
  assert.notEqual(l.text, somethingBroke("נועה").text);
  assert.match(l.text, /ננסה שוב/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
