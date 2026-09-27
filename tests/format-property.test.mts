/**
 * The allowed-format table as a PROPERTY: no topic can ever be assigned a
 * format outside its allowed list — not by generation's pickSubtype, not by
 * the bank seed — and serving drops or keeps the grade-ב sweep's 13 real
 * rows exactly as the table rules (BUG B, 2026-09-26).
 *
 * Run: npx tsx tests/format-property.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { TOPICS } from "../lib/map/topics";
import { allowedFormats, isServedTopic } from "../lib/map/topic-formats";
import { formatPool, generateExercise, FormatNotAllowedError, NoCurriculumContentError, SUBTYPE_GUIDANCE } from "../lib/exercises/generate";
import { seedPool } from "../lib/exercises/seed-pool";
import { formatFit } from "../lib/exercises/format-fit";
import { findReusableExercise, saveExercise } from "../lib/exercises/store";
import { getAnthropicClient } from "../lib/llm/anthropic";
import type { Exercise, ExerciseSubtype } from "../lib/exercises/types";

let passed = 0;
const failures: string[] = [];
async function at(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}

const MATH: ExerciseSubtype[] = ["fill_in_blank", "pick_operation", "explain_thinking", "number_line_placement", "pattern_completion", "visual_grouping", "equation_balance", "shape_match"];
const HEBREW: ExerciseSubtype[] = ["comprehension", "spelling_correction_mc", "root_pattern_mc", "word_build", "sentence_order", "vowel_select_mc", "phonemic_visual_mc"];
const SERVED = TOPICS.filter((t) => isServedTopic(t.id));
const sorted = (xs: Iterable<string>) => [...xs].sort();

/**
 * The model is never reached: it records the prompt and refuses, so each
 * generateExercise call yields the formats pickSubtype chose (one per
 * internal attempt). The chosen format is read from the prompt — the one
 * format whose own guidance opens in it.
 */
const SENTINEL = "model-not-called-in-this-test";
const prompts: string[] = [];
const messages = getAnthropicClient().messages as unknown as { create: (req: { messages: { content: string }[] }) => Promise<unknown> };
messages.create = async (req) => {
  prompts.push(req.messages[0].content);
  throw new Error(SENTINEL);
};
// 30 characters tell word_build from vowel_select_mc; cut before "(" because
// fill_in_blank's parenthesis is rewritten with the topic's operations.
const OPENING = Object.fromEntries(Object.entries(SUBTYPE_GUIDANCE).map(([s, g]) => [s, g.slice(0, 30).split(" (")[0]])) as Record<ExerciseSubtype, string>;
function formatIn(prompt: string): ExerciseSubtype {
  const hits = (Object.keys(OPENING) as ExerciseSubtype[]).filter((s) => prompt.includes(OPENING[s]));
  assert.equal(hits.length, 1, `expected exactly one format's guidance in the prompt, found: ${hits.join(", ") || "none"}`);
  return hits[0];
}
async function formatsChosen(topicId: string, random?: () => number): Promise<ExerciseSubtype[]> {
  const topic = TOPICS.find((t) => t.id === topicId)!;
  const real = Math.random;
  if (random) Math.random = random;
  prompts.length = 0;
  try {
    await generateExercise({ subject: topic.subject, grade: topic.grade, profile: null, topicId, level: 2 });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  } finally {
    Math.random = real;
  }
  return prompts.map(formatIn);
}
const quiet = console.warn;
console.warn = () => {};

