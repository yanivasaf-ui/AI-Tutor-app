/**
 * The deterministic hint ladder.
 *
 * Before this, a wrong answer bought one model-written hint of about eight
 * words, and if it did not land the next thing the child got was the
 * answer. A cliff, not a ladder — and the hint varied run to run on the
 * same question.
 *
 * The properties that matter, and what each test is really protecting:
 *  - the rungs are fixed and always advance, so a child asking again gets
 *    something NEW rather than the same sentence louder;
 *  - every arithmetic claim is computed, not written. The strongest test
 *    here re-runs each generated line through lineIsArithmeticallySafe(),
 *    the same gate the character's feedback must pass;
 *  - a twin is genuinely easier AND genuinely solvable — never negative,
 *    never a remainder;
 *  - the problem ends on a small win the child answers themselves;
 *  - none of it touches the verdict path.
 *
 * Run: npx tsx tests/hint-ladder.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeAnswer, lineIsArithmeticallySafe, type Computation, type Operator } from "../lib/exercises/arithmetic";
import { buildRung, isUsableTwin, ladderFor, nextRung, renderComputation, shrinkOf, twinOf, type RungKind } from "../lib/exercises/hintLadder";
import { violatesConstitution } from "../lib/feedback/constitution";
import type { Exercise } from "../lib/exercises/types";

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

const ex = (computation: Computation | undefined, over: Partial<Exercise> = {}): Exercise =>
  ({
    id: "ex_1", subject: "math", grade: "ב", type: "open", subtype: "fill_in_blank",
    topic: "t", topicId: "math-b-arithmetic", question: "כמה זה 24 + 37?",
    correctAnswer: "61", difficulty: 2, computation, ...over,
  }) as Exercise;

const SUM = { operands: [24, 37], operators: ["+" as Operator] };

console.log("the shape of the ladder");

t("a computation exercise gets all five rungs, in order", () => {
  assert.deepEqual(ladderFor(ex(SUM)), ["rephrase", "shrink", "twin", "solve", "small-win"]);
});

t("an exercise with no computation skips the twin: rephrase -> shrink -> solve together", () => {
  const rubric = ex(undefined, { subtype: "explain_thinking", question: "איך הגעת לתשובה?" });
  assert.deepEqual(ladderFor(rubric), ["rephrase", "shrink", "solve", "small-win"]);
  assert.equal(buildRung(rubric, "twin"), null, "there is no structure to build an easier twin from");
});

t("asking again always advances, and the ladder ends rather than cycling", () => {
  const e = ex(SUM);
  const seen: RungKind[] = [];
  let cur: RungKind | null = null;
  for (let i = 0; i < 10; i++) {
    cur = nextRung(e, cur);
    if (cur === null) break;
    seen.push(cur);
  }
  assert.deepEqual(seen, ["rephrase", "shrink", "twin", "solve", "small-win"]);
  assert.equal(nextRung(e, "small-win"), null, "the ladder ends; it does not wrap around");
  assert.equal(new Set(seen).size, seen.length, "a child never gets the same rung twice");
});

console.log("\nevery arithmetic claim is computed, not written");

/** A spread of shapes, including the ones the bank actually contains. */
const CASES: Computation[] = [
  { operands: [24, 37], operators: ["+"] },
  { operands: [5, 3], operators: ["+"] },
  { operands: [87, 39], operators: ["-"] },
  { operands: [15, 7, 4], operators: ["-", "+"] },
  { operands: [10, 4], operators: ["*"] },
  { operands: [60, 10], operators: ["/"] },
  { operands: [12, 8], operators: ["+"] },
  { operands: [100, 25], operators: ["-"] },
];

t("every line of every rung passes the same arithmetic gate the character's feedback passes", () => {
  for (const c of CASES) {
    const answer = computeAnswer(c)!;
    const e = ex(c, { question: `כמה זה ${renderComputation(c)}?`, correctAnswer: String(answer) });
    for (const kind of ladderFor(e)) {
      const rung = buildRung(e, kind, "boy");
      if (!rung) continue;
      assert.ok(
        lineIsArithmeticallySafe(rung.say, answer, c),
        `${kind} on ${renderComputation(c)} asserts something untrue: ${rung.say}`
      );
    }
  }
});

