/**
 * Builds tests/fixtures/regression-bank.json: the question-quality
 * regression bank.
 *
 * CORPUS FIXTURES — N per (grade, item topic, item type) for the product's
 * grades א–ג, from data/corpus/items/, spread evenly across the id-sorted
 * slice (deterministic). Each keeps its provenance (source.url + page, or
 * the worksheet document) and records the quality gate's verdict on it as
 * the expectation. Real Ministry text is the widest sample of real Hebrew
 * math phrasing the gate will ever be tested on: a gate change that flips
 * a verdict on any of it fails tests/regression-bank.test.mts until the
 * change is looked at and this bank rebuilt on purpose.
 *
 * Drill items are in the bank as the corpus has them, marked fidelity:low —
 * they test the gate, they are never served (data/CORPUS-INGEST.md).
 *
 * The ACCEPTANCE fixtures (today's three failing examples) are NOT built
 * here: they are written by hand in the test, with fixed expectations that
 * no rebuild can change.
 *
 * Run: npx tsx scripts/build-regression-bank.ts [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkQuestionQuality } from "../lib/authoring/quality-gate";
import type { Exercise, Grade } from "../lib/exercises/types";

const ROOT = new URL("../", import.meta.url).pathname;
const OUT = join(ROOT, "tests/fixtures/regression-bank.json");
const N = 3;

interface Item {
  id: string;
  source: { series: string; url: string; volume?: string; page?: number; document?: string };
  grade: Grade | "ד" | "ה";
  grade_num: number;
  topic: string;
  type: string;
  text: string;
}

export interface BankFixture {
  id: string;
  grade: Grade;
  topic: string;
  type: string;
  fidelity: "high" | "low" | "unrated";
  text: string;
  source: { url: string; volume?: string; page?: number; document?: string };
  expected: { ok: boolean; rules: string[] };
}

/** How a corpus item is put through the gate: as the question of an open
 *  math exercise at its grade — the text is all the gate reads. */
export function fixtureExercise(f: { id: string; grade: Grade; text: string }): Exercise {
  return { id: f.id, subject: "math", grade: f.grade, type: "open", topic: "", question: f.text, correctAnswer: "" };
}

export function verdict(f: { id: string; grade: Grade; text: string }): { ok: boolean; rules: string[] } {
  const r = checkQuestionQuality(fixtureExercise(f));
  return { ok: r.ok, rules: [...new Set(r.violations.map((v) => v.rule))].sort() };
}

function fidelity(type: string): BankFixture["fidelity"] {
  if (type === "drill") return "low";
  if (type === "word_problem" || type === "direct_question") return "high";
  return "unrated";
}

/** N items spread evenly over a slice. */
function spread<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, k) => xs[Math.floor((k * xs.length) / n)]);
}

function build(): BankFixture[] {
  const items: Item[] = JSON.parse(readFileSync(join(ROOT, "data/corpus/items/all-items.json"), "utf8"));
  const slices = new Map<string, Item[]>();
  for (const i of items) {
    if (i.grade_num > 3) continue;
    const key = `${i.grade}|${i.topic}|${i.type}`;
    (slices.get(key) ?? slices.set(key, []).get(key)!).push(i);
  }
  const out: BankFixture[] = [];
  for (const key of [...slices.keys()].sort()) {
    const seen = new Set<string>();
    const slice = slices.get(key)!.sort((a, b) => a.id.localeCompare(b.id)).filter((i) => !seen.has(i.text) && seen.add(i.text));
    for (const i of spread(slice, N)) {
      const source: BankFixture["source"] = { url: i.source.url };
      if (i.source.volume) source.volume = i.source.volume;
      if (typeof i.source.page === "number") source.page = i.source.page;
      if (i.source.document) source.document = i.source.document;
      const f = { id: i.id, grade: i.grade as Grade, text: i.text };
      out.push({ ...f, topic: i.topic, type: i.type, fidelity: fidelity(i.type), source, expected: verdict(f) });
    }
  }
  return out;
}

// Run as a script (not when the test imports verdict/fixtureExercise).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = JSON.stringify(build(), null, 1) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(OUT, "utf8") !== json) {
      console.error("tests/fixtures/regression-bank.json is stale — run npx tsx scripts/build-regression-bank.ts");
      process.exit(1);
    }
    console.log("regression bank is up to date");
  } else {
    writeFileSync(OUT, json);
    console.log(`wrote ${OUT}`);
  }
}