console.log("generation: pickSubtype chooses only from the topic's allowed formats");
await at("the guidance openings identify each format uniquely (the reader below is sound)", () => {
  for (const s of Object.keys(OPENING) as ExerciseSubtype[]) {
    assert.deepEqual((Object.keys(OPENING) as ExerciseSubtype[]).filter((o) => SUBTYPE_GUIDANCE[s].includes(OPENING[o])), [s], s);
  }
});
await at("formatPool is exactly the table's list for every topic", () => {
  for (const t of TOPICS) assert.deepEqual(formatPool(t.subject, t.grade, t.id), [...allowedFormats(t.id)], t.id);
});
await at(`every served topic (${SERVED.length}), every position pickSubtype can draw: the chosen format is allowed, and every allowed format is reachable`, async () => {
  for (const t of SERVED) {
    const pool = allowedFormats(t.id);
    const seen = new Set<ExerciseSubtype>();
    for (let i = 0; i < pool.length; i++) {
      for (const f of await formatsChosen(t.id, () => (i + 0.5) / pool.length)) seen.add(f);
    }
    assert.deepEqual(sorted(seen), sorted(pool), t.id);
  }
});
await at("random draws, 20 generations per served topic: never a format outside the list", async () => {
  for (const t of SERVED) {
    for (let n = 0; n < 20; n++) {
      for (const f of await formatsChosen(t.id)) assert.ok(allowedFormats(t.id).includes(f), `${t.id} was assigned ${f}`);
    }
  }
});
await at("the edges of Math.random's range (0 and just under 1) stay inside the list", async () => {
  for (const t of SERVED) {
    for (const r of [0, 0.9999999]) for (const f of await formatsChosen(t.id, () => r)) assert.ok(allowedFormats(t.id).includes(f), `${t.id} r=${r}: ${f}`);
  }
});
await at("unserved topics are never generated for: 'no content', before the model", async () => {
  for (const t of TOPICS.filter((x) => !isServedTopic(x.id))) {
    prompts.length = 0;
    await assert.rejects(generateExercise({ subject: t.subject, grade: t.grade, profile: null, topicId: t.id, level: 2 }), (e: unknown) => e instanceof NoCurriculumContentError, t.id);
    assert.equal(prompts.length, 0, t.id);
  }
});

