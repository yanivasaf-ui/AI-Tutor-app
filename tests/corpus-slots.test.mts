/**
 * The rubric slots as filled from the corpus (lib/authoring/corpus-slots.json,
 * built by scripts/build-corpus-index.ts), and the ways they are used: the
 * rubric prompt block in generation and review, and the vetted templates.
 *
 * What must hold:
 *  - the built file is current (rebuilding changes nothing);
 *  - nothing is left a placeholder: every slot is filled with provenance or
 *    says why the corpus could not fill it;
 *  - every exemplar and template is verbatim corpus text, traceable to its
 *    item, of a high-fidelity type — never a drill, never english-
 *    international;
 *  - a slot the corpus could not fill contributes nothing to a prompt;
 *  - every template passes every gate a generated draft must.
 *
 * Run: npx tsx tests/corpus-slots.test.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import slots from "../lib/authoring/corpus-slots.json";
import { TOPIC_SLOTS, CROSS_CUTTING_SLOTS, rubricPromptBlock, UNIVERSAL_RULES, type Exemplar } from "../lib/authoring/rubric";
import { VETTED_TEMPLATES } from "../lib/authoring/vetted-templates";
import { checkQuestionQuality } from "../lib/authoring/quality-gate";
import { hasReversedThousands, isTeacherNote } from "../lib/authoring/corpus-fidelity";
import { operationScope } from "../lib/exercises/operation-scope";
import { topicFit } from "../lib/exercises/topic-fit";
import { computeAnswer } from "../lib/exercises/arithmetic";
import { generateExercise } from "../lib/exercises/generate";
import { getAnthropicClient } from "../lib/llm/anthropic";

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
async function at(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}

const ROOT = new URL("../", import.meta.url).pathname;
interface Item { id: string; grade: string; type: string; text: string; source: { url: string; page?: number; volume?: string; document?: string } }
const items: Item[] = JSON.parse(readFileSync(join(ROOT, "data/corpus/items/all-items.json"), "utf8"));
const byId = new Map(items.map((i) => [i.id, i]));

console.log("the built index");
t("corpus-slots.json is current: rebuilding from data/corpus changes nothing", () => {
  execFileSync("npx", ["tsx", "scripts/build-corpus-index.ts", "--check"], { cwd: ROOT, stdio: "pipe" });
});
t("it records which corpus it was built from (the ingest manifest's hash)", () => {
  const want = createHash("sha256").update(readFileSync(join(ROOT, "data/corpus.sha256"))).digest("hex");
  assert.equal(slots.corpusManifestSha256, want);
});
t("it stays small enough to ship in a function bundle (< 64KB)", () => {
  assert.ok(JSON.stringify(slots).length < 64 * 1024);
});

console.log("\nslots: filled, or saying why not");
const allSlots = [
  ...Object.entries(TOPIC_SLOTS),
  ...Object.entries(CROSS_CUTTING_SLOTS).flatMap(([k, g]) => Object.entries(g).map(([gr, s]) => [`${k}/${gr}`, s] as const)),
];
t("no slot is left a placeholder", () => {
  for (const [id, s] of allSlots) {
    assert.notEqual(s.phrasing.status, "placeholder", `${id} phrasing`);
    assert.notEqual(s.exemplars.status, "placeholder", `${id} exemplars`);
  }
});
t("every insufficient-evidence slot says why", () => {
  for (const [id, s] of allSlots) {
    if (s.phrasing.status === "insufficient-evidence") assert.ok(s.phrasing.note, `${id} phrasing`);
    if (s.exemplars.status === "insufficient-evidence") assert.ok(s.exemplars.note, `${id} exemplars`);
  }
});
t("coverage as built on 2026-09-25: phrasing 18/22 topics, exemplars 3/22 topics", () => {
  const topics = Object.values(TOPIC_SLOTS);
  assert.equal(topics.filter((s) => s.phrasing.status === "filled").length, 18);
  assert.equal(topics.filter((s) => s.exemplars.status === "filled").length, 3);
});
t("filled phrasing slots carry the digest's own labels, shares that make sense, and the digest sections they came from", () => {
  for (const [id, s] of allSlots) {
    if (s.phrasing.status !== "filled") continue;
    assert.ok(s.phrasing.patterns!.length > 0, id);
    for (const p of s.phrasing.patterns!) assert.ok(p.share > 0 && p.share <= 1 && p.count > 0, `${id} ${p.label}`);
    assert.match(s.phrasing.source![0].digest, /^digests\/phrasing-grade-[123]\.md$/, id);
  }
});

console.log("\nexemplars and templates: verbatim, traceable, high fidelity");
const exemplars: [string, Exemplar][] = allSlots.flatMap(([id, s]) => (s.exemplars.exemplars ?? []).map((e) => [id, e] as [string, Exemplar]));
t("every exemplar is its corpus item's text, verbatim, with that item's provenance", () => {
  assert.ok(exemplars.length > 0);
  for (const [id, e] of exemplars) {
    const item = byId.get(e.source.id);
    assert.ok(item, `${id}: ${e.source.id} not in corpus`);
    assert.equal(e.text, item!.text, `${id}: ${e.source.id} text differs from the corpus`);
    assert.equal(e.source.url, item!.source.url);
    assert.equal(e.source.page, item!.source.page);
  }
});
t("no exemplar or template is a drill, or anything but word_problem/direct_question", () => {
  for (const [, e] of exemplars) assert.ok(["word_problem", "direct_question"].includes(byId.get(e.source.id)!.type), e.source.id);
  for (const tpl of VETTED_TEMPLATES) assert.ok(["word_problem", "direct_question"].includes(byId.get(tpl.provenance.id)!.type), tpl.provenance.id);
});
t("nothing child-facing comes from english-international (every source is a Ministry Hebrew item)", () => {
  for (const [, e] of exemplars) assert.match(e.source.url, /education\.gov\.il/);
  for (const tpl of VETTED_TEMPLATES) {
    assert.match(tpl.provenance.url, /education\.gov\.il/);
    assert.match(tpl.exercise.question, /[א-ת]/);
    assert.ok(!/[A-Za-z]{3,}/.test(tpl.exercise.question));
  }
});
t("no exemplar or template carries a digit-reversed number or is a teacher note", () => {
  for (const [id, e] of exemplars) {
    assert.ok(!hasReversedThousands(e.text), `${id}: ${e.source.id} has a digit-reversed number`);
    assert.ok(!isTeacherNote(e.text), `${id}: ${e.source.id} is a teacher note`);
  }
  for (const tpl of VETTED_TEMPLATES) {
    assert.ok(!hasReversedThousands(tpl.exercise.question), tpl.provenance.id);
    assert.ok(!isTeacherNote(tpl.exercise.question), tpl.provenance.id);
  }
});
t("the filters bite: known reversed and teacher-note corpus text is caught", () => {
  assert.ok(hasReversedThousands("כַּמָּה אַרְגָּזִים צָרִיךְ כְּדֵי לְסַפֵּק אֶת הַהַזְמָנָה שֶׁל 0001, אַרְגָּזִים?"));
  assert.ok(isTeacherNote("מומלץ לבקש מהתלמידים לקרוא בקול את התרגיל לפני ההצבה"));
  assert.ok(isTeacherNote("אפשר לשאול: מה המספר הגדול ביותר? אפשרות לדיון בכיתה"));
  assert.ok(!isTeacherNote("לניבה יש 8 קלפים. כמה קלפים צריכה ניבה לקנות כדי שיהיו לה 14 קלפים?"));
});
t("every template is its corpus item's text, verbatim but for a leading list marker", () => {
  for (const tpl of VETTED_TEMPLATES) {
    const item = byId.get(tpl.provenance.id)!;
    assert.ok(item.text.endsWith(tpl.exercise.question), tpl.provenance.id);
    const dropped = item.text.slice(0, item.text.length - tpl.exercise.question.length);
    assert.match(dropped, /^([א-ת\d][֑-ׇ]?\s?\.\s*)?$/, `${tpl.provenance.id} dropped more than a list marker: "${dropped}"`);
  }
});

console.log("\nvetted templates pass every gate a generated draft must");
t("7 templates: math-b-arithmetic 4, math-g-arithmetic 1, math-g-multiplication-division 2", () => {
  const count: Record<string, number> = {};
  for (const tpl of VETTED_TEMPLATES) count[tpl.topicId] = (count[tpl.topicId] ?? 0) + 1;
  assert.deepEqual(count, { "math-b-arithmetic": 4, "math-g-arithmetic": 1, "math-g-multiplication-division": 2 });
});
for (const tpl of VETTED_TEMPLATES) {
  const ex = { id: "tpl", ...tpl.exercise };
  t(`${tpl.provenance.id}: rubric, operation scope, topic fit, and a code-computed answer`, () => {
    assert.deepEqual(checkQuestionQuality(ex).violations, []);
    assert.equal(operationScope(ex, tpl.topicId).ok, true);
    assert.equal(topicFit(ex, tpl.topicId).ok, true);
    assert.equal(String(computeAnswer(ex.computation!)), ex.correctAnswer);
    // the numbers it computes with are the numbers the child reads
    for (const n of ex.computation!.operands) assert.ok(ex.question.includes(String(n)), `${n} not in "${ex.question}"`);
  });
}

console.log("\nthe rubric prompt block");
/** Exemplars reach prompts without niqqud (see rubricPromptBlock). */
const bare = (x: string) => x.replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/g, "");
t("always carries the universal rules", () => {
  const b = rubricPromptBlock("math-a-data", "א");
  for (const r of UNIVERSAL_RULES) assert.ok(b.includes(r.he), r.id);
});
t("a filled topic adds its phrasing mix and its Ministry questions (verbatim letters, niqqud dropped)", () => {
  const b = rubricPromptBlock("math-g-multiplication-division", "ג");
  assert.match(b, /דפוסי הניסוח השכיחים/);
  for (const e of TOPIC_SLOTS["math-g-multiplication-division"].exemplars.exemplars!) assert.ok(b.includes(bare(e.text)));
});
t("an unfilled topic adds no example at all — the model gets the rules, not an invention", () => {
  const b = rubricPromptBlock("math-g-time", "ג");
  assert.ok(!b.includes("כך נשמעות שאלות אמיתיות"));
  assert.ok(!b.includes("> "));
});
t("division exemplars join in where the exercise can involve division", () => {
  const plain = rubricPromptBlock("math-b-length", "ב");
  const withDiv = rubricPromptBlock("math-b-length", "ב", { division: true });
  const div = bare(CROSS_CUTTING_SLOTS.division["ב"].exemplars.exemplars![0].text);
  assert.ok(!plain.includes(div));
  assert.ok(withDiv.includes(div));
});
t("exemplars reach the prompt WITHOUT niqqud (a pointed example makes pointed questions)", () => {
  const b = rubricPromptBlock("math-b-arithmetic", "ב", { division: true });
  assert.ok(!/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/.test(b));
  // ...while the slot data itself keeps the corpus text as it is
  assert.ok(TOPIC_SLOTS["math-b-arithmetic"].exemplars.exemplars!.some((e) => /[\u05b0-\u05bc]/.test(e.text)));
});
t("rules: false leaves the rules out (the review prompt states them itself)", () => {
  assert.ok(!rubricPromptBlock("math-b-arithmetic", "ב", { rules: false }).includes(UNIVERSAL_RULES[0].he));
});