t("...and obeys the feedback constitution", () => {
  for (const c of CASES) {
    const e = ex(c);
    for (const kind of ladderFor(e)) {
      const rung = buildRung(e, kind, "girl");
      if (!rung) continue;
      const v = violatesConstitution(rung.say);
      assert.equal(v, null, v ? `${kind}: ${v.rule}` : "");
    }
  }
});

t("no rung is ever empty — asking for help always produces something to say", () => {
  for (const c of [...CASES, undefined]) {
    const e = ex(c as Computation | undefined);
    for (const kind of ladderFor(e)) {
      const rung = buildRung(e, kind);
      if (kind === "twin" && !c) continue;
      assert.ok(rung && rung.say.trim().length > 0, `${kind} produced nothing`);
    }
  }
});

console.log("\nrung 2 — a genuinely smaller step");

t("a chain gives up its first operation", () => {
  const small = shrinkOf({ operands: [15, 7, 4], operators: ["-", "+"] });
  assert.deepEqual(small, { operands: [15, 7], operators: ["-"] });
});

t("a two-term sum in the tens gives up its tens", () => {
  assert.deepEqual(shrinkOf({ operands: [24, 37], operators: ["+"] }), { operands: [20, 30], operators: ["+"] });
});

t("a small sum has nothing smaller inside it — and becomes counting on", () => {
  assert.equal(shrinkOf({ operands: [5, 3], operators: ["+"] }), null);
  const rung = buildRung(ex({ operands: [5, 3], operators: ["+"] }), "shrink")!;
  assert.match(rung.say, /סופרים 3 קדימה/, "counting on from the larger number");
  assert.match(rung.say, /מ-5/);
});

console.log("\nrung 3 — the twin: same shape, easier, and actually solvable");

t("keeps the operators and lowers the numbers", () => {
  for (const c of CASES) {
    const twin = twinOf(c);
    assert.deepEqual(twin.operators, c.operators, `${renderComputation(c)} changed shape`);
    assert.ok(twin.operands.every((n) => n >= 1 && n <= 9), `${renderComputation(twin)} is not easier`);
  }
});

t("never negative and never a remainder — a twin that breaks is replaced, not shipped", () => {
  const nasty: Computation[] = [
    { operands: [2, 9], operators: ["-"] },   // digit-derived twin would go negative
    { operands: [7, 4], operators: ["/"] },   // ...or leave a remainder
    { operands: [100, 99], operators: ["-"] },
    { operands: [81, 9], operators: ["/"] },
    { operands: [10, 10, 10], operators: ["-", "-"] },
  ];
  for (const c of [...CASES, ...nasty]) {
    for (const offset of [0, 1]) {
      const twin = twinOf(c, offset);
      const value = computeAnswer(twin);
      assert.ok(value !== null, `${renderComputation(twin)} does not evaluate`);
      assert.ok(Number.isInteger(value) && value! >= 0, `${renderComputation(twin)} = ${value}`);
    }
  }
});

t("a 'twin' that is not actually easier is rejected — the guard the derivation relies on", () => {
  assert.equal(isUsableTwin({ operands: [24, 37], operators: ["+"] }), false, "two-digit numbers are not a twin");
  assert.equal(isUsableTwin({ operands: [0, 3], operators: ["+"] }), false, "0 is not a starting point a child counts from");
  assert.equal(isUsableTwin({ operands: [2, 6], operators: ["-"] }), false, "it would pass through a negative");
  assert.equal(isUsableTwin({ operands: [7, 2], operators: ["/"] }), false, "it would leave a remainder");
  assert.equal(isUsableTwin({ operands: [5, 2], operators: ["-"] }), true);
  assert.equal(isUsableTwin({ operands: [6, 2], operators: ["/"] }), true);
});

t("the character works the twin aloud — the child is not asked to solve it", () => {
  const rung = buildRung(ex(SUM), "twin")!;
  assert.equal(rung.practice, undefined, "a narrated twin must carry no question for the child");
  assert.match(rung.say, /נחזור לשלנו/, "it returns to the real problem");
});

console.log("\nrung 4 and the small win");

t("solving together walks the steps and lands on the real answer", () => {
  const rung = buildRung(ex(SUM), "solve")!;
  assert.match(rung.say, /61/, "the walkthrough reaches the true answer");
  assert.ok(lineIsArithmeticallySafe(rung.say, 61, SUM));
});

