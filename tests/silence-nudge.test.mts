/**
 * feat: local UX wins item 2 — after 8s of kid silence in an answer window
 * the character leans in.
 *
 * Two things are under test:
 *  1. The MECHANISM (lib/voice/silenceNudge.ts) on a fake clock: when it
 *     fires, when it must NOT, and when it lets go.
 *  2. The COPY GATE (lib/guide/nudges.ts): the lean ships on, the spoken
 *     Hebrew line ships OFF. No new Hebrew reaches a child without Udi, so
 *     that has to be a tested invariant, not a comment.
 *
 * Run: npx tsx tests/silence-nudge.test.mts
 */
import assert from "node:assert/strict";
import { SILENCE_NUDGE_MS, createSilenceNudge } from "../lib/voice/silenceNudge";
import {
  SILENCE_NUDGE_LEANS,
  SILENCE_NUDGE_LINE,
  SILENCE_NUDGE_SPEAKS,
  silenceNudgeActions,
} from "../lib/guide/nudges";

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

function rig(thresholdMs?: number) {
  let clock = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  let timerSets = 0;
  const log: string[] = [];
  const nudge = createSilenceNudge({
    thresholdMs,
    onNudge: () => log.push("nudge"),
    onRelax: () => log.push("relax"),
    now: () => clock,
    setTimer: (fn, ms) => {
      timerSets++;
      const id = nextId++;
      timers.set(id, { at: clock + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
  });
  return {
    nudge,
    log,
    advance(ms: number) {
      clock += ms;
      for (const [id, tm] of [...timers]) {
        if (tm.at <= clock) {
          timers.delete(id);
          tm.fn();
        }
      }
    },
    pendingTimers: () => timers.size,
    timerSets: () => timerSets,
  };
}

console.log("the mechanism");

t("the threshold is 8 seconds, as specified", () => {
  assert.equal(SILENCE_NUDGE_MS, 8000);
});

t("fires once, exactly at 8s of silence in an open window", () => {
  const r = rig();
  r.nudge.open();
  r.advance(7999);
  assert.deepEqual(r.log, [], "must not fire early");
  r.advance(1);
  assert.deepEqual(r.log, ["nudge"]);
  r.advance(60_000);
  assert.deepEqual(r.log, ["nudge"], "must not repeat by itself while the kid stays silent");
});

t("does nothing at all if the window was never opened", () => {
  const r = rig();
  r.advance(60_000);
  r.nudge.activity();
  assert.deepEqual(r.log, []);
  assert.equal(r.pendingTimers(), 0);
});

t("activity restarts the clock: 7s of silence, a tap, then 7 more is still not a nudge", () => {
  const r = rig();
  r.nudge.open();
  r.advance(7000);
  r.nudge.activity();
  r.advance(7000);
  assert.deepEqual(r.log, []);
  r.advance(1000);
  assert.deepEqual(r.log, ["nudge"], "8s after the LAST activity");
});

t("a kid who is busy answering is never nudged", () => {
  const r = rig();
  r.nudge.open();
  for (let i = 0; i < 40; i++) {
    r.advance(1000);
    r.nudge.activity(); // a tap every second for 40s
  }
  assert.deepEqual(r.log, []);
});

t("activity ends a showing nudge, and a later silence can nudge again", () => {
  const r = rig();
  r.nudge.open();
  r.advance(8000);
  assert.equal(r.nudge.nudged, true);
  r.nudge.activity();
  assert.deepEqual(r.log, ["nudge", "relax"]);
  assert.equal(r.nudge.nudged, false);
  r.advance(8000);
  assert.deepEqual(r.log, ["nudge", "relax", "nudge"]);
});

t("closing the window cancels a pending nudge (an answer was submitted)", () => {
  const r = rig();
  r.nudge.open();
  r.advance(5000);
  r.nudge.close();
  assert.equal(r.pendingTimers(), 0, "the timer must be cleared, not merely ignored");
  r.advance(60_000);
  assert.deepEqual(r.log, []);
});

t("closing the window relaxes a nudge that was showing", () => {
  const r = rig();
  r.nudge.open();
  r.advance(8000);
  r.nudge.close();
  assert.deepEqual(r.log, ["nudge", "relax"]);
  assert.equal(r.nudge.isOpen, false);
});

t("re-opening the window restarts the count from zero (the character finished speaking)", () => {
  const r = rig();
  r.nudge.open();
  r.advance(6000);
  r.nudge.close(); // the character started talking
  r.nudge.open(); // ...and finished
  r.advance(7999);
  assert.deepEqual(r.log, [], "silence while the character talks must not count toward the 8s");
  r.advance(1);
  assert.deepEqual(r.log, ["nudge"]);
});

t("a drag's storm of pointer events costs no timer churn, and the threshold stays EXACT", () => {
  const r = rig();
  r.nudge.open();
  const armedAtOpen = r.timerSets();
  // 60 events across one second, the way a finger drag delivers them.
  for (let i = 0; i < 60; i++) {
    r.advance(1000 / 60);
    r.nudge.activity();
  }
  assert.equal(r.timerSets(), armedAtOpen, "recording activity must not touch the timer at all");
  // Exactly 8s after the LAST event: not a moment sooner, and then it fires.
  r.advance(SILENCE_NUDGE_MS - 1);
  assert.deepEqual(r.log, [], "must not fire even 1ms early — a throttled restart would have");
  r.advance(1);
  assert.deepEqual(r.log, ["nudge"]);
});

t("a kid who acts just before the deadline gets the full 8s again, with one re-arm not many", () => {
  const r = rig();
  r.nudge.open();
  const before = r.timerSets();
  r.advance(7900);
  r.nudge.activity();
  r.advance(100); // the original timer fires here and finds the kid was active
  assert.deepEqual(r.log, []);
  assert.equal(r.timerSets() - before, 1, "one re-arm for the remainder");
  r.advance(7899);
  assert.deepEqual(r.log, []);
  r.advance(1);
  assert.deepEqual(r.log, ["nudge"]);
});

t("a custom threshold is honoured", () => {
  const r = rig(500);
  r.nudge.open();
  r.advance(499);
  assert.deepEqual(r.log, []);
  r.advance(1);
  assert.deepEqual(r.log, ["nudge"]);
});

console.log("\nthe copy gate: no Hebrew reaches a child without Udi");

t("the spoken line SHIPS DISABLED", () => {
  assert.equal(SILENCE_NUDGE_SPEAKS, false, "SILENCE_NUDGE_SPEAKS must stay false until Udi approves the line");
});

t("with the flag off, a nudge speaks nothing — even though a line exists", () => {
  assert.ok(SILENCE_NUDGE_LINE.length > 0, "the placeholder line exists so the mechanism can be exercised");
  assert.equal(silenceNudgeActions().speak, null);
});

t("the visual lean-in SHIPS ENABLED", () => {
  assert.equal(SILENCE_NUDGE_LEANS, true);
  assert.equal(silenceNudgeActions().lean, true);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
