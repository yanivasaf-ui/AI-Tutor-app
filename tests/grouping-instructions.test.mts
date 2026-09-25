/**
 * The tap-to-place instruction names the object the exercise actually draws.
 *
 * It said "לוחצים על כוכב, ואז על הקבוצה" for every grouping exercise. The
 * production bank (queried 2026-09-25) has 94 grouping rows and none draw
 * stars; the objects are apples, triangles, flowers, squares, clocks,
 * rulers... and once a Hebrew letter. The fixture below is that list,
 * verbatim, with the name each should get.
 *
 * Run: npx tsx tests/grouping-instructions.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { groupingObjectName, NEUTRAL_OBJECT } from "../lib/exercises/grouping-objects";
import { groupingInstructions } from "../lib/guide/lines";
// The component is compiled for the classic JSX runtime under tsx, which
// reaches for a global React; provide it, then import the widget.
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
const widgetModule = await import("../components/exercises/GroupingWidget");
const unwrap = (m: unknown): unknown => (m && typeof m === "object" && "default" in m ? unwrap((m as { default: unknown }).default) : m);
const GroupingWidget = unwrap(widgetModule) as typeof widgetModule.default;

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

/** Every distinct first item in the production `exercises` bank's grouping
 *  rows (94), with the row count, and the name expected. */
const PROD_OBJECTS: [emoji: string, rows: number, name: string][] = [
  ["🍎", 26, "תפוח"], ["🔺", 10, "משולש"], ["🌸", 8, "פרח"], ["🟦", 7, "ריבוע"], ["⏰", 7, "שעון"], ["📏", 6, "סרגל"],
  ["🕐", 3, "שעון"], ["🎈", 3, "בלון"], ["👦", 3, "ילד"], ["⬜", 2, "ריבוע"], ["🧊", 2, "קובייה"], ["👣", 2, "טביעת רגל"],
  ["📐", 1, "משולש"], ["א", 1, "אות"], ["🏀", 1, "כדור"], ["🍪", 1, "עוגייה"], ["⚽", 1, "כדור"], ["🍃", 1, "עלה"],
  ["📎", 1, "מהדק"], ["🍅", 1, "עגבנייה"], ["⬛", 1, "ריבוע"], ["🏃", 1, "ילד"], ["🧱", 1, "לבנה"], ["⛛", 1, "משולש"],
  ["⏱️", 1, "שעון עצר"], ["🌙", 1, "ירח"], ["⏳", 1, "שעון חול"],
];

console.log("the instruction names the drawn object");
t("the fixture is the production bank: 27 distinct objects over 94 rows", () => {
  assert.equal(PROD_OBJECTS.length, 27);
  assert.equal(PROD_OBJECTS.reduce((a, [, n]) => a + n, 0), 94);
});
for (const [emoji, rows, name] of PROD_OBJECTS) {
  t(`${emoji} (${rows} prod rows) → "לוחצים על ${name}, ואז על הקבוצה."`, () => {
    assert.equal(groupingInstructions(emoji).text, `לוחצים על ${name}, ואז על הקבוצה.`);
  });
}
t("no production object is left on the neutral fallback (each has a real name)", () => {
  for (const [emoji] of PROD_OBJECTS) assert.notEqual(groupingObjectName(emoji), NEUTRAL_OBJECT, emoji);
});
t("'כוכב' is said only for a star", () => {
  assert.match(groupingInstructions("⭐").text, /כוכב/);
  for (const [emoji] of PROD_OBJECTS) assert.ok(!/כוכב/.test(groupingInstructions(emoji).text), emoji);
});
t("an object with no name gets the neutral wording, never a wrong name", () => {
  for (const unknown of ["🦖", "🛸", "#", "?", "12", ""]) assert.equal(groupingInstructions(unknown).text, "לוחצים על חפץ, ואז על הקבוצה.", unknown);
  assert.equal(groupingInstructions(undefined).text, "לוחצים על חפץ, ואז על הקבוצה.");
});
t("a variation selector doesn't change the name ('✏' and '✏️')", () => {
  assert.equal(groupingObjectName("✏"), groupingObjectName("✏️"));
  assert.equal(groupingObjectName("✏️"), "עיפרון");
});
t("the instruction stays plural-neutral and gender-free: 'לוחצים על X, ואז על הקבוצה.'", () => {
  for (const [emoji] of PROD_OBJECTS) assert.match(groupingInstructions(emoji).text, /^לוחצים על [א-ת ]+, ואז על הקבוצה\.$/, emoji);
});

console.log("\nboth places the instruction appears pass the exercise's object");
const screen = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");
t("the spoken script and the caption both call groupingInstructions with the first grouping item", () => {
  const calls = screen.match(/lines\.groupingInstructions\([^)]*\)/g) ?? [];
  assert.equal(calls.length, 2, "expected the spoken script and the caption");
  for (const c of calls) assert.match(c, /grouping\?\.items\[0\]/, c);
});

console.log("\none render per object type: the widget draws the object the caption names");
for (const [emoji, , name] of PROD_OBJECTS.filter(([e]) => ["🍎", "🔺", "🌸", "⏰", "📏", "א"].includes(e))) {
  t(`${emoji}: the rendered pool shows ${emoji}, and the caption above it says "${name}"`, () => {
    const items = Array(6).fill(emoji);
    const html = renderToStaticMarkup(createElement(GroupingWidget, { data: { items, groupCount: 3 }, disabled: false, onSubmit: () => {} }));
    // Each pooled object is its own element: >emoji<. (Counting the bare
    // character would also count "א" inside other Hebrew words.)
    assert.equal(html.split(`>${emoji}<`).length - 1, 6, "the six objects are on screen");
    assert.match(html, /0 מתוך 6/);
    assert.equal(groupingInstructions(items[0]).text, `לוחצים על ${name}, ואז על הקבוצה.`);
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