t("a chain is walked one step at a time, each step true", () => {
  const c = { operands: [15, 7, 4], operators: ["-" as Operator, "+" as Operator] };
  const rung = buildRung(ex(c, { correctAnswer: "12" }), "solve")!;
  assert.match(rung.say, /15 - 7 זה 8/);
  assert.match(rung.say, /8 \+ 4 זה 12/);
  assert.ok(lineIsArithmeticallySafe(rung.say, 12, c));
});

t("the small win is a question the CHILD answers, and its answer is computed", () => {
  const rung = buildRung(ex(SUM), "small-win")!;
  assert.ok(rung.practice, "the small win must carry a real question");
  assert.equal(computeAnswer(rung.practice!.computation), Number(rung.practice!.answer));
  assert.match(rung.practice!.question, /כמה זה/);
});

t("the small win is NOT the twin the child just watched", () => {
  const twin = buildRung(ex(SUM), "twin")!;
  const win = buildRung(ex(SUM), "small-win")!;
  assert.ok(!twin.say.includes(win.practice!.question.replace("כמה זה ", "").replace("?", "")),
    "handing back the worked example is not a win the child earned");
});

t("a non-arithmetic problem still ends on strategy praise, not a dead end", () => {
  const rubric = ex(undefined, { subtype: "explain_thinking", question: "איך הגעת לתשובה?", correctAnswer: "הסבר" });
  const win = buildRung(rubric, "small-win")!;
  assert.ok(win.say.trim().length > 0);
  assert.equal(win.practice, undefined, "there is no easier twin to build, so no new question");
  assert.equal(violatesConstitution(win.say), null);
});

t("the child's gender reaches the rungs that address them", () => {
  const boy = buildRung(ex(SUM), "rephrase", "boy")!.say;
  const girl = buildRung(ex(SUM), "rephrase", "girl")!.say;
  assert.notEqual(boy, girl, "a girl must not be addressed in the masculine");
});

console.log("\nit stays out of the verdict path");

t("the module never imports or touches evaluation, attempts or openers", () => {
  const src = readFileSync(new URL("../lib/exercises/hintLadder.ts", import.meta.url), "utf8");
  // Comments are allowed to NAME the things this module stays away from —
  // that is how the boundary is documented. Code may not touch them.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  for (const name of ["evaluate", "openerKindFor", "OPENERS", "recordAttempt", "secondAttempt"]) {
    assert.ok(!code.includes(name), `the hint ladder must not reference ${name} in code`);
  }
  const imports = src.split("\n").filter((l) => l.startsWith("import"));
  assert.ok(!imports.some((l) => /evaluate|openers/.test(l)), `imports reach the verdict path: ${imports.join(" | ")}`);
});

t("the screen only opens the ladder on an explicit request for a hint", () => {
  const src = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");
  assert.match(src, /requestHint/, "there must be an explicit hint request");
  // The hint request must not be wired into answer submission.
  const submit = src.slice(src.indexOf("async function submitAnswer("), src.indexOf("async function loadNextExercise("));
  assert.ok(!/requestHint|hintRung|buildRung/.test(submit), "answering must never trigger the ladder");
});

t("the small win is checked locally — it is not an exercise attempt", () => {
  const src = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");
  const win = src.slice(src.indexOf("const checkSmallWin"), src.indexOf("/** Character asks the kid to repeat"));
  for (const name of ["submitAnswer", "recordAttempt", "setAttempt", "setEvaluation", "topicStatsRef", "fetch("]) {
    assert.ok(!win.includes(name), `the small win must not touch ${name} — it would record a practice question as real work`);
  }
  assert.match(win, /answerMatchesLocally/, "it is compared in code, here");
});

t("asking for a hint by voice is never graded as an answer", () => {
  const src = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");
  const voice = src.slice(src.indexOf("function handleVoiceResult"));
  const hintIdx = voice.indexOf("requestHint()");
  const matchIdx = voice.indexOf("matchChoice(");
  assert.ok(hintIdx >= 0 && hintIdx < matchIdx, "רמז must be recognised before any answer matching");
});

t("the hint button retires when the ladder is spent — never a repeated last rung", () => {
  const src = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");
  assert.match(src, /nextRung\(exercise, hint\?\.kind \?\? null\) !== null &&/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
