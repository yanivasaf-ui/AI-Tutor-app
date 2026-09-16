/**
 * feat: kid session memory — the write path's derivation and the prompt
 * block's shape, both pure, both testable without a database or a model.
 *
 * Run: npx tsx tests/kid-memory.test.mts
 */
import assert from "node:assert/strict";
import { factsFromAnswer, formatMemoryBlock, daysAgo, MEMORY_BLOCK_MAX_CHARS } from "../lib/memory/kidMemory";

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

console.log("what one answer becomes");
t("a first-try correct answer is a win, and says so", () => {
  const f = factsFromAnswer({ topicLabel: "חילוק", correct: true, attempt: 1 });
  assert.equal(f.length, 1);
  assert.equal(f[0].factType, "win");
  assert.equal(f[0].topic, "חילוק");
  assert.match(f[0].detail, /first try/);
});

t("a second-try correct answer is still a win, but a different one", () => {
  const f = factsFromAnswer({ topicLabel: "חילוק", correct: true, attempt: 2 });
  assert.equal(f[0].factType, "win");
  assert.match(f[0].detail, /second try/);
});

t("a final miss carries the evaluator's own description of the mistake", () => {
  const f = factsFromAnswer({
    topicLabel: "חילוק",
    correct: false,
    attempt: 2,
    errorNote: "בלבול בין חילוק לכפל",
  });
  assert.equal(f[0].factType, "struggle");
  assert.match(f[0].detail, /בלבול בין חילוק לכפל/);
});

// The noise rule: "got one wrong" is not worth citing three sessions later;
// "confused division with multiplication" is.
t("a first-try miss with no characterised mistake writes nothing", () => {
  assert.deepEqual(factsFromAnswer({ topicLabel: "חילוק", correct: false, attempt: 1 }), []);
});

t("a first-try miss WITH a characterised mistake is kept", () => {
  const f = factsFromAnswer({ topicLabel: "חילוק", correct: false, attempt: 1, errorNote: "שכח/ה לחלק את השארית" });
  assert.equal(f.length, 1);
  assert.equal(f[0].factType, "struggle");
});

t("levelling up and finishing a topic are milestones, alongside the win", () => {
  const f = factsFromAnswer({
    topicLabel: "חילוק",
    correct: true,
    attempt: 1,
    leveledUp: true,
    topicCompleted: true,
  });
  assert.equal(f.length, 3);
  assert.deepEqual(f.map((x) => x.factType), ["win", "milestone", "milestone"]);
});

t("never more than three facts from one answer", () => {
  const f = factsFromAnswer({
    topicLabel: "חילוק",
    correct: true,
    attempt: 2,
    errorNote: "x",
    leveledUp: true,
    topicCompleted: true,
  });
  assert.ok(f.length <= 3, `got ${f.length}`);
});

console.log("\nthe block that reaches the prompt");
t("no history means no block at all — a first session's prompt is unchanged", () => {
  assert.equal(formatMemoryBlock([]), "");
});

t("facts are rendered newest-first with a relative time a model can speak", () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 26 * 3600_000).toISOString();
  const block = formatMemoryBlock([
    { factType: "struggle", topic: "חילוק", detail: "confused division with multiplication", createdAt: yesterday },
  ]);
  assert.match(block, /struggle/);
  assert.match(block, /חילוק/);
  assert.match(block, /yesterday/);
});

t("the block is trimmed to its character budget, not truncated mid-line", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    factType: "win" as const,
    topic: `נושא${i}`,
    detail: "solved it on the first try",
    createdAt: new Date().toISOString(),
  }));
  const block = formatMemoryBlock(many);
  const factLines = block.split("\n").filter((l) => l.startsWith("- ["));
  const factChars = factLines.reduce((a, l) => a + l.length, 0);
  assert.ok(factChars <= MEMORY_BLOCK_MAX_CHARS, `fact lines used ${factChars} chars`);
  assert.ok(factLines.length < many.length, "budget should have dropped the oldest facts");
  for (const line of factLines) assert.match(line, /\(.+\)$/, "every kept line is whole");
});

t("a fact with no timestamp still renders, without inventing a date", () => {
  assert.equal(daysAgo(undefined), null);
  const block = formatMemoryBlock([{ factType: "win", topic: "חילוק", detail: "solved it" }]);
  assert.match(block, /חילוק/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
