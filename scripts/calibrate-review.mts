/**
 * Offline calibration of the model review (lib/authoring/quality-review.ts).
 *
 * Runs the reviewer, at each strictness level, over the labelled set in
 * tests/fixtures/review-calibration.json:
 *  - knownBad: questions judged defective by hand — CATCH RATE is the share
 *    the reviewer rejects;
 *  - clean: questions that passed the code gate and were not judged
 *    defective — FALSE-REJECT RATE is the share the reviewer rejects.
 * The target for the level used at runtime: every known-bad caught, false
 * rejects under 10%.
 *
 * Calls the real model (the same TUTOR_MODEL as generation) — it needs
 * ANTHROPIC_API_KEY and is not part of `npm test`. It never touches the
 * runtime switch (QUESTION_REVIEW).
 *
 * Run: npx tsx --env-file=.env.local scripts/calibrate-review.mts \
 *        [--levels strict,balanced,lenient] [--repeats 1] [--out results.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { reviewQuestion, type ReviewStrictness } from "../lib/authoring/quality-review";
import { rubricPromptBlock } from "../lib/authoring/rubric";
import type { Exercise, Grade } from "../lib/exercises/types";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const LEVELS = arg("levels", "strict,balanced,lenient").split(",") as ReviewStrictness[];
const REPEATS = Number(arg("repeats", "1"));
const OUT = arg("out", "");

interface Labelled {
  topic: string;
  grade: Grade;
  subtype?: string;
  question: string;
  answer: string;
  choices?: string[];
  tiles?: string[];
  grouping?: { objects: number; emoji: string; groups: number };
  reason?: string;
}
const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/review-calibration.json", import.meta.url), "utf8")) as {
  knownBad: Labelled[];
  clean: Labelled[];
};

function toExercise(l: Labelled): Exercise {
  return {
    id: "cal",
    subject: "math",
    grade: l.grade,
    type: l.choices ? "multiple_choice" : "open",
    subtype: l.subtype as Exercise["subtype"],
    topic: "",
    topicId: l.topic,
    question: l.question,
    choices: l.choices,
    tiles: l.tiles ? { items: l.tiles, slotCount: 1, joinWith: " " } : undefined,
    grouping: l.grouping ? { items: Array(l.grouping.objects).fill(l.grouping.emoji), groupCount: l.grouping.groups } : undefined,
    correctAnswer: l.answer,
  };
}

interface Row { level: ReviewStrictness; repeat: number; set: "bad" | "clean"; question: string; rejected: boolean; checked: boolean; why: string }
const jobs = LEVELS.flatMap((level) =>
  Array.from({ length: REPEATS }, (_, repeat) => [
    ...fixture.knownBad.map((l) => ({ level, repeat, set: "bad" as const, l })),
    ...fixture.clean.map((l) => ({ level, repeat, set: "clean" as const, l })),
  ]).flat()
);
const rows: Row[] = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { level, repeat, set, l } = jobs[next++];
    const r = await reviewQuestion(toExercise(l), rubricPromptBlock(l.topic, l.grade as "א" | "ב" | "ג", { rules: false }), { strictness: level });
    rows.push({ level, repeat, set, question: l.question, rejected: !r.ok, checked: r.checked, why: r.violations.map((v) => `${v.rule}: ${v.detail}`).join(" | ") });
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

const pct = (n: number, d: number) => `${n}/${d} (${Math.round((n / d) * 100)}%)`;
console.log("\nlevel     | repeat | catch (known-bad) | false-reject (clean) | unchecked");
for (const level of LEVELS) {
  for (let rep = 0; rep < REPEATS; rep++) {
    const mine = rows.filter((r) => r.level === level && r.repeat === rep);
    const bad = mine.filter((r) => r.set === "bad");
    const clean = mine.filter((r) => r.set === "clean");
    console.log(
      `${level.padEnd(9)} | ${String(rep + 1).padEnd(6)} | ${pct(bad.filter((r) => r.rejected).length, bad.length).padEnd(17)} | ${pct(clean.filter((r) => r.rejected).length, clean.length).padEnd(20)} | ${mine.filter((r) => !r.checked).length}`
    );
  }
}
for (const level of LEVELS) {
  const mine = rows.filter((r) => r.level === level && r.repeat === 0);
  const missed = mine.filter((r) => r.set === "bad" && !r.rejected);
  const falseRej = mine.filter((r) => r.set === "clean" && r.rejected);
  console.log(`\n[${level}] missed known-bad (${missed.length}):`);
  for (const r of missed) console.log(`  - ${r.question.slice(0, 90)}`);
  console.log(`[${level}] false rejects (${falseRej.length}):`);
  for (const r of falseRej) console.log(`  - ${r.question.slice(0, 70)}  ⟶  ${r.why.slice(0, 140)}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1));
