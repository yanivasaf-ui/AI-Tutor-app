/**
 * The one invariant the homework prototype exists for: the character never
 * says the final answer until the child has produced it.
 *
 * This is why the walkthrough is code and not a prompt. A model asked to
 * be Socratic will eventually be helpful and give the answer, and there is
 * no way to test that it will not. A deterministic walk can be driven
 * exhaustively — so the central test below runs whole sessions answering
 * nothing but wrongly, many times over, across every shape of problem, and
 * asserts the answer never appears in a single line.
 *
 * Run: npx tsx tests/homework-socratic.test.mts
 */
import assert from "node:assert/strict";
import { computeAnswer, lineIsArithmeticallySafe, type Computation } from "../lib/exercises/arithmetic";
import { containsNumber, guardTurn, revealsAnswer, startSession, submitStep } from "../lib/homework/socratic";
import { parseHomeworkProblem } from "../lib/homework/parseProblem";

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

const PROBLEMS: Computation[] = [
  { operands: [24, 37], operators: ["+"] },
  { operands: [5, 3], operators: ["+"] },
  { operands: [87, 39], operators: ["-"] },
  { operands: [15, 7, 4], operators: ["-", "+"] },
  { operands: [10, 4], operators: ["*"] },
  { operands: [60, 10], operators: ["/"] },
  { operands: [30, 20], operators: ["-"] },   // tens step would equal the answer
  { operands: [40, 30], operators: ["+"] },   // units step is 0
  { operands: [12, 8], operators: ["+"] },
  { operands: [100, 25], operators: ["-"] },
  { operands: [6, 0, 0], operators: ["+", "+"] },
];

console.log("the invariant: the answer is never said first");

t("a whole session of WRONG answers never once reveals the answer", () => {
  for (const c of PROBLEMS) {
    const answer = computeAnswer(c)!;
    const turn = startSession(c);
    let state = turn.state;
    const said = [...turn.lines];
    for (let i = 0; i < 30; i++) {
      // Deliberately wrong, and never accidentally right.
      const wrong = String(answer + 1 + (i % 7));
      const next = submitStep(state, wrong);
      said.push(...next.lines);
      state = next.state;
    }
    assert.equal(state.phase, "asking", `${answer}: the session solved itself without the child`);
    for (const line of said) {
      assert.ok(
        !revealsAnswer(line, state),
        `the answer ${answer} was given away before the child produced it: ${JSON.stringify(line)}`
      );
    }
  }
});

t("...including when the child keeps giving the answer to the PREVIOUS step", () => {
  const c = { operands: [24, 37], operators: ["+" as const] };
  const answer = computeAnswer(c)!;
  let { state, lines } = startSession(c);
  const said = [...lines];
  for (let i = 0; i < 12; i++) {
    const turn = submitStep(state, "50"); // right for the tens step, wrong after
    said.push(...turn.lines);
    state = turn.state;
  }
  for (const line of said) assert.ok(!revealsAnswer(line, state), `leaked ${answer}: ${line}`);
});

t("the answer is said ONLY after the child produces it, and then plainly", () => {
  for (const c of PROBLEMS) {
    const answer = computeAnswer(c)!;
    let { state } = startSession(c);
    const before: string[] = [];
    // Walk correctly, step by step, to the end.
    for (let guard = 0; guard < 10 && state.phase === "asking"; guard++) {
      const step = state.steps[state.index];
      const turn = submitStep(state, String(step.value));
      if (state.steps[state.index].final) {
        assert.equal(turn.state.phase, "solved", "the final step must end the session");
        assert.ok(turn.lines.some((l) => containsNumber(l, answer)), "the answer should be confirmed once produced");
      } else {
        before.push(...turn.lines);
      }
      state = turn.state;
    }
    assert.equal(state.phase, "solved", `${answer} was never solvable`);
    for (const line of before) assert.ok(!revealsAnswer(line, state), `leaked ${answer} mid-walk: ${line}`);
  }
});

