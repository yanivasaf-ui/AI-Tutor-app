/**
 * Regression test for the 2026-09-14 report: a kid who says "אני רוצה
 * ללמוד חשבון" (I want to learn math) in free practice gets math's
 * sub-topics rendered, but the character repeats the original subject
 * question instead of acknowledging the choice.
 *
 * lib/voice/freePracticeIntent.ts is the ONE place a spoken utterance
 * turns into an action in components/practice/FreePractice.tsx — every
 * branch it returns dispatches into the exact same functions a tap uses
 * (chooseSubject / onPick), so these assertions are the actual guarantee
 * that tap and voice can't produce different character dialogue: there is
 * only one decision point for both.
 *
 * Run: npm test -- tests/free-practice-voice.test.mts (or npm run test:all)
 */
import assert from "node:assert/strict";
import { resolveFreePracticeIntent } from "../lib/voice/freePracticeIntent";
import { TOPICS } from "../lib/map/topics";
import * as lines from "../lib/guide/lines";

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

console.log("the reported repro: a fresh subject pick by voice");
t("'אני רוצה ללמוד חשבון' on a fresh screen resolves to picking math", () => {
  const intent = resolveFreePracticeIntent("אני רוצה ללמוד חשבון", null, "ב");
  assert.deepEqual(intent, { kind: "subject", subject: "math" });
});
t("plain 'מתמטיקה' also resolves to picking math", () => {
  assert.deepEqual(resolveFreePracticeIntent("מתמטיקה", null, "א"), { kind: "subject", subject: "math" });
});
t("'עברית' resolves to picking hebrew", () => {
  assert.deepEqual(resolveFreePracticeIntent("אני רוצה לתרגל עברית", null, "ג"), { kind: "subject", subject: "hebrew" });
});

console.log("\nwhat a tap can never say: re-confirming the subject already picked");
t("saying the subject you're already in is 'same-subject', not silence or 'not found'", () => {
  const intent = resolveFreePracticeIntent("אני רוצה ללמוד חשבון", "math", "ב");
  assert.deepEqual(intent, { kind: "same-subject", subject: "math" });
});
t("same-subject re-says the topic prompt (an acknowledgement), never the subject question", () => {
  const line = lines.freePickTopic("נועה", false);
  assert.ok(line.text.includes("מה רוצים לתרגל"), "same-subject must re-ask about the TOPIC, not repeat the subject question");
  assert.ok(!line.text.includes("מתמטיקה או עברית"), "must not be the original subject-pick line");
});
t("swapping to the OTHER subject while one is active still resolves to 'subject', not 'same-subject'", () => {
  assert.deepEqual(resolveFreePracticeIntent("עברית", "math", "ב"), { kind: "subject", subject: "hebrew" });
});

console.log("\nfrom inside a subject: a topic name wins over the subject word inside it");
const divisionCases: [string, string][] = [
  ["חילוק", "math-b-arithmetic"],
  ["אני רוצה לתרגל חילוק", "math-b-arithmetic"],
];
for (const [transcript, topicId] of divisionCases) {
  t(`'${transcript}' inside math resolves straight to the topic, not the subject`, () => {
    const intent = resolveFreePracticeIntent(transcript, "math", "ב");
    assert.equal(intent.kind, "topic");
    assert.equal((intent as { topic: { id: string } }).topic.id, topicId);
  });
}

console.log("\ngibberish and empty input");
t("unmatched speech is 'not-found'", () => {
  assert.deepEqual(resolveFreePracticeIntent("בננה", "math", "ב"), { kind: "not-found" });
  assert.deepEqual(resolveFreePracticeIntent("", null, "א"), { kind: "not-found" });
});

console.log("\ntap and voice reach the identical topic set — no separate pool logic to drift");
t("every topic voice can resolve to, from any subject state, is a real topic in TOPICS", () => {
  for (const subject of [null, "math", "hebrew"] as const) {
    for (const topic of TOPICS) {
      const intent = resolveFreePracticeIntent(topic.topic.split(":")[0].split(",")[0], subject, topic.grade);
      if (intent.kind === "topic") assert.ok(TOPICS.includes(intent.topic));
    }
  }
});

console.log("\nkid-facing topic labels (2026-09-14, grade-1 QA)");
{
  t("every topic has a short kid label; only already-simple ones (gematria) match the curriculum string verbatim", () => {
    for (const topic of TOPICS) {
      assert.ok(topic.displayNameKid.length > 0, `${topic.id} has no displayNameKid`);
      assert.ok(topic.displayNameKid.split(/\s+/).length <= 5, `${topic.id}'s kid label is too long: "${topic.displayNameKid}"`);
      if (topic.id !== "math-g-gematria") {
        assert.notEqual(topic.displayNameKid, topic.topic, `${topic.id}'s kid label is just the curriculum string`);
      }
    }
  });
  // Voice-experience fix item 2(a) (2026-09-15): the voice no longer
  // enumerates the topic list at all (readTopicList and its two tests
  // here are removed, not just skipped — that behavior is the thing
  // being fixed, not a case to keep passing). freePickTopic/
  // freePickSubject now speak one short line only; see lib/guide/lines.ts.
  //
  // FIX 2 (2026-09-14, product review) — still relevant even though the
  // topic list is now grade-filtered (item 2(b)): two DIFFERENT topics
  // sharing a displayNameKid would still look identical within their own
  // subject+grade list, or sound identical if voice-matched — the exact
  // bug that shipped "מילים חדשות" for both hebrew-a-oral-vocabulary and
  // hebrew-g-vocabulary, and "משחקים במילים" for both hebrew-b-metalinguistic
  // and hebrew-g-metalinguistic. A label repeating for the SAME skill
  // recurring across grades (e.g. "השעון" — telling time, harder each year)
  // is a deliberate, different thing: allowlisted below by exact id set, not
  // exempted by pattern, so a new accidental collision still fails loudly.
  const RECURRING_SKILL_LABELS: Record<string, string[]> = {
    השעון: ["math-a-time", "math-b-time", "math-g-time"],
    צורות: ["math-a-geometry", "math-b-geometry"],
    "למדוד אורך": ["math-a-length", "math-b-length"],
    "לספור ולסדר": ["math-a-data", "math-b-data", "math-g-data"],
    "גופים: קוביות וכדורים": ["math-b-volume", "math-g-volume"],
  };
  t("no two topics of the same subject share a kid label, except deliberately recurring skills", () => {
    for (const subject of ["math", "hebrew"] as const) {
      const bySubject = TOPICS.filter((topic) => topic.subject === subject);
      const byLabel = new Map<string, string[]>();
      for (const topic of bySubject) {
        byLabel.set(topic.displayNameKid, [...(byLabel.get(topic.displayNameKid) ?? []), topic.id]);
      }
      for (const [label, ids] of byLabel) {
        if (ids.length <= 1) continue;
        const allowed = RECURRING_SKILL_LABELS[label];
        assert.ok(allowed, `"${label}" is shared by ${ids.join(", ")} with no allowlist entry — two different topics with the same spoken name`);
        assert.deepEqual([...ids].sort(), [...allowed].sort(), `"${label}"'s topic set changed (${ids.join(", ")}) — update RECURRING_SKILL_LABELS or the labels`);
      }
    }
  });
}

// Moved here from right after the voice-intent block (2026-09-14, found
// while extending the kid-facing-labels block above): the exit check was
// running BEFORE these labels tests existed, so a failure here was printed
// but never failed the `npm test` command — this is the one place per file
// it belongs.
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
