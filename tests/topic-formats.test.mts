/**
 * The per-topic allowed-format table (lib/map/topic-formats.ts): complete,
 * well-formed, faithful to the owner's decisions of 2026-09-26 (G1–G6 and the
 * anchors), and printed identically in docs/topic-formats.md.
 *
 * Run: npx tsx tests/topic-formats.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOPICS } from "../lib/map/topics";
import { TOPIC_FORMATS, allowedFormats, isServedTopic, hasCondition, topicRule } from "../lib/map/topic-formats";
import { renderTopicFormats } from "../scripts/print-topic-formats";
import type { ExerciseSubtype } from "../lib/exercises/types";

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

const MATH_FORMATS: ExerciseSubtype[] = ["fill_in_blank", "pick_operation", "explain_thinking", "number_line_placement", "pattern_completion", "visual_grouping", "equation_balance", "shape_match"];
const HEBREW_FORMATS: ExerciseSubtype[] = ["comprehension", "spelling_correction_mc", "root_pattern_mc", "word_build", "sentence_order", "vowel_select_mc", "phonemic_visual_mc"];
const f = (id: string) => [...allowedFormats(id)].sort();
const ops = (id: string) => [...topicRule(id).operations].sort();

console.log("shape of the table");
t("exactly one rule per topic in lib/map/topics.ts (35)", () => {
  assert.deepEqual(Object.keys(TOPIC_FORMATS).sort(), TOPICS.map((x) => x.id).sort());
  assert.equal(Object.keys(TOPIC_FORMATS).length, 35);
});
t("every format belongs to the topic's own subject, with no duplicates", () => {
  for (const x of TOPICS) {
    const pool = x.subject === "math" ? MATH_FORMATS : HEBREW_FORMATS;
    const fs = allowedFormats(x.id);
    for (const fmt of fs) assert.ok(pool.includes(fmt), `${x.id}: ${fmt}`);
    assert.equal(new Set(fs).size, fs.length, x.id);
  }
});
t("Hebrew topics have no operations", () => {
  for (const x of TOPICS.filter((y) => y.subject === "hebrew")) assert.deepEqual(ops(x.id), [], x.id);
});
t("every rule states its basis", () => {
  for (const [id, r] of Object.entries(TOPIC_FORMATS)) assert.ok(r.basis.length > 20, id);
});
t("unserved ⇔ no formats; exactly the two topics the owner excluded", () => {
  for (const [id, r] of Object.entries(TOPIC_FORMATS)) assert.equal(!!r.unserved, r.formats.length === 0, id);
  assert.deepEqual(TOPICS.filter((x) => !isServedTopic(x.id)).map((x) => x.id).sort(), ["hebrew-g-oral-expression", "math-g-volume"]);
});
t("an unknown topic id is not served and allows nothing", () => {
  assert.equal(isServedTopic("no-such"), false);
  assert.deepEqual(allowedFormats("no-such"), []);
});

console.log("\nowner decisions and anchors (2026-09-26)");
t("G1 + skip-counting: numbers topics allow sequences and the number line, never grouping/division, no operations", () => {
  for (const id of ["math-a-numbers-0-100", "math-b-numbers-0-1000", "math-g-numbers-0-10000"]) {
    assert.deepEqual(f(id), ["number_line_placement", "pattern_completion"], id);
    assert.deepEqual(ops(id), [], id);
  }
});
t("G4: sequences exist ONLY under the numbers topics", () => {
  const withSequences = TOPICS.filter((x) => allowedFormats(x.id).includes("pattern_completion")).map((x) => x.id).sort();
  assert.deepEqual(withSequences, ["math-a-numbers-0-100", "math-b-numbers-0-1000", "math-g-numbers-0-10000"]);
});
t("anchor + G3: shapes = shape pattern + computation-with-addition (the counting container) only", () => {
  for (const id of ["math-a-geometry", "math-b-geometry", "math-g-geometry"]) {
    assert.deepEqual(f(id), ["fill_in_blank", "shape_match"], id);
    assert.deepEqual(ops(id), ["add"], id);
  }
});
t("G2: grade-א length is measurement only (ruler / number line), no operations", () => {
  assert.deepEqual(f("math-a-length"), ["number_line_placement"]);
  assert.deepEqual(ops("math-a-length"), []);
});
t("anchor: grade-ב length adds and subtracts lengths, no sequences", () => {
  assert.deepEqual(ops("math-b-length"), ["add", "sub"]);
  assert.ok(!f("math-b-length").includes("pattern_completion"));
});
t("owner: volume keeps layers × cubes (multiplication), no division, no grouping", () => {
  assert.ok(ops("math-b-volume").includes("mul"));
  assert.ok(!ops("math-b-volume").includes("div"));
  assert.ok(!f("math-b-volume").includes("visual_grouping"));
});
t("G2: area is computation with addition only", () => {
  assert.deepEqual(f("math-g-area"), ["fill_in_blank"]);
  assert.deepEqual(ops("math-g-area"), ["add"]);
});
t("G2: grade-ג gematria is explain-only, no arithmetic", () => {
  assert.deepEqual(f("math-g-gematria"), ["explain_thinking"]);
  assert.deepEqual(ops("math-g-gematria"), []);
});
t("G2: data topics allow computation / pick-operation / equation only", () => {
  for (const id of ["math-a-data", "math-b-data", "math-g-data"]) assert.deepEqual(f(id), ["equation_balance", "fill_in_blank", "pick_operation"], id);
});
t("G4: grade-ב arithmetic has no sequences; it keeps all four operations", () => {
  assert.ok(!f("math-b-arithmetic").includes("pattern_completion"));
  assert.deepEqual(ops("math-b-arithmetic"), ["add", "div", "mul", "sub"]);
});
t("G5: the number-line condition is set on the four operations topics, and only those", () => {
  const conditioned = TOPICS.filter((x) => hasCondition(x.id, "number-line-needs-operation")).map((x) => x.id).sort();
  assert.deepEqual(conditioned, ["math-a-addition-subtraction", "math-b-arithmetic", "math-g-arithmetic", "math-g-multiplication-division"]);
  for (const id of conditioned) assert.ok(allowedFormats(id).includes("number_line_placement"), id);
});
t("anchor: Hebrew reading topics are comprehension only (no root/spelling drills)", () => {
  for (const id of ["hebrew-a-early-reading", "hebrew-b-reading-fluency-literature", "hebrew-g-reading-comprehension", "hebrew-g-literary-texts-reading-pleasure"]) {
    assert.deepEqual(f(id), ["comprehension"], id);
  }
});
t("G6: no comprehension container in the spelling and morphology topics — dedicated formats only", () => {
  assert.deepEqual(f("hebrew-b-standard-orthography"), ["spelling_correction_mc"]);
  assert.deepEqual(f("hebrew-b-metalinguistic"), ["root_pattern_mc"]);
  assert.deepEqual(f("hebrew-g-metalinguistic"), ["root_pattern_mc", "spelling_correction_mc"]);
});
t("G2: writing process and oral vocabulary keep only the formats for the parts their text names", () => {
  assert.deepEqual(f("hebrew-g-writing-process"), ["sentence_order", "spelling_correction_mc"]);
  assert.deepEqual(f("hebrew-a-oral-vocabulary"), ["comprehension"]);
});
t("division exists only where the text teaches it (grade-ב arithmetic, grade-ג ×/÷)", () => {
  const withDiv = TOPICS.filter((x) => topicRule(x.id).operations.includes("div")).map((x) => x.id).sort();
  assert.deepEqual(withDiv, ["math-b-arithmetic", "math-g-multiplication-division"]);
  const withGrouping = TOPICS.filter((x) => allowedFormats(x.id).includes("visual_grouping")).map((x) => x.id).sort();
  assert.deepEqual(withGrouping, withDiv);
});
t("pick_operation is only offered where at least two operations exist to choose between", () => {
  for (const x of TOPICS) {
    if (allowedFormats(x.id).includes("pick_operation")) assert.ok(topicRule(x.id).operations.length >= 2, x.id);
  }
});

console.log("\nthe readable document");
t("docs/topic-formats.md is exactly what the table prints", () => {
  const doc = readFileSync(new URL("../docs/topic-formats.md", import.meta.url), "utf8");
  assert.equal(doc, renderTopicFormats());
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
