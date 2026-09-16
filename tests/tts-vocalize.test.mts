/**
 * fix: niqqud vocalizer word-rewrite guard (2026-09-16, voice-branch
 * review). vocalize()'s own SYSTEM_PROMPT tells the model "never change a
 * word" — but a prompt is a request, not a guarantee. The 5-clip spike
 * caught it breaking that rule once: ניפגש (future, "we'll meet") came
 * back as נפגשנו (past, "we met"). Unvalidated, that reaches Cartesia and
 * gets read aloud in front of exercise questions with full confidence,
 * indistinguishable from a correct line.
 *
 * isFaithfulVocalization is the guard: strip every niqqud/te'amim mark
 * (Unicode category Mn) from the model's output and it must reproduce
 * the input exactly. This is a proof, not a similarity heuristic — real
 * vowel points are combining marks; nothing else in the Hebrew block is.
 * No network, no LLM: exercises the guard function directly, so it holds
 * regardless of whether the model reproduces the live bug on demand.
 *
 * Run: npx tsx tests/tts-vocalize.test.mts
 */
import assert from "node:assert/strict";
import { __isFaithfulVocalizationForTests as isFaithful } from "../lib/tts/vocalize";

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

console.log("a correct vocalization is accepted");

t("plain niqqud added, nothing else touched", () => {
  assert.ok(isFaithful("ילד קורא ספר", "יֶלֶד קוֹרֵא סֵפֶר"));
});

t("the disambiguating case this whole feature exists for: ירק", () => {
  // יֶרֶק (vegetable) vs יָרֹק (green) — either reading is faithful; the
  // guard only rejects a changed WORD, not a chosen vowel reading.
  assert.ok(isFaithful("אני אוכל ירק", "אני אוֹכֵל יֶרֶק"));
});

t("numbers, punctuation and Latin letters pass through untouched", () => {
  assert.ok(isFaithful("יש לי 5 תפוחים, ו-3 בננות!", "יֵשׁ לִי 5 תַּפּוּחִים, וְ-3 בַּנָּנוֹת!"));
});

t("maqaf and sof pasuq are real characters, not niqqud — never stripped", () => {
  // Both stay in a correct vocalization's output; the guard must not
  // treat them as marks to strip away when comparing.
  assert.ok(isFaithful("בית־ספר", "בַּיִת־סֵפֶר"));
});

t("incidental whitespace differences don't trip the guard", () => {
  assert.ok(isFaithful("שלום  עולם", "שָׁלוֹם עוֹלָם"));
});

t("unvocalized text (a no-op passthrough) is trivially faithful", () => {
  assert.ok(isFaithful("שלום עולם", "שלום עולם"));
});

console.log("\na rewrite that changes a word is rejected");

t("the caught live bug: ניפגש (future) rewritten as נפגשנו (past)", () => {
  assert.ok(!isFaithful("אני ואתה ניפגש מחר", "אני ואתה נִפְגַּשְׁנוּ מָחָר"));
});

t("a dropped word is rejected", () => {
  assert.ok(!isFaithful("אני אוהב ללמוד עברית", "אֲנִי אוֹהֵב עִבְרִית"));
});

t("an added word is rejected", () => {
  assert.ok(!isFaithful("אני הולך הביתה", "אֲנִי הוֹלֵךְ מַהֵר הַבַּיְתָה"));
});

t("a substituted synonym is rejected even though it 'fits'", () => {
  assert.ok(!isFaithful("הילד שמח מאוד", "הַיֶּלֶד עָלִיז מְאוֹד"));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
