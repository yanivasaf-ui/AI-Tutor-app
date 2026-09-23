/**
 * The field-test session log: schema, and the four measures it has to
 * answer (docs/investigations/field-test-plan.md).
 *
 * Two of the four measures are observations, not telemetry — this file
 * tests the two that are not, and the shape of the export a researcher
 * takes off the device. The thing most worth protecting is that the log
 * carries no answer text: an export must not be able to reconstruct what
 * a child said.
 *
 * Run: npx tsx tests/field-log.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_EVENTS, createSessionLog, summarize, type FieldEvent } from "../lib/fieldtest/sessionLog";

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

/** Omit over a discriminated union has to distribute, or it collapses to
 *  the keys every member shares — which is just `kind`. */
type WithoutT<T> = T extends unknown ? Omit<T, "t"> : never;
const ev = (e: WithoutT<FieldEvent>): FieldEvent => ({ t: 0, ...e }) as FieldEvent;

/** A session: two problems, the first tapped after two repairs. */
function sampleSession(): FieldEvent[] {
  return [
    ev({ kind: "session-start", subject: "math", grade: "ב", topicId: "math-b-time" }),
    ev({ kind: "problem-start", problem: 1, exerciseId: "ex_1", subtype: "fill_in_blank" }),
    ev({ kind: "stt-repair", problem: 1, reason: "no-match", outcome: "retrying", unclear: 1 }),
    ev({ kind: "stt-repair", problem: 1, reason: "no-match", outcome: "tap-offer", unclear: 2 }),
    ev({ kind: "answer", problem: 1, via: "tap", attempt: 1, correct: true }),
    ev({ kind: "audible", problem: 1, ms: 900 }),
    ev({ kind: "problem-start", problem: 2, exerciseId: "ex_2", subtype: "pick_operation" }),
    ev({ kind: "hint-rung", problem: 2, rung: "rephrase", rungNumber: 1 }),
    ev({ kind: "hint-rung", problem: 2, rung: "shrink", rungNumber: 2 }),
    ev({ kind: "answer", problem: 2, via: "voice", attempt: 1, correct: false }),
    ev({ kind: "audible", problem: 2, ms: 1500 }),
    ev({ kind: "session-end", reason: "left", lastProblem: 2 }),
  ];
}

console.log("measure 1 — repairs before a child gives up on voice");

t("counts repairs only on problems the child ended up TAPPING", () => {
  const s = summarize(sampleSession());
  assert.deepEqual(s.repairsBeforeTap, [2], "problem 1 was tapped after two repairs");
});

t("a problem tapped with NO repairs is not counted — that is just a preference", () => {
  const s = summarize([
    ev({ kind: "problem-start", problem: 1, exerciseId: "e", subtype: null }),
    ev({ kind: "answer", problem: 1, via: "tap", attempt: 1, correct: true }),
  ]);
  assert.deepEqual(s.repairsBeforeTap, []);
});

t("a problem with repairs that was answered by VOICE is not counted either", () => {
  const s = summarize([
    ev({ kind: "problem-start", problem: 1, exerciseId: "e", subtype: null }),
    ev({ kind: "stt-repair", problem: 1, reason: "ambiguous", outcome: "confirming", unclear: 1 }),
    ev({ kind: "answer", problem: 1, via: "voice", attempt: 1, correct: true }),
  ]);
  assert.deepEqual(s.repairsBeforeTap, [], "the child did not give up; the repair worked");
  assert.equal(s.repairs, 1, "...but the repair still happened and is counted overall");
});

console.log("\nmeasure 2 — hint rungs per problem");

t("rungs are counted per problem, in problem order, including zeroes", () => {
  const s = summarize(sampleSession());
  assert.deepEqual(s.hintRungsPerProblem, [0, 2], "problem 1 took no hints, problem 2 took two rungs");
});

console.log("\nmeasure 4 — how the session ended");

t("records the reason and the problem it ended on", () => {
  assert.deepEqual(summarize(sampleSession()).ending, { reason: "left", atProblem: 2 });
});

t("a session with no end event is 'still-open', at the last problem reached", () => {
  const s = summarize(sampleSession().filter((e) => e.kind !== "session-end"));
  assert.deepEqual(s.ending, { reason: "still-open", atProblem: 2 });
});

t("completing a station is a different ending from leaving", () => {
  const s = summarize([ev({ kind: "session-end", reason: "completed", lastProblem: 3 })]);
  assert.equal(s.ending.reason, "completed");
});

console.log("\ntap vs voice, and time-to-audible");

t("the share is over answers, and is null when nothing was answered", () => {
  const s = summarize(sampleSession());
  assert.deepEqual(s.tapVsVoice, { tap: 1, voice: 1, voiceShare: 0.5 });
  assert.equal(summarize([]).tapVsVoice.voiceShare, null, "no answers means no share, not zero");
});

t("time-to-audible reports n, median and max — and null rather than 0 when empty", () => {
  const s = summarize(sampleSession());
  assert.deepEqual(s.timeToAudibleMs, { n: 2, median: 1200, max: 1500 });
  assert.deepEqual(summarize([]).timeToAudibleMs, { n: 0, median: null, max: null });
});

t("an odd number of timings takes the middle one", () => {
  const s = summarize([
    ev({ kind: "audible", problem: 1, ms: 100 }),
    ev({ kind: "audible", problem: 2, ms: 900 }),
    ev({ kind: "audible", problem: 3, ms: 500 }),
  ]);
  assert.equal(s.timeToAudibleMs.median, 500);
});

