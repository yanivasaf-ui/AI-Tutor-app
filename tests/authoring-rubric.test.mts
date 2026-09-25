/**
 * The authoring rubric's shape (lib/authoring/rubric.ts): the universal
 * rules are all there and well-formed, and there is exactly one slot per
 * product math topic — a topic added to lib/map/topics.ts without a slot
 * (or a slot for a topic that no longer exists) fails here.
 *
 * Run: npx tsx tests/authoring-rubric.test.mts
 */
import assert from "node:assert/strict";
import { UNIVERSAL_RULES, SLOT_TOPIC_IDS, TOPIC_SLOTS, CROSS_CUTTING_SLOTS, ruleById, slotsFor } from "../lib/authoring/rubric";
import { TOPICS } from "../lib/map/topics";

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

console.log("authoring rubric");

t("the brief's eight universal rules plus the two added after the live run, each once", () => {
  assert.deepEqual(
    UNIVERSAL_RULES.map((r) => r.id).sort(),
    [
      "concrete-scenario",
      "division-sharing-frame",
      "internal-consistency",
      "no-pattern-drift",
      "no-series-as-count",
      "one-task",
      "sequence-anchored",
      "series-determinate",
      "spoken-hebrew",
      "unambiguous-answer",
    ]
  );
});

t("every rule is stated in Hebrew and says how it is enforced", () => {
  for (const r of UNIVERSAL_RULES) {
    assert.match(r.he, /[א-ת]/, `${r.id} has no Hebrew statement`);
    assert.ok(r.enforcement.length > 0, `${r.id} has no enforcement`);
  }
});

t("ruleById finds a rule and refuses an unknown one", () => {
  assert.equal(ruleById("one-task").id, "one-task");
  assert.throws(() => ruleById("nope" as never));
});

t("one slot per product math topic, no more, no fewer", () => {
  const productMath = TOPICS.filter((x) => x.subject === "math").map((x) => x.id).sort();
  assert.deepEqual([...SLOT_TOPIC_IDS].sort(), productMath);
  assert.deepEqual(Object.keys(TOPIC_SLOTS).sort(), productMath);
});

t("no slot for a Hebrew topic", () => {
  for (const x of TOPICS.filter((x) => x.subject === "hebrew")) assert.equal(slotsFor(x.id), undefined, x.id);
});

t("cross-cutting slots exist for sequences and division at every product grade", () => {
  for (const kind of ["sequences", "division"] as const) {
    assert.deepEqual(Object.keys(CROSS_CUTTING_SLOTS[kind]).sort(), ["א", "ב", "ג"].sort());
  }
});

t("every slot carries a status", () => {
  const all = [...Object.values(TOPIC_SLOTS), ...Object.values(CROSS_CUTTING_SLOTS).flatMap((g) => Object.values(g))];
  for (const s of all) {
    assert.ok(["placeholder", "filled", "insufficient-evidence"].includes(s.phrasing.status));
    assert.ok(["placeholder", "filled", "insufficient-evidence"].includes(s.exemplars.status));
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