type Call = { messages: { content: string }[] };
await at("the generation prompt carries the block for the requested topic", async () => {
  const calls: Call[] = [];
  const messages = getAnthropicClient().messages as unknown as { create: (req: Call) => Promise<unknown> };
  messages.create = async (req: Call) => {
    calls.push(req);
    return { content: [{ type: "text", text: JSON.stringify({ type: "open", question: "x", correctAnswer: "1" }) }] };
  };
  const quiet = console.warn;
  console.warn = () => {};
  await generateExercise({ subject: "math", grade: "ב", profile: null, topicId: "math-b-arithmetic", level: 2 }).catch(() => {});
  console.warn = quiet;
  const prompt = calls[0].messages[0].content;
  assert.ok(prompt.includes(UNIVERSAL_RULES.find((r) => r.id === "division-sharing-frame")!.he));
  assert.ok(prompt.includes(bare(TOPIC_SLOTS["math-b-arithmetic"].exemplars.exemplars![0].text)));
});

await at("division exemplars go only to the division-shaped subtype, not to every topic that allows division", async () => {
  const calls: Call[] = [];
  const messages = getAnthropicClient().messages as unknown as { create: (req: Call) => Promise<unknown> };
  messages.create = async (req: Call) => {
    calls.push(req);
    return { content: [{ type: "text", text: JSON.stringify({ type: "open", question: "x", correctAnswer: "1" }) }] };
  };
  const quiet = console.warn;
  console.warn = () => {};
  const divText = CROSS_CUTTING_SLOTS.division["ב"].exemplars.exemplars![0].text.replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/g, "");
  await generateExercise({ subject: "math", grade: "ב", profile: null, topicId: "math-b-length", level: 2, forceSubtype: "fill_in_blank" }).catch(() => {});
  const plain = calls.length;
  await generateExercise({ subject: "math", grade: "ב", profile: null, topicId: "math-b-length", level: 2, forceSubtype: "visual_grouping" }).catch(() => {});
  console.warn = quiet;
  assert.ok(calls.slice(0, plain).every((c) => !c.messages[0].content.includes(divText)), "a length fill_in_blank was shown division exemplars");
  assert.ok(calls[plain].messages[0].content.includes(divText), "a grouping draft was not shown division exemplars");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
