/**
 * The two-repair ladder for voice answers.
 *
 * A child who is not understood used to get the same line for as many
 * tries as they had patience for. They have no idea what to change, and
 * the only signal is that it keeps not working — which reads as "I am
 * failing" rather than "the microphone is failing".
 *
 * What these tests hold:
 *  - exactly two repairs, then a door that does not need to be heard;
 *  - never a third identical try, and never silence;
 *  - a number is never invented — a candidate is always a real answer to
 *    this exercise;
 *  - "כן" submits an answer the CHILD confirmed, which is the one thing
 *    that may be submitted after a failed match;
 *  - a repair is logged as a repair, and never as a maths error: nothing
 *    here touches the attempt record, mastery state or the verdict.
 *
 * Run: npx tsx tests/repair-ladder.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchChoice, matchNumberLine, matchYesNo } from "../lib/voice/matchAnswer";
import {
  IDLE,
  formatRepairLog,
  isConfirming,
  isSpent,
  onConfirmation,
  onUnclear,
  reset,
  type RepairState,
} from "../lib/voice/repairLadder";
import { violatesConstitution } from "../lib/feedback/constitution";

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
const say = (s: RepairState) => (s.stage.kind === "idle" ? "" : s.stage.say);

console.log("attempt 1, something plausible was heard");

t("offers the top candidate back as a question", () => {
  const s = onUnclear(IDLE, { candidates: ["12", "21"], reason: "ambiguous" });
  assert.equal(s.stage.kind, "confirming");
  assert.equal(s.stage.kind === "confirming" && s.stage.candidate, "12", "the TOP candidate, best-first");
  assert.match(say(s), /התכוונת ל-12\?/);
});

t("an empty-string candidate is not a candidate — it would confirm nothing", () => {
  const s = onUnclear(IDLE, { candidates: [""], reason: "no-match" });
  assert.equal(s.stage.kind, "retrying", 'offering "התכוונת ל-?" is worse than asking again');
});

t("the matcher offers candidates where it HAS them: tied choices are both reported", () => {
  const m = matchChoice("8", ["8", "8", "3"]);
  assert.equal(m.kind, "none");
  assert.equal(m.kind === "none" && m.reason, "ambiguous");
  assert.ok(m.kind === "none" && m.candidates.length >= 2, "an ambiguous match must say what it was torn between");
  // ...and that is what lets the ladder ask rather than give up.
  const ladder = onUnclear(IDLE, { candidates: m.kind === "none" ? m.candidates : [], reason: "ambiguous" });
  assert.equal(ladder.stage.kind, "confirming");
});

t("a number off the line is NOT offered back — it could not be tapped either", () => {
  const spec = { min: 0, max: 10, step: 1 };
  const off = matchNumberLine("תשעים ותשע", spec);
  assert.equal(off.kind, "none");
  assert.deepEqual(off.kind === "none" ? off.candidates : null, [], "never invent a number");
  const offStep = matchNumberLine("3", { min: 0, max: 10, step: 2 });
  assert.deepEqual(offStep.kind === "none" ? offStep.candidates : null, []);
  // ...so the ladder asks again rather than confirming something unanswerable.
  assert.equal(onUnclear(IDLE, { candidates: [], reason: "out-of-range" }).stage.kind, "retrying");
});

t("the confirmation is a real answer to this exercise, never a number assembled from noise", () => {
  const choices = ["8 + 3", "8 - 3", "11", "5"];
  const m = matchChoice("שמונה", choices);
  assert.equal(m.kind, "none");
  if (m.kind === "none") {
    for (const c of m.candidates) assert.ok(choices.includes(c), `${c} is not one of this exercise's answers`);
  }
});

console.log("\nattempt 1, nothing plausible was heard");

t("asks once more, plainly — and does NOT invent a candidate", () => {
  const s = onUnclear(IDLE, { candidates: [], reason: "no-match" });
  assert.equal(s.stage.kind, "retrying");
  assert.match(say(s), /לא שמעתי/);
  assert.ok(!/התכוונת/.test(say(s)), "nothing was heard, so there is nothing to confirm");
});

t("the re-ask is in the child's own gender", () => {
  const boy = say(onUnclear(IDLE, { candidates: [], reason: "no-match", gender: "boy" }));
  const girl = say(onUnclear(IDLE, { candidates: [], reason: "no-match", gender: "girl" }));
  const unknown = say(onUnclear(IDLE, { candidates: [], reason: "no-match", gender: null }));
  assert.match(boy, /תגיד שוב/);
  assert.match(girl, /תגידי שוב/);
  assert.match(unknown, /תגידו שוב/);
});

console.log("\nattempt 2 — the door, whichever way the first attempt went");

t("a second unclear attempt after a confirmation offers the tap", () => {
  const first = onUnclear(IDLE, { candidates: ["12"], reason: "ambiguous" });
  const second = onUnclear(first, { candidates: ["12"], reason: "ambiguous" });
  assert.equal(second.stage.kind, "tap-offer");
  assert.match(say(second), /ללחוץ/);
});

t("a second unclear attempt after a plain re-ask also offers the tap", () => {
  const first = onUnclear(IDLE, { candidates: [], reason: "no-match" });
  const second = onUnclear(first, { candidates: [], reason: "no-match" });
  assert.equal(second.stage.kind, "tap-offer");
});

t("with no candidate on the first try, the second goes STRAIGHT to the tap — not to a confirmation", () => {
  const first = onUnclear(IDLE, { candidates: [], reason: "no-match" });
  const second = onUnclear(first, { candidates: ["12"], reason: "ambiguous" });
  assert.equal(second.stage.kind, "tap-offer", "the ladder has two rungs, not two rungs per shape");
});

t("there is never a third identical try: further attempts stay at the door", () => {
  let s = onUnclear(IDLE, { candidates: [], reason: "no-match" });
  const seen: string[] = [say(s)];
  for (let i = 0; i < 5; i++) {
    s = onUnclear(s, { candidates: [], reason: "no-match" });
    seen.push(say(s));
  }
  assert.equal(s.stage.kind, "tap-offer");
  assert.ok(isSpent(s));
  // The first line differs from the rest; the rest are the door, repeated,
  // and the door is an answer rather than another request to be heard.
  assert.equal(new Set(seen).size, 2, `the ladder must not cycle through lines: ${JSON.stringify(seen)}`);
});

t("never silence: every stage carries something to say", () => {
  const states = [
    onUnclear(IDLE, { candidates: ["12"], reason: "ambiguous" }),
    onUnclear(IDLE, { candidates: [], reason: "no-match" }),
    onUnclear(onUnclear(IDLE, { candidates: [], reason: "no-match" }), { candidates: [], reason: "no-match" }),
  ];
  for (const s of states) {
    assert.ok(say(s).trim().length > 0, `a stage with nothing to say: ${s.stage.kind}`);
    assert.equal(violatesConstitution(say(s)), null, "repair lines obey the feedback constitution");
  }
});

console.log("\nconfirming");

t("'כן' submits the candidate as the child's OWN answer", () => {
  const s = onUnclear(IDLE, { candidates: ["12"], reason: "ambiguous" });
  const out = onConfirmation(s, "yes");
  assert.equal(out.action, "submit");
  assert.equal(out.action === "submit" && out.value, "12");
  assert.deepEqual(out.state, IDLE, "the ladder is done once an answer is given");
});

t("'לא' goes to the tap, not to a second guess at the same misheard word", () => {
  const s = onUnclear(IDLE, { candidates: ["12"], reason: "ambiguous" });
  const out = onConfirmation(s, "no");
  assert.equal(out.action, "offer-tap");
  assert.equal(out.state.stage.kind, "tap-offer");
  assert.ok(isSpent(out.state));
});

t("a confirmation answered when nothing was being confirmed is ignored", () => {
  assert.equal(onConfirmation(IDLE, "yes").action, "ignore");
  const spent = onUnclear(onUnclear(IDLE, { candidates: [], reason: "no-match" }), { candidates: [], reason: "no-match" });
  assert.equal(onConfirmation(spent, "yes").action, "ignore", "the door is not a yes/no question");
});

t("isConfirming is true only while a candidate is on offer", () => {
  assert.equal(isConfirming(IDLE), false);
  assert.equal(isConfirming(onUnclear(IDLE, { candidates: ["12"], reason: "ambiguous" })), true);
  assert.equal(isConfirming(onUnclear(IDLE, { candidates: [], reason: "no-match" })), false);
});

console.log("\nyes / no, by voice — a deliberately tiny vocabulary");

t("hears כן and לא, and the common polite variants", () => {
  for (const s of ["כן", "כן!", "נכון", "בדיוק"]) assert.equal(matchYesNo(s), "yes", s);
  for (const s of ["לא", "לא!", "לא נכון"]) assert.equal(matchYesNo(s), "no", s);
});

t("hears a leading כן/לא in a longer reply", () => {
  assert.equal(matchYesNo("כן, שתים עשרה"), "yes");
  assert.equal(matchYesNo("לא, אמרתי עשרים"), "no");
});

t("anything else is null — another unclear attempt, never a guess", () => {
  for (const s of ["", "אולי", "שתים עשרה", "אמממ"]) assert.equal(matchYesNo(s), null, s);
});

console.log("\na new question starts over");

t("reset returns the ladder to idle", () => {
  const spent = onUnclear(onUnclear(IDLE, { candidates: [], reason: "no-match" }), { candidates: [], reason: "no-match" });
  assert.equal(reset().stage.kind, "idle");
  assert.equal(reset().unclearCount, 0);
  assert.ok(isSpent(spent), "sanity: the state it replaces was spent");
});

console.log("\na repair is logged as a repair, never as a maths error");

t("the log line is structured, prefixed, and carries no transcript", () => {
  const line = formatRepairLog({ exerciseId: "ex_1", reason: "ambiguous", unclearCount: 1, outcome: "confirm", candidate: "12" });
  assert.match(line, /^\[stt-repair\] /);
  assert.match(line, /exercise=ex_1/);
  assert.match(line, /reason=ambiguous/);
  assert.match(line, /outcome=confirm/);
  assert.match(line, /candidate="12"/);
});

t("a candidate-free repair logs no candidate field at all", () => {
  const line = formatRepairLog({ exerciseId: "ex_1", reason: "no-match", unclearCount: 2, outcome: "tap-offer" });
  assert.ok(!line.includes("candidate="), "nothing to report is reported as nothing");
});

console.log("\nthe wiring (source tripwire — this screen has no DOM harness)");

const src = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");

t("a repair never records an attempt and never touches mastery or the verdict", () => {
  const ladder = src.slice(src.indexOf("const askToRepeat"), src.indexOf("const handleMicError"));
  for (const name of ["recordAttempt", "setAttempt", "setEvaluation", "topicStatsRef"]) {
    assert.ok(!ladder.includes(name), `the repair path must not touch ${name}`);
  }
});

t("the ladder is fed the matcher's OWN candidates, not something reconstructed", () => {
  assert.match(src, /askToRepeat\(\{ candidates: match\.candidates, reason: match\.reason/);
});

t("while confirming, the next thing said is read as כן/לא rather than as an answer", () => {
  assert.match(src, /if \(repair\.isConfirming\(repairState\)\)/);
  assert.match(src, /const yn = matchYesNo\(transcript\)/);
});

t("both paths are equal: the buttons call the same handler the voice does", () => {
  assert.match(src, /onClick=\{\(\) => answerConfirmation\("yes"\)\}/);
  assert.match(src, /onClick=\{\(\) => answerConfirmation\("no"\)\}/);
  assert.match(src, /answerConfirmation\(yn\)/);
});

t("a new exercise resets the ladder — two tries at THIS question", () => {
  // Pinned to the new-exercise reset block specifically: other reset call
  // sites exist, and matching any of them would not prove this one.
  const block = src.slice(src.indexOf("setLoadingExercise(true);"), src.indexOf("setAttempt(1);"));
  assert.match(block, /setRepairState\(repair\.reset\(\)\)/, "the ladder must reset where a new question is loaded");
});

t("a clear answer also resets it, so one bad turn doesn't shorten the next", () => {
  const voice = src.slice(src.indexOf("function handleVoiceResult"), src.indexOf("function handleVoiceResult") + 2400);
  assert.ok((voice.match(/setRepairState\(repair\.reset\(\)\)/g) ?? []).length >= 2, "reset on each successful match");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
