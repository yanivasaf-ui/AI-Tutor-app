/**
 * feat: kid session memory — the write path's derivation and the prompt
 * block's shape, both pure, both testable without a database or a model.
 *
 * Run: npx tsx tests/kid-memory.test.mts
 */
import assert from "node:assert/strict";
import {
  factsFromAnswer,
  formatMemoryBlock,
  daysAgo,
  pickOpenerFact,
  MEMORY_BLOCK_MAX_CHARS,
  OPENER_MAX_AGE_DAYS,
} from "../lib/memory/kidMemory";
import { continuityGreeting } from "../lib/guide/lines";

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

console.log("\nwhat opens the next session");
{
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  t("a first session has nothing to open on", () => {
    assert.equal(pickOpenerFact([], now), null);
  });

  t("the newest recent fact wins — yesterday's struggle beats last week's win", () => {
    const f = pickOpenerFact(
      [
        { factType: "struggle", topic: "חילוק", detail: "x", createdAt: ago(1) },
        { factType: "win", topic: "כפל", detail: "y", createdAt: ago(6) },
      ],
      now
    );
    assert.equal(f?.factType, "struggle");
    assert.equal(f?.topic, "חילוק");
    assert.equal(f?.daysAgo, 1);
  });

  t("everything stale opens nothing, rather than 'remember three months ago'", () => {
    assert.equal(
      pickOpenerFact([{ factType: "win", topic: "חילוק", detail: "x", createdAt: ago(OPENER_MAX_AGE_DAYS + 1) }], now),
      null
    );
  });

  t("the greeting names the topic, dates it, and still asks the session question", () => {
    const line = continuityGreeting("נועה", { factType: "struggle", topic: "חילוק", daysAgo: 1 }, "girl");
    assert.equal(line.name, "נועה");
    assert.match(line.text, /אתמול/);
    assert.match(line.text, /חילוק/);
    assert.match(line.text, /נמשיך במסלול שלנו/, "must flow into the session, not replace it");
    assert.match(line.text, /את רוצה/, "the question half still addresses the kid in her own gender");
  });

  t("a win and a milestone open differently from a struggle", () => {
    const win = continuityGreeting("נועה", { factType: "win", topic: "חילוק", daysAgo: 0 }, "boy").text;
    const stone = continuityGreeting("נועה", { factType: "milestone", topic: "חילוק", daysAgo: 2 }, "boy").text;
    assert.match(win, /היום הצלחנו/);
    assert.match(stone, /לא מזמן סיימנו/);
    assert.notEqual(win, stone);
  });

  // Rule 3 in lines.ts: forms written identically for a boy and a girl but
  // pronounced differently. The niqqud step in front of TTS cannot know the
  // kid's gender, so the opener must not contain any of them.
  t("the opener avoids write-ambiguous second-person forms", () => {
    for (const type of ["win", "struggle", "milestone"] as const) {
      const text = continuityGreeting("נועה", { factType: type, topic: "חילוק", daysAgo: 1 }, null).text;
      const opener = text.split("נמשיך")[0];
      for (const bad of ["פתרת", "הלך לך", "שלך", "בחרת", "מחכה"]) {
        assert.ok(!opener.includes(bad), `opener for ${type} contains ambiguous "${bad}"`);
      }
    }
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
