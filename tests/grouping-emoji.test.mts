/**
 * Group-division exercises never divide stars.
 *
 * ⭐ was this app's reward currency AND the object children sorted into
 * piles in grouping exercises, so the app taught "stars are what you earn"
 * and then asked them to divide earnings. The reward audit removed the
 * reward displays; the 19 existing bank rows were rewritten to apples
 * (docs/investigations/star-to-apple/). This closes the last source: the
 * generation prompt itself offered "🍎 או ⭐", so every newly generated
 * grouping row could bring a star back.
 *
 * Two layers, because a prompt is a request and not a guarantee: the
 * prompt no longer offers a star, and the generator rejects a draft that
 * uses one so the existing retry loop asks again.
 *
 * Run: npx tsx tests/grouping-emoji.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
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

type Req = { messages: { content: string }[] };
function fakeModel(replies: object[]) {
  const calls: Req[] = [];
  const messages = getAnthropicClient().messages as unknown as { create: (r: Req) => Promise<unknown> };
  messages.create = async (req: Req) => {
    calls.push(req);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { content: [{ type: "text", text: JSON.stringify(reply) }] };
  };
  return calls;
}

const grouping = (emoji: string, n = 12, groups = 3, extra: string[] = []) => ({
  type: "grouping",
  topic: "חשבון",
  question: "חלקו את החפצים ל-3 קבוצות שוות. כמה חפצים יהיו בכל קבוצה?",
  grouping: { items: [...Array(n - extra.length).fill(emoji), ...extra], groupCount: groups },
  correctAnswer: String(n / groups),
});

const gen = () =>
  generateExercise({ subject: "math", grade: "ב", profile: null, topicId: "math-b-arithmetic", level: 2, forceSubtype: "visual_grouping" });

const quiet = console.warn;
console.warn = () => {};

console.log("layer 1 — the prompt no longer offers a star");

await at("the prompt sent for a grouping exercise offers 🍎 and contains no ⭐ at all", async () => {
  const calls = fakeModel([grouping("🍎")]);
  await gen();
  const prompt = calls[0].messages[0].content;
  assert.ok(prompt.includes("🍎"), "the grouping guidance must still give an example object");
  assert.ok(!prompt.includes("⭐"), "no star may appear anywhere in a grouping prompt, not even as a warning");
});

t("the visual_grouping guidance string in the source has no ⭐, and still has 🍎", () => {
  const src = readFileSync(new URL("../lib/exercises/generate.ts", import.meta.url), "utf8");
  const start = src.indexOf("  visual_grouping:");
  const block = src.slice(start, src.indexOf("\n  ", src.indexOf("',", start)));
  assert.ok(block.includes("🍎"));
  assert.ok(!block.includes("⭐"), "the guidance string itself must not offer a star");
});

console.log("\nlayer 2 — the generator rejects a star draft");

await at("a draft dividing stars is rejected and re-requested; the apple draft is what comes back", async () => {
  const calls = fakeModel([grouping("⭐"), grouping("🍎")]);
  const out = await gen();
  assert.equal(calls.length, 2, "exactly one retry");
  assert.deepEqual(new Set(out.grouping!.items), new Set(["🍎"]), "the returned exercise divides apples");
  assert.equal(out.grouping!.items.includes("⭐"), false);
});

await at("if the model keeps returning stars it FAILS, and nothing star-shaped is ever returned", async () => {
  const calls = fakeModel([grouping("⭐")]);
  await assert.rejects(gen(), /⭐/);
  assert.equal(calls.length, 3, "bounded by the existing MAX_GENERATION_ATTEMPTS, not a new loop");
});

await at("a SINGLE star among apples is enough to reject the draft", async () => {
  const calls = fakeModel([grouping("🍎", 12, 3, ["⭐"]), grouping("🍎")]);
  const out = await gen();
  assert.equal(calls.length, 2);
  assert.ok(out.grouping!.items.every((i) => i === "🍎"));
});

await at("apples are accepted first time, with no retry", async () => {
  const calls = fakeModel([grouping("🍎")]);
  const out = await gen();
  assert.equal(calls.length, 1);
  assert.equal(out.grouping!.items.length, 12);
  assert.equal(out.correctAnswer, "4", "the mechanic is unchanged: items / groupCount");
});

await at("the guard is only about the star — other objects are still fine", async () => {
  for (const emoji of ["🎈", "🌸", "🍎"]) {
    const calls = fakeModel([grouping(emoji)]);
    const out = await gen();
    assert.equal(calls.length, 1, `${emoji} must not be rejected`);
    assert.equal(out.grouping!.items[0], emoji);
  }
});

await at("the existing grouping rules still apply: an uneven split is still rejected", async () => {
  // 5 apples in 2 groups with the answer "2.5" is chosen so that it PASSES
  // the correctAnswer check (5 / 2 is "2.5") and can only be caught by the
  // divisibility rule itself. A draft like 11-in-3 with the answer "4" would
  // be rejected by the answer check anyway, and prove nothing about this rule.
  const uneven = { ...grouping("🍎", 12, 3), grouping: { items: Array(5).fill("🍎"), groupCount: 2 }, correctAnswer: "2.5" };
  const calls = fakeModel([uneven, grouping("🍎")]);
  const out = await gen();
  assert.equal(calls.length, 2, "the divisibility check still fires, independent of the star check");
  assert.equal(out.grouping!.items.length, 12);
});

console.log("\nscope: this is about the object being DIVIDED, nothing else");

await at("a shape-pattern exercise may still use ⭐ as one shape — it is not a division object", async () => {
  const shapeDraft = {
    type: "tile_order",
    topic: "צורות",
    question: "איזו צורה ממשיכה את הרצף? ⭐ 🔵 ⭐ 🔵 ___",
    tiles: { items: ["⭐", "🔵", "🔺", "🟦"] },
    correctAnswer: "⭐",
  };
  const calls = fakeModel([shapeDraft]);
  const out = await generateExercise({ subject: "math", grade: "א", profile: null, topicId: "math-a-geometry", level: 2, forceSubtype: "shape_match" });
  assert.equal(calls.length, 1, "the star guard must not reach outside grouping exercises");
  assert.ok(out.tiles!.items.includes("⭐"));
});

console.warn = quiet;

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
process.exit(0);
