/**
 * BUG B (2026-09-15, production QA): grade א "צורות" served a numeric-
 * sequence story; grade ג "כפל וחילוק" served a bare number-line question.
 * Traced to bank-guard.ts's own blind spot, not a database or serving-
 * query bug — see its header comment. Investigated and confirmed directly
 * against the live table: BOTH reported rows carry the CORRECT topic_id
 * (math-a-geometry / math-g-multiplication-division respectively) — the
 * serving query was never wrong. The actual fix lives in generate.ts's
 * prompt (require the scenario to draw from the resolved topic's own
 * curriculum content).
 *
 * This test is the ask from that investigation anyway, as a real
 * regression guard against a DIFFERENT risk than the one that actually
 * fired: a genuine serving-query or mis-tagging bug, which this WOULD
 * catch (findReusableExercise() returning a row whose topicId doesn't
 * match what was asked for) even though it wouldn't have caught BUG B's
 * real, narrower cause (a correctly-tagged row with topic-irrelevant
 * content — no code-checkable signal for that, see bank-guard.ts).
 *
 * This is a LIVE integration test (the assertion is only meaningful
 * against the real bank) — it needs QA_ACCOUNT_PASSWORD for the same
 * throwaway QA account used elsewhere this session. Skips cleanly (exit
 * 0) rather than failing when that's not set, so a plain `npm test`
 * without production secrets still passes; run it explicitly to actually
 * exercise it: QA_ACCOUNT_PASSWORD=... npx tsx tests/exercise-topic-integrity.test.mts
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
  console.log("exercise-topic-integrity: QA_ACCOUNT_PASSWORD not set — skipping (this is a live-DB test, see file header).");
  process.exit(0);
}

const { createClient } = await import("@supabase/supabase-js");
const { findReusableExercise } = await import("../lib/exercises/store");
const { TOPICS } = await import("../lib/map/topics");

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
const { error: authErr } = await supabase.auth.signInWithPassword({
  email: "loki.qa.test.20260824@gmail.com",
  password: process.env.QA_ACCOUNT_PASSWORD,
});
if (authErr) {
  console.error("exercise-topic-integrity: sign-in failed:", authErr.message);
  process.exit(1);
}

let passed = 0;
let failed = 0;
let noBankRow = 0;
const failures: string[] = [];

for (const topic of TOPICS) {
  const ex = await findReusableExercise(supabase as never, topic.subject, topic.grade, null, topic.id, 2);
  if (!ex) {
    noBankRow++;
    continue;
  }
  try {
    assert.equal(ex.topicId, topic.id, `requested ${topic.id} but got back topicId=${ex.topicId ?? "(none)"} — question: "${ex.question.slice(0, 60)}..."`);
    passed++;
  } catch (e) {
    failed++;
    failures.push((e as Error).message);
    console.error("  FAIL " + (e as Error).message);
  }
}

console.log(`\nexercise-topic-integrity: ${passed}/${TOPICS.length} topics checked, spec's topicId matched the request; ${noBankRow} had no bank row to check (falls back to live-gen, not a failure); ${failed} mismatched.`);
if (failed > 0) {
  console.error("failures:\n" + failures.join("\n"));
  process.exit(1);
}