t("a problem containing its own answer is still walkable — restating it gives nothing away", () => {
  // 6 + 0 + 0: the answer, 6, is one of the operands. Writing the problem
  // back is not telling the child anything they cannot already see.
  const c = { operands: [6, 0, 0], operators: ["+" as const, "+" as const] };
  const { state, lines } = startSession(c);
  assert.ok(lines.some((l) => l.includes("6 + 0 + 0")), "the problem is restated");
  for (const line of lines) assert.ok(!revealsAnswer(line, state), line);
  // ...but an actual reveal is still caught.
  assert.equal(revealsAnswer("התשובה היא 6", state), true);
});

t("revealsAnswer ignores the problem's own text and nothing else", () => {
  const { state } = startSession({ operands: [24, 37], operators: ["+"] });
  assert.equal(revealsAnswer("כמה זה 24 + 37?", state), false);
  assert.equal(revealsAnswer("20 + 30 זה 50", state), false);
  assert.equal(revealsAnswer("התשובה היא 61", state), true);
  assert.equal(revealsAnswer("זה יוצא 61 בסוף", state), true);
  assert.equal(revealsAnswer("כמעט, 610 זה מספר אחר", state), false, "61 must not match inside 610");
});

console.log("\nevery line passes the existing arithmetic gate, unmodified");

t("no line asserts a sum that is not true — checked with the real gate", () => {
  for (const c of PROBLEMS) {
    const answer = computeAnswer(c)!;
    let { state, lines } = startSession(c);
    const said = [...lines];
    for (let i = 0; i < 12 && state.phase === "asking"; i++) {
      const step = state.steps[state.index];
      // Alternate right and wrong so both branches are exercised.
      const turn = submitStep(state, i % 2 === 0 ? String(answer + 3) : String(step.value));
      said.push(...turn.lines);
      state = turn.state;
    }
    for (const line of said) {
      assert.ok(lineIsArithmeticallySafe(line, answer, c), `failed the arithmetic gate: ${line}`);
    }
  }
});

console.log("\nthe safety net itself");

t("the guard REFUSES a line that would give the answer away, loudly", () => {
  const { state } = startSession({ operands: [24, 37], operators: ["+"] });
  assert.throws(
    () => guardTurn({ lines: ["התשובה היא 61"], state }),
    /revealed the answer/,
    "a prototype that quietly starts handing out answers is worse than one that fails"
  );
});

t("the guard REFUSES a line that asserts arithmetic that is not true", () => {
  const { state } = startSession({ operands: [24, 37], operators: ["+"] });
  assert.throws(() => guardTurn({ lines: ["20 + 30 זה 40"], state }), /arithmetic gate/);
});

t("...and lets an honest line through", () => {
  const { state } = startSession({ operands: [24, 37], operators: ["+"] });
  assert.doesNotThrow(() => guardTurn({ lines: ["כמה זה 20 + 30?", "בדיוק, 4 + 7 זה 11."], state }));
});

t("once the child has solved it, the answer may be said", () => {
  const { state } = startSession({ operands: [24, 37], operators: ["+"] });
  assert.doesNotThrow(() => guardTurn({ lines: ["התשובה היא 61"], state: { ...state, phase: "solved" } }));
});

console.log("\nwrong turns");

t("a wrong answer gets an invitation and a question about strategy — never the number", () => {
  const c = { operands: [24, 37], operators: ["+" as const] };
  const { state } = startSession(c);
  const turn = submitStep(state, "99");
  const text = turn.lines.join(" ");
  assert.ok(turn.lines.length >= 2, "an invitation, then a way forward");
  assert.match(text, /כמעט|לא נורא/, "a neutral invitation, not a verdict on the child");
  assert.match(text, /\?/, "it ends by asking something");
  assert.ok(!containsNumber(text, state.steps[state.index].value), "it must not hand over the step's value either");
});

t("the session never ends on a wrong answer — there is always a next question", () => {
  const c = { operands: [15, 7, 4], operators: ["-" as const, "+" as const] };
  let { state } = startSession(c);
  for (let i = 0; i < 15; i++) {
    const turn = submitStep(state, "999");
    assert.ok(turn.lines.length > 0, "silence is never an option");
    const last = turn.lines[turn.lines.length - 1];
    assert.match(last, /\?/, "every turn ends with a question the child can answer");
    const step = state.steps[state.index];
    const expected = step.final ? state.canonical : step.expression;
    assert.ok(last.includes(expected), `the step's own question must be re-asked, got: ${last}`);
    state = turn.state;
  }
});

