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
 *   ui        — not a question: a screen/flow defect with no automated check.
 *
 * P1 status is judged by the TOPIC-BOUNDARY mechanisms (topic-fit.ts,
 * operation-scope.ts and, since the BUG B fix, the allowed-format table's
 * structural check format-fit.ts).
 *
 * 2026-09-26, BUG B fix: every row the allowed-format table rejects is
 * "caught" (owner: findings covered by the table move to caught), except the
 * 6×4 cubes row, which the owner ruled ALLOWED. Where the table rejects a
 * row for its format but the reported defect has a wider class of its own
 * (#10 answer in the body), the note says so: that class has no general
 * detector yet. #9's ambiguity and #12's misleading hint are detected by
 * the gate since 2026-09-27.
 *
 * Run: npx tsx tests/sweep-grade-b.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { topicFit } from "../lib/exercises/topic-fit";
import { operationScope } from "../lib/exercises/operation-scope";
import { formatFit } from "../lib/exercises/format-fit";
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
const tableRejects = (e: Exercise) => !formatFit(e, e.topicId).ok;
const topicBoundaryCatches = (e: Exercise) => !topicFit(e, e.topicId).ok || !operationScope(e, e.topicId).ok || tableRejects(e);
const gateRules = (e: Exercise) => checkQuestionQuality(e).violations.map((v) => v.rule);

type Status = "open" | "caught" | "ui";

/**
 * P1, per row: is it caught by the topic-boundary mechanisms right now?
 * Tracked per row because one finding can hold a caught row and an allowed
 * one. The allowed-format table rejects every P1 defect row by its FORMAT;
 * rows using an operation their topic does not teach are caught by
 * operation scope as well.
 */
const P1_ROW_CAUGHT: Record<string, boolean> = {
  "830cac2a-b22c-44fb-b5f9-b21e6ba87c3c": true, // #1 grouping under numbers: numbers allow sequences + number line only (G1); ÷ also out of scope
  "f6f6f191-135b-4c7e-bf86-4402414d8205": true, // #2 +3 sequence under shapes: sequences only under numbers (G4)
  "9a3529d5-79c8-43d5-b6a1-cf60fbb52285": true, // #2 pick-operation under shapes: shapes = shape pattern + computation with addition (G3); × ÷ also out of scope
  "25ceceb3-c77f-46f8-8919-b8ddeec49166": true, // #3 +5 sequence under length: sequences only under numbers (G4)
  "397cdc85-35e0-42a4-9368-a44974f9cd33": true, // #3 +5 sequence under length: same
  "311e3b11-70d8-4e6c-9302-d8d32448bb72": false, // #4 6×4 cubes under volume: ALLOWED (owner ruling), not a defect
  "4f79a2db-f8f2-44e8-842a-1a1f7327448d": true, // #4 grouping under volume: volume has no grouping and no division
  "1fe552ac-2dc9-4d2a-ae66-6cf8654b5208": true, // #5 root drill under reading: reading topics are comprehension only
  "6e55fa84-e891-4c45-8ee6-10e9dc651e15": true, // #5 spelling drill under reading: same
};
const STATUS: Record<number, { status: Status; note: string }> = {
  1: { status: "caught", note: "format table: numbers topics allow sequences and the number line, not grouping (G1)" },
  2: { status: "caught", note: "format table: shapes allow the shape pattern and computation with addition — no sequences (G4), no pick-operation (G3)" },
  3: { status: "caught", note: "format table: sequences exist only under the numbers topics (G4)" },
  4: { status: "caught", note: "format table: the grouping row is caught (volume has no grouping or division); the 6×4 row is ALLOWED by owner ruling (layers × cubes), not a defect" },
  5: { status: "caught", note: "format table: reading topics are comprehension only (no root or spelling drills)" },
  6: { status: "caught", note: "fixed on this branch by 6f61650 (instruction names the drawn object); NOT deployed — production still says כוכב" },
  7: { status: "ui", note: "transient server error surfaced to the child; no automated check" },
  8: { status: "caught", note: "format table: morphology allows the root/pattern format only — comprehension is banned there (G6)" },
  9: { status: "caught", note: "format table: pick-operation is not a shapes format (also one-task and operation scope); since 2026-09-27 the gate also detects the ambiguity itself (3 + 3 and 3 × 2 are the same computation)" },
  10: { status: "caught", note: "format table: time has no number-line format; 'answer printed in the question' as a class has no detector" },
  11: { status: "open", note: "the typo is not detected (the equation-copy false positive that used to reject this row is fixed: the blank is the result, so the story's 5 is coincidence)" },
  12: { status: "caught", note: "format table: standard spelling allows the spelling-choice format only — comprehension is banned there (G6); since 2026-09-27 the gate also detects the misleading hint itself" },
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

console.log("\nP1 — topic-boundary leaks (judged by topic-fit + operation scope + the format table)");
for (const f of sweep.findings.filter((x) => x.severity === "P1")) {
  const s = STATUS[f.n];
  t(`#${f.n} [${s.status}] ${f.title} — ${s.note}`, () => {
    for (const id of f.rows) {
      const caught = topicBoundaryCatches(row(id));
      assert.equal(caught, P1_ROW_CAUGHT[id], caught ? `${id} is now caught: update P1_ROW_CAUGHT and the finding's status` : `${id} is served again`);
    }
    // A finding is "caught" only when every row that is a defect is caught.
    const defectRows = f.rows.filter((id) => id !== "311e3b11-70d8-4e6c-9302-d8d32448bb72");
    assert.equal(s.status === "caught", defectRows.every((id) => P1_ROW_CAUGHT[id]), `finding #${f.n} status disagrees with its rows`);
  });
}

console.log("\nP2 / P3");
t(`#6 [${STATUS[6].status}] ${STATUS[6].note}`, () => {
  for (const id of sweep.findings.find((f) => f.n === 6)!.rows) {
    const text = groupingInstructions(row(id).grouping?.items).text;
    assert.ok(!/כוכב/.test(text), `${id}: "${text}"`);
  }
});
for (const n of [8, 9, 10, 11, 12]) {
  const f = sweep.findings.find((x) => x.n === n)!;
  const s = STATUS[n];
  t(`#${n} [${s.status}] ${f.title} — ${s.note}`, () => {
    for (const id of f.rows) {
      if (s.status === "caught") {
        assert.ok(tableRejects(row(id)), `${id} is no longer rejected by the format table`);
      } else {
        const rules = gateRules(row(id));
        assert.deepEqual(rules, [], `${id} is now rejected (${rules}): promote finding #${n}`);
        assert.ok(!topicBoundaryCatches(row(id)), `${id} is now caught at the topic boundary: promote finding #${n}`);
      }
    }
  });
}
t("#9 is also rejected by one-task and, since 2026-09-27, by the same-computation rule — pinned so a change is noticed", () => {
  assert.deepEqual(gateRules(row("9a3529d5-79c8-43d5-b6a1-cf60fbb52285")), ["one-task", "unambiguous-answer"]);
  assert.match(checkQuestionQuality(row("9a3529d5-79c8-43d5-b6a1-cf60fbb52285")).violations[1].detail, /same computation/);
});
t("#12's misleading hint is detected by the gate itself since 2026-09-27", () => {
  const id = sweep.findings.find((f) => f.n === 12)!.rows[0];
  assert.match(checkQuestionQuality(row(id)).violations.map((v) => v.detail).join(" | "), /hint says there is an error/);
});
t("#7 and #13 are UI defects: tracked here, no automated check exists yet", () => {
  assert.equal(STATUS[7].status, "ui");
  assert.equal(STATUS[13].status, "ui");
});

console.log("\nfalse positives this sweep exposed in the branch's own checks (fixed; kept as regressions)");
t("4f79a2db (12 🧊 cubes into 4 towers): 'לבנות' is to-build, not bricks, and 'קוביות' names the drawn 🧊 — no quality violation", () => {
  assert.deepEqual(checkQuestionQuality(row("4f79a2db-f8f2-44e8-842a-1a1f7327448d")).violations, []);
});
t("719065d0 (8 − 3 = ___, a 5 elsewhere in the story): the blank is the result, so equation-copy does not fire", () => {
  assert.deepEqual(gateRules(row("719065d0-f5da-476e-80be-de83ead3542e")), []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
