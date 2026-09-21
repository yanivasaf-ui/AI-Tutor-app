/**
 * The Hebrew topic-boundary audit.
 *
 * Maths can ask "does this exercise use its topic's vocabulary". Hebrew
 * topics are skills over the same language, so there is no such word — and
 * inventing an anchor list would reject good exercises, which is exactly
 * what lib/exercises/topic-fit.ts refuses to do for Hebrew.
 *
 * What CAN be decided without inventing anything: an identical question
 * filed under two topics belongs to at most one of them. These tests pin
 * that rule, its honesty about what it cannot know (which of the filings
 * is right), and the measurement that decides whether a kind-based rule
 * could be built from this bank at all.
 *
 * Run: npx tsx tests/hebrew-topic-evidence.test.mts
 */
import assert from "node:assert/strict";
import { auditHebrewTopics, questionKey, subtypeSpread } from "../lib/exercises/hebrew-topic-evidence";

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

let n = 0;
const row = (topicId: string | null, question: string, extra: { subtype?: string } = {}) => ({
  id: `r${++n}`, question, topicId, type: "multiple_choice", subtype: extra.subtype ?? "root_pattern_mc",
});

const ROOT = "איזו מילה נגזרת מהשורש ק-ר-א?";

console.log("the rule: the same question under two topics belongs to at most one");

t("a question filed under two topics flags BOTH copies — nothing says which is right", () => {
  const a = auditHebrewTopics([row("hebrew-g-vocabulary", ROOT), row("hebrew-g-reading-comprehension", ROOT)]);
  assert.equal(a.duplicateQuestions, 1);
  assert.equal(a.flaggedRows, 2, "both copies are flagged; the audit does not pick a winner");
  assert.deepEqual(a.groups[0].topics, ["hebrew-g-reading-comprehension", "hebrew-g-vocabulary"]);
});

t("the same question repeated WITHIN one topic is not a boundary problem", () => {
  const a = auditHebrewTopics([row("hebrew-g-vocabulary", ROOT), row("hebrew-g-vocabulary", ROOT)]);
  assert.equal(a.duplicateQuestions, 0, "a duplicate inside one topic is a variety problem, not a leak");
  assert.equal(a.flaggedRows, 0);
});

t("distinct questions are never flagged, however similar the topics", () => {
  const a = auditHebrewTopics([
    row("hebrew-g-vocabulary", "איזו מילה נגזרת מהשורש ס-פ-ר?"),
    row("hebrew-g-reading-comprehension", ROOT),
  ]);
  assert.equal(a.flaggedRows, 0, "only PROVEN mis-filings are reported");
});

t("whitespace and line breaks do not hide a duplicate", () => {
  const a = auditHebrewTopics([row("t1", "מה  השורש?\n"), row("t2", "מה השורש?")]);
  assert.equal(a.flaggedRows, 2);
  assert.equal(questionKey("מה  השורש?\n"), questionKey("מה השורש?"));
});

t("a question under five topics is one group carrying five rows", () => {
  const topics = ["t1", "t2", "t3", "t4", "t5"];
  const a = auditHebrewTopics(topics.map((x) => row(x, ROOT)));
  assert.equal(a.groups.length, 1);
  assert.equal(a.groups[0].topics.length, 5);
  assert.equal(a.flaggedRows, 5);
});

t("the worst-shared questions are reported first, so the report leads with the evidence", () => {
  const a = auditHebrewTopics([
    row("t1", "מעט"), row("t2", "מעט"),
    row("t1", "הרבה"), row("t2", "הרבה"), row("t3", "הרבה"), row("t4", "הרבה"),
  ]);
  assert.equal(a.groups[0].question, "הרבה");
  assert.equal(a.groups[0].topics.length, 4);
});

t("untagged rows are ignored rather than pooled into a phantom topic", () => {
  const a = auditHebrewTopics([row(null, ROOT), row(null, ROOT)]);
  assert.equal(a.rows, 0);
  assert.equal(a.flaggedRows, 0);
  // The one that matters: an untagged row must not pair with a tagged one
  // and manufacture a two-topic group out of a single real filing.
  const mixed = auditHebrewTopics([row(null, ROOT), row("hebrew-g-vocabulary", ROOT)]);
  assert.equal(mixed.duplicateQuestions, 0, "an untagged row is not a second topic");
  assert.equal(mixed.flaggedRows, 0);
});

console.log("\nthe per-topic report");

t("counts shared rows against that topic's own total, and sorts by damage", () => {
  const a = auditHebrewTopics([
    row("clean", "א"), row("clean", "ב"), row("clean", "ג"),
    row("leaky", ROOT), row("leaky", "ד"),
    row("other", ROOT),
  ]);
  const leaky = a.byTopic.find((x) => x.topicId === "leaky")!;
  const clean = a.byTopic.find((x) => x.topicId === "clean")!;
  assert.deepEqual([leaky.total, leaky.shared], [2, 1]);
  assert.equal(leaky.ratio, 0.5);
  assert.deepEqual([clean.total, clean.shared], [3, 0]);
  assert.equal(clean.ratio, 0, "a clean topic's ratio is 0, not 1 — the ratio is damage, not health");
  assert.equal(a.byTopic.find((x) => x.topicId === "other")!.ratio, 1, "a wholly-shared topic is 1");
  assert.equal(a.byTopic[0].topicId, "leaky", "the worst topic is reported first");
});

console.log("\nwhether a KIND-based rule could be built from this bank at all");

t("a subtype confined to one topic would carry signal", () => {
  const spread = subtypeSpread([
    row("t1", "א", { subtype: "comprehension" }),
    row("t2", "ב", { subtype: "root_pattern_mc" }),
    row("t3", "ג", { subtype: "root_pattern_mc" }),
  ]);
  assert.equal(spread.find((s) => s.subtype === "comprehension")!.topics, 1);
  assert.equal(spread.find((s) => s.subtype === "root_pattern_mc")!.topics, 2);
});

t("a subtype present under EVERY topic separates nothing — the measurement that matters here", () => {
  // This is the shape the live bank actually has: all 7 subtypes under all
  // 13 topics. A topic->kind mapping learned from that would be invention,
  // not measurement, which is why this module stops at the duplicate rule.
  const topics = Array.from({ length: 13 }, (_, i) => `t${i}`);
  const rows = topics.flatMap((tp) =>
    ["comprehension", "root_pattern_mc", "vowel_select_mc"].map((st, j) => row(tp, `q${tp}${j}`, { subtype: st }))
  );
  const spread = subtypeSpread(rows);
  assert.ok(spread.every((s) => s.topics === 13), "every kind under every topic");
});

console.log("\nhonesty about the bound");

t("a paraphrase of the same drill is invisible — the number is a LOWER bound", () => {
  const a = auditHebrewTopics([
    row("t1", "איזו מילה נגזרת מהשורש ק-ר-א?"),
    row("t2", "איזו מילה נגזרת מן השורש ק-ר-א?"),
  ]);
  assert.equal(a.flaggedRows, 0, "exact-match only, by design — and the report must say so");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
