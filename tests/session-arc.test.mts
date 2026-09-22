/**
 * The session arc: one idea, opened, worked, closed — and leavable.
 *
 * Three beats, each allowed once, in order. What these tests hold:
 *  - the goal line is said once and only at the start;
 *  - "איך ידעת?" is asked at most once a session, and only after the
 *    character has just named a strategy the child used — never after a
 *    lucky guess, which would ask a child to invent a reason;
 *  - the closing beat describes CHANGE, never a score, and is true even on
 *    a session that went badly;
 *  - leaving carries no guilt, and no sad character exists to show.
 *
 * Run: npx tsx tests/session-arc.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARC_START,
  NO_OBSERVATIONS,
  askHowDidYouKnow,
  closeSession,
  goalLine,
  improvementSeen,
  nextStationName,
  openSession,
  shouldAskHowDidYouKnow,
  type SessionObservations,
} from "../lib/session/arc";
import {
  EXIT_LEAVE,
  EXIT_STAY,
  EXIT_TITLE,
  HOW_DID_YOU_KNOW,
  IMPROVEMENT,
  namesAStrategy,
  violatesConstitution,
} from "../lib/feedback/constitution";
import { POSES } from "../lib/characters";

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
const obs = (o: Partial<SessionObservations> = {}): SessionObservations => ({
  ...NO_OBSERVATIONS, firstAttemptByProblem: [], hintsByProblem: [], ...o,
});

console.log("beat 1 — the goal line");

t("names today's idea, once, at the start", () => {
  const first = openSession(ARC_START, "math-b-time");
  assert.ok(first.say, "a session with a topic opens by saying what it is about");
  assert.match(first.say!, /היום אנחנו לומדים/);
  assert.match(first.say!, /השעון/, "in the child's words for the topic");
  assert.equal(first.state.goalSpoken, true);
});

t("...and never again in the same session", () => {
  const first = openSession(ARC_START, "math-b-time");
  for (let i = 0; i < 5; i++) {
    const again = openSession(first.state, "math-b-time");
    assert.equal(again.say, null, "the goal is not re-announced on every question");
  }
});

t("free practice has no single idea for the day, and says nothing rather than inventing one", () => {
  assert.equal(goalLine(undefined), null);
  assert.equal(goalLine("not-a-topic"), null);
  assert.equal(openSession(ARC_START, undefined).say, null);
});

console.log("\nbeat 2 — \"איך ידעת?\", at most once");

const STRATEGY = "ראיתי שספרת הלאה מה-4.";
const PLAIN = "מצאת את זה!";

t("asked after the character names a strategy on a first-attempt success", () => {
  assert.equal(shouldAskHowDidYouKnow(ARC_START, { correct: true, attempt: 1, spokenLine: STRATEGY }), true);
});

t("NOT asked when the line named nothing — a lucky guess has no method to explain", () => {
  assert.equal(shouldAskHowDidYouKnow(ARC_START, { correct: true, attempt: 1, spokenLine: PLAIN }), false);
});

t("NOT asked on a wrong answer, nor on a retry that landed", () => {
  assert.equal(shouldAskHowDidYouKnow(ARC_START, { correct: false, attempt: 1, spokenLine: STRATEGY }), false);
  assert.equal(shouldAskHowDidYouKnow(ARC_START, { correct: true, attempt: 2, spokenLine: STRATEGY }), false);
});

t("asked at most ONCE a session, however many strategy-named successes follow", () => {
  let state = ARC_START;
  assert.equal(shouldAskHowDidYouKnow(state, { correct: true, attempt: 1, spokenLine: STRATEGY }), true);
  state = askHowDidYouKnow(state).state;
  for (let i = 0; i < 6; i++) {
    assert.equal(
      shouldAskHowDidYouKnow(state, { correct: true, attempt: 1, spokenLine: STRATEGY }),
      false,
      "asked twice it stops being a question and becomes a quiz"
    );
  }
});

t("the question itself is the brief's, and obeys the constitution", () => {
  assert.equal(askHowDidYouKnow(ARC_START).say, HOW_DID_YOU_KNOW);
  assert.equal(HOW_DID_YOU_KNOW, "איך ידעת?");
  assert.equal(violatesConstitution(HOW_DID_YOU_KNOW), null);
});

t("the strategy detector keys on what the child DID, not on warmth", () => {
  for (const line of ["ראיתי שספרת הלאה מה-4", "הדרך שבחרת עבדה", "פירקת את זה לעשרות", "התחלת מהמספר הגדול"]) {
    assert.equal(namesAStrategy(line), true, line);
  }
  for (const line of ["כל הכבוד!", "מצאת את זה!", "נכון מאוד", "יופי"]) {
    assert.equal(namesAStrategy(line), false, `"${line}" names no method`);
  }
});

console.log("\nbeat 3 — the closing beat");

t("describes CHANGE, and never a score", () => {
  const o = obs({ attempted: 4, correct: 3, firstAttemptByProblem: [false, false, true, true], hintsByProblem: [2, 1, 0, 0] });
  const said = closeSession(ARC_START, o, { subject: "math", grade: "ב", topicId: "math-b-time" }).say;
  assert.ok(!/\d+ מתוך \d+/.test(said), `a score reached the closing beat: ${said}`);
  assert.equal(violatesConstitution(said), null);
});

t("notices getting there first-time by the end", () => {
  assert.equal(improvementSeen(obs({ firstAttemptByProblem: [false, false, true, true] })), IMPROVEMENT.fasterByTheEnd);
});

t("notices needing fewer hints", () => {
  const o = obs({ firstAttemptByProblem: [true, true, true, true], hintsByProblem: [2, 2, 0, 0] });
  assert.equal(improvementSeen(o), IMPROVEMENT.neededFewerHints);
});

t("notices recovering after a miss", () => {
  const o = obs({ correct: 2, firstAttemptByProblem: [true, false], hintsByProblem: [0, 0] });
  assert.equal(improvementSeen(o), IMPROVEMENT.recoveredAfterAMiss);
});

t("falls back to something TRUE on a session where nothing improved", () => {
  assert.equal(improvementSeen(obs()), IMPROVEMENT.steady);
  assert.equal(improvementSeen(obs({ firstAttemptByProblem: [true, true], hintsByProblem: [0, 0] })), IMPROVEMENT.steady);
  // The floor must not claim an improvement that did not happen.
  assert.ok(!IMPROVEMENT.steady.includes("בסוף"), "the floor line must not imply a change");
});

t("every improvement line obeys the constitution and praises no one's character", () => {
  for (const [name, line] of Object.entries(IMPROVEMENT)) {
    assert.equal(violatesConstitution(line), null, name);
    assert.ok(line.trim().length > 0, name);
  }
});

t("names the next station on the map", () => {
  const said = closeSession(ARC_START, obs(), { subject: "math", grade: "ב", topicId: "math-b-geometry" }).say;
  assert.match(said, /התחנה הבאה במפה/);
  assert.ok(nextStationName("math", "ב", "math-b-geometry"), "there is a next stop after geometry");
});

t("...and promises nothing when this is the last stop", () => {
  const topics = ["math-b-numbers-0-1000", "math-b-arithmetic", "math-b-geometry", "math-b-length", "math-b-volume", "math-b-time", "math-b-data"];
  const last = topics[topics.length - 1];
  assert.equal(nextStationName("math", "ב", last), null, "the last stop has nothing after it");
  const said = closeSession(ARC_START, obs(), { subject: "math", grade: "ב", topicId: last }).say;
  assert.ok(!said.includes("התחנה הבאה"), `promised a station that does not exist: ${said}`);
});

t("free practice names no station either", () => {
  assert.equal(nextStationName("math", "ב", undefined), null);
});

console.log("\nbeat order");

t("goal comes before the close, and the close can only happen once", () => {
  const opened = openSession(ARC_START, "math-b-time");
  assert.equal(opened.state.closed, false, "opening does not close");
  const closed = closeSession(opened.state, obs(), { subject: "math", grade: "ב", topicId: "math-b-time" });
  assert.equal(closed.state.closed, true);
  assert.equal(closed.state.goalSpoken, true, "closing preserves that the goal was said");
});

t("the once-per-session question survives the close", () => {
  const asked = askHowDidYouKnow(ARC_START);
  const closed = closeSession(asked.state, obs(), { subject: "math", grade: "ב", topicId: "math-b-time" });
  assert.equal(closed.state.howDidYouKnowAsked, true);
});

console.log("\nleaving, at any point");

t("the exit copy carries no guilt and nothing about losing work", () => {
  for (const s of [EXIT_TITLE, EXIT_STAY, EXIT_LEAVE]) {
    assert.equal(violatesConstitution(s), null, s);
    assert.ok(!/לא יישמר|בטוח|באמת|תוותר|חבל/.test(s), `guilt or loss framing in the exit copy: ${s}`);
  }
  assert.ok(!EXIT_TITLE.includes("לצאת מהתרגיל"), "leaving is going back to the map, not abandoning something");
});

t("there is no sad character to show — the pose set has none", () => {
  for (const pose of POSES) {
    assert.ok(!/sad|disappoint|upset|cry/.test(pose), `a sad pose exists: ${pose}`);
  }
});

console.log("\nthe wiring (source tripwire — this screen has no DOM harness)");

const src = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");

t("the goal line is said at the first question, through the arc", () => {
  assert.match(src, /arc\.openSession\(arcRef\.current, topicId\)/);
});

t("\"איך ידעת?\" is decided on the PROSE, not on the fixed opener", () => {
  assert.match(src, /shouldAskHowDidYouKnow\(arcRef\.current, \{ correct: verdictCorrect, attempt, spokenLine: prose \}\)/);
  assert.ok(!/shouldAskHowDidYouKnow\([^)]*spokenLine: opener/.test(src), "the opener never names a strategy");
});

t("the arc's once-per-session memory is NOT reset between questions", () => {
  const reset = src.slice(src.indexOf("setLoadingExercise(true);"), src.indexOf("setAttempt(1);"));
  assert.ok(!/arcRef\.current = arc\.ARC_START/.test(reset), "resetting the arc per question would ask the question every time");
  assert.match(reset, /setHowDidYouKnow\(null\)/, "the displayed question does clear per question");
});

t("the closing beat replaces the generic session-complete line", () => {
  assert.match(src, /arc\.closeSession\(arcRef\.current, observationsRef\.current/);
});

t("observations are collected per PROBLEM, not per submission", () => {
  assert.match(src, /if \(attempt === 1\) \{[\s\S]{0,400}firstAttemptByProblem\.push\(correct\)/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