t("timing is its OWN event — one answer never counts twice in the share", () => {
  const s = summarize([
    ev({ kind: "answer", problem: 1, via: "voice", attempt: 1, correct: true }),
    ev({ kind: "audible", problem: 1, ms: 700 }),
  ]);
  assert.deepEqual(s.tapVsVoice, { tap: 0, voice: 1, voiceShare: 1 }, "the audible row must not be counted as an answer");
  assert.equal(s.timeToAudibleMs.n, 1);
});

console.log("\nthe recorder and the export");

t("the recorder stamps its OWN clock, so events can be lined up against each other", () => {
  let now = 1000;
  const log = createSessionLog(() => now);
  log.add({ t: 999999, kind: "problem-start", problem: 1, exerciseId: "e", subtype: null });
  now = 1500;
  log.add({ t: 0, kind: "answer", problem: 1, via: "tap", attempt: 1, correct: true });
  const [a, b] = log.events();
  assert.equal(a.t, 1000, "a caller-supplied timestamp is overwritten");
  assert.equal(b.t, 1500);
});

t("the export is JSON carrying both the summary and the raw events", () => {
  const log = createSessionLog(() => 42);
  for (const e of sampleSession()) log.add(e);
  const parsed = JSON.parse(log.toJSON());
  assert.equal(parsed.version, 1);
  assert.equal(parsed.exportedAt, 42);
  assert.ok(Array.isArray(parsed.events), "raw events are needed to line up a researcher's notes");
  assert.equal(parsed.events.length, sampleSession().length);
  assert.deepEqual(parsed.summary.repairsBeforeTap, [2]);
});

t("it is bounded — a long session cannot grow without limit", () => {
  const log = createSessionLog();
  for (let i = 0; i < MAX_EVENTS + 120; i++) {
    log.add({ t: 0, kind: "audible", problem: 1, ms: i });
  }
  assert.equal(log.events().length, MAX_EVENTS);
  // The tail is what is kept: the end of a session is what a researcher reads.
  assert.equal((log.events()[MAX_EVENTS - 1] as { ms: number }).ms, MAX_EVENTS + 119);
});

t("reset clears it for the next child", () => {
  const log = createSessionLog();
  log.add({ t: 0, kind: "audible", problem: 1, ms: 1 });
  log.reset();
  assert.equal(log.events().length, 0);
});

console.log("\nnothing a child said can be reconstructed from an export");

t("no event kind carries answer text, a transcript, or a name", () => {
  const log = createSessionLog();
  for (const e of sampleSession()) log.add(e);
  const json = log.toJSON();
  for (const forbidden of ["kidAnswer", "transcript", "answerText", "kidName", "correctAnswer", "spokenLine"]) {
    assert.ok(!json.includes(forbidden), `the export carries ${forbidden}`);
  }
});

t("the schema has no free-text field a caller could smuggle one into", () => {
  const src = readFileSync(new URL("../lib/fieldtest/sessionLog.ts", import.meta.url), "utf8");
  const union = src.slice(src.indexOf("export type FieldEvent"), src.indexOf("export type EventKind"));
  // Every string-typed field is an enum-ish identifier, not prose.
  for (const field of ["subject", "grade", "topicId", "exerciseId", "subtype", "reason", "outcome", "rung", "via"]) {
    assert.ok(union.includes(field), `${field} should be in the schema`);
  }
  assert.ok(!/answer:\s*string/.test(union), "no answer field");
  assert.ok(!/text:\s*string/.test(union), "no free-text field");
});

t("it never reaches the network or storage", () => {
  const src = readFileSync(new URL("../lib/fieldtest/sessionLog.ts", import.meta.url), "utf8");
  for (const sink of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "navigator.sendBeacon", "indexedDB"]) {
    assert.ok(!src.includes(sink), `the log reaches ${sink}`);
  }
});

console.log("\nthe wiring and the plan");

const screen = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");

t("all five capture points are wired", () => {
  for (const [what, re] of [
    ["session start", /kind: "session-start"/],
    ["problem start", /kind: "problem-start"/],
    ["answers", /kind: "answer"/],
    ["repairs", /kind: "stt-repair"/],
    ["hint rungs", /kind: "hint-rung"/],
    ["time-to-audible", /kind: "audible"/],
    ["abandonment", /kind: "session-end", reason: "left"/],
  ] as const) {
    assert.match(screen, re, `${what} is not captured`);
  }
});

t("the answer's modality is taken from how it was submitted, not guessed", () => {
  assert.match(screen, /via: opts\?\.viaVoice \? "voice" : "tap"/);
});

t("the export handle is a console function, not a button a child can reach", () => {
  assert.match(screen, /__fieldTestSession/);
  assert.ok(!/onClick=\{[^}]*__fieldTest/.test(screen), "it must not be tappable mid-session");
});

t("the plan covers the three scenarios and names all four measures", () => {
  const plan = readFileSync(new URL("../docs/investigations/field-test-plan.md", import.meta.url), "utf8");
  for (const s of ["answers correctly", "answers wrong", "ASR failure"]) {
    assert.ok(plan.includes(s), `scenario missing: ${s}`);
  }
  for (const m of ["Repairs before tap", "Hint comprehension", "it's broken", "Ending feel"]) {
    assert.ok(plan.includes(m), `measure missing: ${m}`);
  }
  assert.match(plan, /present but does not guide/, "the one rule for the room");
  assert.match(plan, /5–8 children, ages 6–8/);
  assert.match(plan, /not in the log/i, "the plan must say which measures are observations");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
