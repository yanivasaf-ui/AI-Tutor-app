/**
 * The grade-ב QA sweep of 2026-09-26: 13 findings, tracked as KNOWN-FAIL
 * entries (tests/fixtures/sweep-grade-b-2026-09-26.json holds the exact
 * production rows the QA kid was served).
 *
 * Each finding is pinned to its CURRENT status on this branch:
 *   open      — no mechanism here rejects it yet. The test asserts it still
 *               gets through, so the day a fix starts catching it, this test
 *               fails and the entry must be promoted to "caught" deliberately.
 *   caught    — a mechanism here rejects it; the test asserts it stays caught.
 *   incidental— rejected, but by a rule that is NOT about the reported defect
 *               (the defect itself is still undetected). Pinned both ways.
 *   ui        — not a question: a screen/flow defect with no automated check.
 *
 * P1 status is judged by the TOPIC-BOUNDARY mechanisms only (topic-fit.ts +
 * operation-scope.ts). As of this commit none of the five P1 leaks is caught
 * by them — see the BUG B root-cause diagnosis of 2026-09-26 (delivered with
 * this commit's report; implementation awaits review).
 *
 * Run: npx tsx tests/sweep-grade-b.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { topicFit } from "../lib/exercises/topic-fit";
import { operationScope } from "../lib/exercises/operation-scope";
import { checkQuestionQuality } from "../lib/authoring/quality-gate";
import { groupingInstructions } from "../lib/guide/lines";
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

const sweep = JSON.parse(readFileSync(new URL("./fixtures/sweep-grade-b-2026-09-26.json", import.meta.url), "utf8")) as {
  rows: Record<string, Omit<Exercise, "id" | "topic" | "difficulty">>;
  findings: { n: number; severity: string; class: string; title: string; rows: string[] }[];
};
const row = (id: string): Exercise => ({ id, topic: "t", difficulty: 2, ...sweep.rows[id] }) as Exercise;
const topicBoundaryCatches = (e: Exercise) => !topicFit(e, e.topicId).ok || !operationScope(e, e.topicId).ok;
const gateRules = (e: Exercise) => checkQuestionQuality(e).violations.map((v) => v.rule);

type Status = "open" | "caught" | "incidental" | "ui";
const STATUS: Record<number, { status: Status; note: string }> = {
  1: { status: "open", note: "math-b-numbers is an arithmetic topic in topic-fit (anything passes) and grade ב allows division" },
  2: { status: "open", note: "the sequence uses triangle vocabulary; the vocabulary check cannot tell a costume from the topic" },
  3: { status: "open", note: "length vocabulary (ס״מ, מדד) in a +5 sequence" },
  4: { status: "open", note: "cube vocabulary; NOTE the product's own גופים curriculum text asks for layers × cubes, so 311e3b11 may be on-curriculum" },
  5: { status: "open", note: "Hebrew topics are not checked at all" },
  6: { status: "caught", note: "fixed on this branch by 6f61650 (instruction names the drawn object); NOT deployed — production still says כוכב" },
  7: { status: "ui", note: "transient server error surfaced to the child; no automated check" },
  8: { status: "open", note: "Hebrew content is not checked" },
  9: { status: "incidental", note: "rejected by one-task (it asks 'כמה קיסמים?' AND 'איזו פעולה?'); the 3+3 / 3×2 ambiguity itself is not detected" },
  10: { status: "open", note: "no check for the answer printed in the question" },
  11: { status: "incidental", note: "rejected by the equation-copy rule as a FALSE POSITIVE (5 = the apples count by coincidence); the typo itself is not detected" },
  12: { status: "open", note: "Hebrew content is not checked" },
  13: { status: "ui", note: "exit dialog after completion; no automated check" },
};

console.log("the fixture");
t("13 findings, numbered 1–13, each with a tracked status", () => {
  assert.deepEqual(sweep.findings.map((f) => f.n), Array.from({ length: 13 }, (_, i) => i + 1));
  for (const f of sweep.findings) assert.ok(STATUS[f.n], `finding ${f.n} has no status`);
});
t("every referenced row is in the fixture, verbatim from production (13 distinct rows)", () => {
  const ids = new Set(sweep.findings.flatMap((f) => f.rows));
  for (const id of ids) assert.ok(sweep.rows[id], id);
  assert.equal(Object.keys(sweep.rows).length, 13);
});
t("P1 findings are the five topic-boundary leaks; UI findings carry no row", () => {
  assert.deepEqual(sweep.findings.filter((f) => f.severity === "P1").map((f) => f.n), [1, 2, 3, 4, 5]);
  for (const f of sweep.findings.filter((x) => STATUS[x.n].status === "ui")) assert.deepEqual(f.rows, [], `finding ${f.n}`);
});

console.log("\nP1 — topic-boundary leaks (judged by topic-fit + operation scope)");
for (const f of sweep.findings.filter((x) => x.severity === "P1")) {
  const s = STATUS[f.n];
  t(`#${f.n} [${s.status}] ${f.title} — ${s.note}`, () => {
    for (const id of f.rows) {
      const caught = topicBoundaryCatches(row(id));
      if (s.status === "open") {
        assert.equal(caught, false, `${id} is now caught by the topic-boundary mechanisms: promote finding #${f.n} to "caught"`);
      } else {
        assert.equal(caught, true, `${id} is served again`);
      }
    }
  });
}

console.log("\nP2 / P3");
t(`#6 [${STATUS[6].status}] ${STATUS[6].note}`, () => {
  for (const id of sweep.findings.find((f) => f.n === 6)!.rows) {
    const text = groupingInstructions(row(id).grouping?.items[0]).text;
    assert.ok(!/כוכב/.test(text), `${id}: "${text}"`);
  }
});
for (const n of [8, 9, 10, 11, 12]) {
  const f = sweep.findings.find((x) => x.n === n)!;
  const s = STATUS[n];
  t(`#${n} [${s.status}] ${f.title} — ${s.note}`, () => {
    for (const id of f.rows) {
      const rules = gateRules(row(id));
      if (s.status === "open") {
        assert.deepEqual(rules, [], `${id} is now rejected (${rules}): promote finding #${n}`);
      } else if (s.status === "incidental") {
        assert.ok(rules.length > 0, `${id} is no longer rejected at all`);
      }
    }
  });
}
t("#9 is rejected by one-task, #11 by the (false-positive) equation-copy rule — pinned so a change is noticed", () => {
  assert.deepEqual(gateRules(row("9a3529d5-79c8-43d5-b6a1-cf60fbb52285")), ["one-task"]);
  assert.deepEqual(gateRules(row("719065d0-f5da-476e-80be-de83ead3542e")), ["internal-consistency"]);
});
t("#7 and #13 are UI defects: tracked here, no automated check exists yet", () => {
  assert.equal(STATUS[7].status, "ui");
  assert.equal(STATUS[13].status, "ui");
});

console.log("\nfalse positives this sweep exposed in the branch's own checks (pinned, to be fixed with the plan)");
t("4f79a2db (12 🧊 cubes into 4 towers) is flagged shown-is-said because 'לבנות' (to build) reads as the noun 'לבנה' (brick)", () => {
  const v = checkQuestionQuality(row("4f79a2db-f8f2-44e8-842a-1a1f7327448d")).violations;
  assert.deepEqual(v.map((x) => x.rule), ["shown-is-said"]);
  assert.match(v[0].detail, /לבנה/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
