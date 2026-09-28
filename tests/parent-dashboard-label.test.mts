/**
 * The parent dashboard no longer shows itself as an internal prototype.
 *
 * Kids-App UX Benchmark, "build first" item 1: parents used to read "אב
 * טיפוס פנימי — לא לשימוש חיצוני" under the dashboard title. That string is
 * gone; everything else on the screen (title, parent gate exit/logout,
 * loading/empty states, the kid cards) is unchanged.
 *
 * Run: npx tsx tests/parent-dashboard-label.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

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

/** ParentDashboard's own source, isolated so a match elsewhere in the file
 *  (e.g. a different screen) can't satisfy these assertions by accident. */
function block(startMarker: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `could not find: ${startMarker}`);
  const open = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after: ${startMarker}`);
}
const dashboard = block("function ParentDashboard(");

console.log("the prototype label is gone, with no replacement");
t("the exact retired string is nowhere in the file", () => {
  assert.ok(!src.includes("אב טיפוס פנימי"), "the prototype-label string must not appear anywhere");
  assert.ok(!src.includes("לא לשימוש חיצוני"), "the prototype-label string must not appear anywhere");
});
t("no new paragraph was added directly under the title row in its place", () => {
  // The title row's closing </div> must be followed by the loading/empty
  // state (or a blank line into it) — not a fresh <p> standing where the
  // label used to sit.
  const afterTitleRow = dashboard.split('</h1>')[1] ?? "";
  const firstTag = afterTitleRow.match(/<(p|span|div)\b[^>]*>/g) ?? [];
  // The nav buttons' own wrapper div is expected; nothing else before the
  // loading paragraph.
  const beforeLoading = afterTitleRow.split('{loading &&')[0];
  const strayParagraphs = (beforeLoading.match(/<p\b/g) ?? []).length;
  assert.equal(strayParagraphs, 0, `found ${strayParagraphs} unexpected <p> element(s) between the title and the loading state`);
  assert.ok(firstTag.length > 0, "sanity: the nav row should still be there");
});

console.log("\neverything else on the screen is untouched");
t("the title is unchanged", () => {
  assert.match(dashboard, /<h1 className="text-2xl font-bold text-\[var\(--color-ink\)\]">לוח בקרה להורים<\/h1>/);
});
t("the back and logout controls are unchanged", () => {
  assert.match(dashboard, /onClick=\{onBack\}[\s\S]{0,80}חזרה/);
  assert.match(dashboard, /onClick=\{onLogout\}[\s\S]{0,80}התנתקות/);
});
t("the loading and empty states are unchanged", () => {
  assert.match(dashboard, /\{loading && <p className="text-\[var\(--color-ink-soft\)\] text-sm">טוען\.\.\.<\/p>\}/);
  assert.match(dashboard, /אין עדיין ילדים רשומים\./);
});
t("the kid cards still render (map over kids is intact)", () => {
  assert.match(dashboard, /\{kids\.map\(\(kid\) => \{/);
});
t("the title row keeps a bottom margin, so removing the label doesn't collapse the spacing before the content", () => {
  const titleRow = dashboard.match(/<div className="flex items-center justify-between ([^"]*)">/);
  assert.ok(titleRow, "could not find the title row");
  assert.match(titleRow![1], /mb-\d/, "the title row should carry its own bottom margin now that the label paragraph (which used to provide it) is gone");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