console.log("\nthe seed: cycles only through allowed formats, and cannot force another");
const seedScript = readFileSync(new URL("../scripts/seed-exercise-bank.ts", import.meta.url), "utf8");
await at("seedPool ⊆ the table's list for every topic; empty for unserved topics", () => {
  for (const t of TOPICS) {
    const pool = seedPool(t);
    for (const f of pool) assert.ok(allowedFormats(t.id).includes(f), `${t.id}: ${f}`);
    if (!isServedTopic(t.id)) assert.deepEqual(pool, [], t.id);
  }
});
await at("the script's cycle is seedPool's, and each format is forced into generation as-is", () => {
  assert.match(seedScript, /const pool = seedPool\(topic\);/);
  assert.match(seedScript, /const subtype = pool\[subtypeIndex % pool\.length\];/);
  assert.match(seedScript, /generateOneForSlot\(topic, difficulty, subtype, usedNames\)/);
  assert.match(seedScript, /forceSubtype: subtype,/);
});
await at("the cycle, run as the script runs it (3 laps), never leaves the list", () => {
  for (const t of TOPICS) {
    const pool = seedPool(t);
    for (let i = 0; i < pool.length * 3; i++) assert.ok(allowedFormats(t.id).includes(pool[i % pool.length]), t.id);
  }
});
await at("even a broken seed cannot force a disallowed format: every topic × every other format is refused before the model", async () => {
  let refused = 0;
  for (const t of SERVED) {
    for (const f of (t.subject === "math" ? MATH : HEBREW).filter((x) => !allowedFormats(t.id).includes(x))) {
      prompts.length = 0;
      await assert.rejects(
        generateExercise({ subject: t.subject, grade: t.grade, profile: null, topicId: t.id, level: 2, forceSubtype: f }),
        (e: unknown) => e instanceof FormatNotAllowedError,
        `${t.id} ${f}`
      );
      assert.equal(prompts.length, 0, `${t.id} ${f}: the model was called`);
      refused++;
    }
  }
  assert.ok(refused > 100, `only ${refused} combinations checked`);
});
await at("…and cannot bank one: the script's direct insert and saveExercise both run the format check", async () => {
  assert.match(seedScript, /const admitted = allNew\.filter\(\(ex\) => \{\s*const fit = formatFit\(ex, ex\.topicId\);/);
  assert.match(seedScript, /const rows = admitted\.map\(/);
  let wrote = 0;
  const db = { from: () => ({ insert: () => { wrote++; return { select: () => ({ single: async () => ({ data: null, error: null }) }) }; } }) } as never;
  for (const t of SERVED.filter((x) => x.subject === "math")) {
    const f = MATH.find((x) => !allowedFormats(t.id).includes(x))!;
    await assert.rejects(saveExercise(db, { subject: "math", grade: t.grade, type: "open", subtype: f, topic: t.topic, topicId: t.id, question: "q", correctAnswer: "1" }), /format does not fit/, `${t.id} ${f}`);
  }
  assert.equal(wrote, 0);
});
console.warn = quiet;

console.log("\nserving: the grade-ב sweep's 13 real rows through findReusableExercise");
const sweep = JSON.parse(readFileSync(new URL("./fixtures/sweep-grade-b-2026-09-26.json", import.meta.url), "utf8")) as {
  rows: Record<string, Omit<Exercise, "id" | "topic" | "difficulty">>;
};
/** What the table rules for each row — spelled out, not computed. */
const KEPT: Record<string, boolean> = {
  "830cac2a-b22c-44fb-b5f9-b21e6ba87c3c": false, // grouping under numbers
  "f6f6f191-135b-4c7e-bf86-4402414d8205": false, // sequence under shapes
  "9a3529d5-79c8-43d5-b6a1-cf60fbb52285": false, // pick-operation under shapes
  "25ceceb3-c77f-46f8-8919-b8ddeec49166": false, // sequence under length
  "397cdc85-35e0-42a4-9368-a44974f9cd33": false, // sequence under length
  "311e3b11-70d8-4e6c-9302-d8d32448bb72": true, //  6×4 cubes under volume: equation, allowed (owner)
  "4f79a2db-f8f2-44e8-842a-1a1f7327448d": false, // grouping under volume
  "1fe552ac-2dc9-4d2a-ae66-6cf8654b5208": false, // root drill under reading
  "6e55fa84-e891-4c45-8ee6-10e9dc651e15": false, // spelling drill under reading
  "0eaad9a4-f290-446e-b98c-72814a246f26": false, // comprehension under morphology (G6)
  "f55c6c4b-5db0-4b8d-8c09-bd86aa90f76b": false, // number line under time
  "719065d0-f5da-476e-80be-de83ead3542e": true, //  equation under data: allowed (the typo is not a format defect)
  "a2b1e746-ec82-47c7-b19f-49c67d05804b": false, // comprehension under standard spelling (G6)
};
const ids = Object.keys(sweep.rows);
const kept = (id: string) => KEPT[id];
const dbRow = (id: string) => {
  const e = sweep.rows[id];
  return {
    id, subject: e.subject, grade: e.grade, type: e.type, subtype: e.subtype ?? null, topic: "t", topic_id: e.topicId ?? null,
    passage: e.passage ?? null, question: e.question, choices: e.choices ?? null, number_line: e.numberLine ?? null, tiles: e.tiles ?? null,
    grouping: e.grouping ?? null, correct_answer: e.correctAnswer, computation: e.computation ?? null, difficulty: 2,
  };
};
const client = (rows: ReturnType<typeof dbRow>[]) => ({ rpc: async () => ({ data: rows, error: null }) }) as never;
await at("the expectation list covers exactly the fixture's 13 rows", () => {
  assert.deepEqual(sorted(Object.keys(KEPT)), sorted(ids));
});
await at("each row alone, requested under its own topic: dropped or kept exactly as the table rules", async () => {
  for (const id of ids) {
    const e = sweep.rows[id];
    const got = await findReusableExercise(client([dbRow(id)]), e.subject, e.grade, "kid", e.topicId, 2);
    assert.equal(got?.id === id, kept(id), `${id.slice(0, 8)} ${e.topicId} ${e.subtype}: ${got ? "served" : "dropped"}`);
    assert.equal(formatFit({ id, topic: "t", ...e } as Exercise, e.topicId).ok, kept(id), `${id.slice(0, 8)}: formatFit disagrees with the table's ruling`);
  }
});
await at("each row alone, requested with no topic: still checked against its own topic's table", async () => {
  for (const id of ids) {
    const e = sweep.rows[id];
    const got = await findReusableExercise(client([dbRow(id)]), e.subject, e.grade, "kid", undefined, 2);
    assert.equal(got?.id === id, kept(id), `${id.slice(0, 8)} unscoped`);
  }
});
await at("all 13 in one page, 50 requests: only the two allowed rows are ever served", async () => {
  const allowed = new Set(ids.filter((id) => kept(id)));
  for (const subject of ["math", "hebrew"] as const) {
    const page = ids.filter((id) => sweep.rows[id].subject === subject).map(dbRow);
    for (let i = 0; i < 50; i++) {
      const got = await findReusableExercise(client(page), subject, "ב", "kid", undefined, 2);
      if (got) assert.ok(allowed.has(got.id), `${subject}: served ${got.id}`);
      else assert.equal(subject, "hebrew", "math has two allowed rows, so a math request is never empty");
    }
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
