/**
 * feat: kid session memory / continuity greeting / specific praise —
 * the two-session integration check the brief asks for.
 *
 * Session 1: the kid practises division and makes a characterised mistake.
 * Session 2 (a fresh read, nothing carried over in memory): the opener must
 * name division, and the praise the evaluator writes must reference that
 * same mistake rather than saying כל הכבוד.
 *
 * Also runs the control the feature lives or dies on: the SAME answer
 * evaluated with an empty memory block must NOT reference any history. A
 * model that "remembers" without being told is hallucinating, and to a
 * child an invented memory is indistinguishable from a real one.
 *
 * LIVE: real Supabase rows and a real model call. Needs QA_ACCOUNT_PASSWORD
 * for the throwaway QA account, and skips cleanly (exit 0) without it, so a
 * plain `npm test` with no production secrets still passes. Run it for real:
 *   QA_ACCOUNT_PASSWORD=... npx tsx tests/memory-continuity.test.mts
 *
 * Writes only rows tagged with its own session id and deletes them at the
 * end, so it leaves the QA account exactly as it found it.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const envLocal = new URL("../.env.local", import.meta.url);
if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

if (!process.env.QA_ACCOUNT_PASSWORD) {
  console.log("memory-continuity: QA_ACCOUNT_PASSWORD not set — skipping (live-DB test, see file header).");
  process.exit(0);
}

const { createClient } = await import("@supabase/supabase-js");
const { factsFromAnswer, saveKidFacts, recentKidFacts, pickOpenerFact, formatMemoryBlock } = await import(
  "../lib/memory/kidMemory"
);
const { continuityGreeting } = await import("../lib/guide/lines");
const { evaluateExerciseAnswer } = await import("../lib/exercises/evaluate");
const { listKids } = await import("../lib/memory/store");

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
const { error: authErr } = await supabase.auth.signInWithPassword({
  email: process.env.QA_ACCOUNT_EMAIL ?? "loki.qa.test.20260824@gmail.com",
  password: process.env.QA_ACCOUNT_PASSWORD,
});
if (authErr) {
  console.error("memory-continuity: sign-in failed:", authErr.message);
  process.exit(1);
}

const kids = await listKids(supabase as never);
if (kids.length === 0) {
  console.error("memory-continuity: the QA account has no kid to test with.");
  process.exit(1);
}
const kid = kids[0];
const SESSION_1 = `itest-${Date.now()}`;
const TOPIC = "חילוק";
const MISTAKE = "בלבול בין חילוק לכפל";

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

try {
  // ---- SESSION 1 --------------------------------------------------------
  console.log(`session 1 — ${kid.name} practises ${TOPIC} and gets one wrong`);
  const facts = factsFromAnswer({
    topicLabel: TOPIC,
    correct: false,
    attempt: 2,
    errorNote: MISTAKE,
  });
  const written = await saveKidFacts(supabase as never, kid.id, facts, SESSION_1);
  t("session 1 persisted the mistake as a fact", () => {
    assert.ok(written >= 1, `wrote ${written} facts`);
  });

  // ---- SESSION 2 --------------------------------------------------------
  console.log("\nsession 2 — fresh read, nothing carried over in process memory");
  const recalled = await recentKidFacts(supabase as never, kid.id);
  t("the fresh session reads its own kid's history back", () => {
    assert.ok(recalled.length > 0, "no facts came back");
    assert.ok(
      recalled.some((f) => f.topic === TOPIC && f.detail.includes(MISTAKE)),
      "session 1's mistake is not in what session 2 read"
    );
  });

  const opener = pickOpenerFact(recalled);
  t("the opener picks session 1's fact", () => {
    assert.ok(opener, "no opener fact chosen");
    assert.equal(opener!.topic, TOPIC);
  });

  const greeting = continuityGreeting(kid.name, opener!, kid.gender);
  console.log(`  greeting: "${greeting.name}, ${greeting.text}"`);
  t("the greeting names the topic from last session", () => {
    assert.match(greeting.text, new RegExp(TOPIC));
  });

  // ---- specific vs generic praise ---------------------------------------
  console.log("\npraise — same answer, with memory and without");
  const exercise = {
    id: "itest",
    subject: "math" as const,
    grade: "ג" as const,
    type: "open" as const,
    topic: "חילוק",
    question: "כמה זה 12 חלקי 3?",
    correctAnswer: "4",
  };

  const withMemory = await evaluateExerciseAnswer(exercise as never, "4", {
    childGender: kid.gender ?? undefined,
    memoryBlock: formatMemoryBlock(recalled),
  });
  console.log(`  with memory:    "${withMemory.feedback}"`);

  const withoutMemory = await evaluateExerciseAnswer(exercise as never, "4", {
    childGender: kid.gender ?? undefined,
    memoryBlock: "",
  });
  console.log(`  without memory: "${withoutMemory.feedback}"`);

  const PAST = /אתמול|בפעם שעברה|קודם|בעבר|לאחרונה|היה קשה|הסתבכ|התבלבל|בלבול|חילוק/;
  t("praise WITH memory references the history", () => {
    assert.ok(withMemory.correct, "the answer was right; the evaluator disagreed");
    assert.match(withMemory.feedback, PAST, "feedback cited nothing from memory");
  });

  t("praise WITHOUT memory invents no history — the anti-hallucination control", () => {
    assert.ok(withoutMemory.correct);
    assert.ok(
      !/אתמול|בפעם שעברה|בעבר|לאחרונה/.test(withoutMemory.feedback),
      `a model with no memory block claimed history: "${withoutMemory.feedback}"`
    );
  });
} finally {
  const { error: cleanupErr } = await supabase.from("kid_memory").delete().eq("source_session_id", SESSION_1);
  console.log(cleanupErr ? `\ncleanup FAILED: ${cleanupErr.message}` : "\ncleanup: test rows removed");
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
