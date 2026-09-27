/**
 * The read-only bank audit (scripts/audit-format-fit.ts) judges rows exactly
 * as serving does: its counts agree with formatFit row by row, and its SQL
 * selection is generated from the allowed-format table.
 *
 * Run: npx tsx tests/audit-format-fit.test.mts
 */
import assert from "node:assert/strict";
import { TOPICS } from "../lib/map/topics";
import { allowedFormats, isServedTopic } from "../lib/map/topic-formats";
import { formatFit } from "../lib/exercises/format-fit";
import { audit, auditSql } from "../scripts/audit-format-fit";
import type { Exercise, ExerciseSubtype } from "../lib/exercises/types";

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

const MATH: ExerciseSubtype[] = ["fill_in_blank", "pick_operation", "explain_thinking", "number_line_placement", "pattern_completion", "visual_grouping", "equation_balance", "shape_match"];
const HEBREW: ExerciseSubtype[] = ["comprehension", "spelling_correction_mc", "root_pattern_mc", "word_build", "sentence_order", "vowel_select_mc", "phonemic_visual_mc"];

t("membership counts agree with formatFit for every topic × every format (one row each)", () => {
  const counts = TOPICS.flatMap((x) => (x.subject === "math" ? MATH : HEBREW).map((s) => ({ topic_id: x.id, subtype: s, has_computation: false, n: 1 })));
  const r = audit(counts, []);
  for (const x of TOPICS) {
    const formats = x.subject === "math" ? MATH : HEBREW;
    // number lines are judged by formatFit only on their text (step B), so membership alone here
    const expected = formats.filter((s) => {
      if (s === "number_line_placement" && isServedTopic(x.id) && allowedFormats(x.id).includes(s)) return false;
      return !formatFit({ id: "x", subject: x.subject, grade: x.grade, type: "open", subtype: s, topic: "t", question: "7 + 3 = ?", correctAnswer: "10" } as Exercise, x.id).ok;
    }).length;
    assert.equal(r.topics.find((a) => a.topicId === x.id)?.violations, expected, x.id);
  }
});
t("an untyped row with a computation counts as fill_in_blank (as serving reads the vetted templates)", () => {
  const r = audit([{ topic_id: "math-g-area", subtype: null, has_computation: true, n: 3 }, { topic_id: "math-a-length", subtype: null, has_computation: true, n: 2 }], []);
  assert.equal(r.topics.find((a) => a.topicId === "math-g-area")!.violations, 0);
  assert.equal(r.topics.find((a) => a.topicId === "math-a-length")!.violations, 2);
});
t("G5 rows: a bare placement fails, one that comes from an operation passes", () => {
  const nl = (id: string, question: string) => ({ id, subject: "math" as const, grade: "ב" as const, type: "number_line" as const, subtype: "number_line_placement" as ExerciseSubtype, topic_id: "math-b-arithmetic", passage: null, question, choices: null, number_line: { min: 30, max: 70, step: 5 }, tiles: null, grouping: null, correct_answer: "45", computation: null });
  const r = audit([], [nl("bare", "היכן נמצא המספר 45 על הציר?"), nl("op", "דני עמד על 40 וקפץ עוד 5. איפה הוא עכשיו על הציר?")]);
  assert.equal(r.topics[0].nlNoOperation, 1);
});
t("rows with no topic or an unknown topic are counted apart, never silently passed", () => {
  const r = audit([{ topic_id: null, subtype: "comprehension", has_computation: false, n: 4 }, { topic_id: "no-such-topic", subtype: "comprehension", has_computation: false, n: 2 }], []);
  assert.equal(r.noTopic, 4);
  assert.equal(r.unknownTopic, 2);
  assert.equal(r.bankTotal, 6);
});
t("query C's allowed pairs are exactly the table's (served topics only), and every query is a plain SELECT", () => {
  const sql = auditSql();
  const pairs = [...sql.violatingIds.matchAll(/\('([a-z0-9-]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}|${m[2]}`).sort();
  const expected = TOPICS.filter((x) => isServedTopic(x.id)).flatMap((x) => allowedFormats(x.id).map((f) => `${x.id}|${f}`)).sort();
  assert.deepEqual(pairs, expected);
  for (const q of Object.values(sql)) {
    assert.match(q.replace(/^--.*\n/gm, "").trim(), /^select /i);
    assert.ok(!/\b(insert|update|delete|drop|alter|truncate)\b/i.test(q), "read-only");
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