t("a struggling child is given back their OWN confirmed results, never the goal", () => {
  const c = { operands: [24, 37], operators: ["+" as const] };
  let { state } = startSession(c);
  state = submitStep(state, "50").state; // tens
  state = submitStep(state, "11").state; // units
  const first = submitStep(state, "1");
  const second = submitStep(first.state, "2");
  const text = second.lines.join(" ");
  assert.match(text, /20 \+ 30 = 50/, "it recalls what the child already found");
  assert.ok(!containsNumber(text, 61), "and never adds the answer to the recall");
});

console.log("\nthe walk itself");

t("a two-digit sum is taken apart into tens, units, then the whole thing", () => {
  const { state } = startSession({ operands: [24, 37], operators: ["+"] });
  assert.deepEqual(state.steps.map((s) => s.expression), ["20 + 30", "4 + 7", "24 + 37"]);
  assert.deepEqual(state.steps.map((s) => s.value), [50, 11, 61]);
  assert.deepEqual(state.steps.map((s) => s.final), [false, false, true]);
});

t("a chain is walked one operation at a time, left to right", () => {
  const { state } = startSession({ operands: [15, 7, 4], operators: ["-", "+"] });
  assert.equal(state.steps[0].expression, "15 - 7");
  assert.equal(state.steps[0].value, 8);
  assert.equal(state.steps[state.steps.length - 1].final, true);
});

t("a decomposition that would equal the answer is collapsed away", () => {
  // 30 - 20: the "tens" step is also 10, which would hand over the goal.
  const { state } = startSession({ operands: [30, 20], operators: ["-"] });
  assert.equal(state.steps.length, 1, "nothing to take apart here");
  assert.equal(state.steps[0].final, true);
  // 40 + 30: the units step is 0 + 0, which teaches nothing.
  assert.equal(startSession({ operands: [40, 30], operators: ["+"] }).state.steps.length, 1);
});

t("the last step is always the WHOLE problem, so the child answers their own homework", () => {
  for (const c of PROBLEMS) {
    const { state } = startSession(c);
    const last = state.steps[state.steps.length - 1];
    assert.equal(last.final, true);
    assert.equal(last.value, computeAnswer(c), "the final step's value is the answer to the whole thing");
    assert.equal(last.expression, state.canonical, "and it asks the WHOLE problem, not the last fragment of it");
  }
});

t("an answer written with stray characters still counts", () => {
  const { state } = startSession({ operands: [5, 3], operators: ["+"] });
  assert.equal(submitStep(state, " 8 ").state.phase, "solved");
  assert.equal(submitStep(state, "8!").state.phase, "solved");
});

t("an empty or non-numeric answer is a wrong turn, not a crash", () => {
  const { state } = startSession({ operands: [5, 3], operators: ["+"] });
  for (const input of ["", "   ", "שמונה", "??"]) {
    const turn = submitStep(state, input);
    assert.equal(turn.state.phase, "asking");
    assert.ok(turn.lines.length > 0);
  }
});

t("once solved, further submissions do nothing", () => {
  const { state } = startSession({ operands: [5, 3], operators: ["+"] });
  const solved = submitStep(state, "8").state;
  const after = submitStep(solved, "8");
  assert.equal(after.state.phase, "solved");
  assert.deepEqual(after.lines, []);
});

console.log("\nend to end, from what a parent typed");

t("a typed problem walks all the way to the child solving it", () => {
  const parsed = parseHomeworkProblem("כמה זה 24 + 37?");
  assert.equal(parsed.kind, "arithmetic");
  if (parsed.kind !== "arithmetic") return;
  let { state, lines } = startSession(parsed.computation);
  const said = [...lines];
  for (const value of [50, 11, 61]) {
    const turn = submitStep(state, String(value));
    state = turn.state;
    if (value !== 61) said.push(...turn.lines);
  }
  assert.equal(state.phase, "solved");
  for (const line of said) assert.ok(!revealsAnswer(line, state), `leaked: ${line}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
