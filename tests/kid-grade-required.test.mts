/**
 * A new kid cannot be created without a grade (QA 2026-09-27: a kid with
 * grade NULL silently gets grade-א topics). The product's grades are
 * א, ב, ג — the kids.grade CHECK constraint, the topic map and the bank
 * agree on exactly these.
 *
 * Run: npx tsx tests/kid-grade-required.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateNewKid } from "../lib/kids/newKid";
import { GRADES } from "../lib/kids/grade";
import { TOPICS } from "../lib/map/topics";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
const promptModule = await import("../components/parent/GradePrompt");
const unwrap = (m: unknown): unknown => (m && typeof m === "object" && "default" in m ? unwrap((m as { default: unknown }).default) : m);
const GradePrompt = unwrap(promptModule) as typeof promptModule.default;

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
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("the grade set");
t("GRADES is exactly the grades the topic map covers (א, ב, ג)", () => {
  assert.deepEqual([...GRADES].sort(), [...new Set(TOPICS.map((x) => x.grade))].sort());
  assert.deepEqual(GRADES, ["א", "ב", "ג"]);
});

console.log("\nnew kid cannot be created without a grade");
t("no grade, a null grade, or an empty grade → refused", () => {
  for (const grade of [undefined, null, ""]) {
    const r = validateNewKid({ name: "דנה", avatarId: "girl", grade });
    assert.equal(r.ok, false, String(grade));
    if (!r.ok) assert.match(r.error, /grade is required/);
  }
});
t("a grade outside the product's set → refused", () => {
  for (const grade of ["ד", "1", "a", "א׳", 1]) assert.equal(validateNewKid({ name: "דנה", grade }).ok, false, String(grade));
});
t("each real grade → accepted, and carried through as given", () => {
  for (const grade of GRADES) {
    const r = validateNewKid({ name: "  דנה ", avatarId: "girl", grade, gender: "girl" });
    assert.equal(r.ok, true, grade);
    if (r.ok) assert.deepEqual(r.kid, { name: "דנה", avatarId: "girl", grade, gender: "girl" });
  }
});
t("the other checks still hold (name required, gender boy/girl or absent)", () => {
  assert.equal(validateNewKid({ name: " ", grade: "ב" }).ok, false);
  assert.equal(validateNewKid({ name: "דנה", grade: "ב", gender: "x" }).ok, false);
  assert.equal(validateNewKid({ name: "דנה", grade: "ב" }).ok, true);
  assert.equal(validateNewKid(null).ok, false);
});

console.log("\nthe wiring");
t("the create endpoint validates first and answers 400 without creating anything", () => {
  const route = src("app/api/kids/route.ts");
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("interface PatchBody"));
  const v = post.indexOf("const input = validateNewKid(");
  const reject = post.indexOf("if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });");
  const create = post.indexOf("await createKid(");
  assert.ok(v > 0 && reject > v && create > reject, "validate → 400 → create, in that order");
});
t("createKid takes a Grade — not a Grade | null", () => {
  assert.match(src("lib/memory/store.ts"), /grade: Grade,\s*gender: KidGender \| null\s*\): Promise<KidProfile>/);
});
t("onboarding sends the chosen grade, with no fallback, and never saves a new kid without one", () => {
  const page = src("app/page.tsx");
  assert.ok(!/grade \?\? "א"/.test(page), "no silent grade-א fallback");
  assert.match(page, /if \(mode !== "repick" && !grade\) return;/);
  assert.match(page, /body: JSON\.stringify\(\{ name: trimmed, avatarId: picked, grade, gender \}\)/);
  assert.match(page, /\{grade && \(\s*<button onClick=\{save\}/, "the start button appears only once a grade is picked");
});

console.log("\nexisting kids with no grade: the parent is asked, inline");
t("the prompt names the kid and offers exactly the product's grades", () => {
  const html = renderToStaticMarkup(createElement(GradePrompt, { kidId: "k1", kidName: "דנה", onSaved: () => {} }));
  assert.match(html, /באיזו כיתה דנה\?/);
  assert.deepEqual([...html.matchAll(/<button[^>]*>(כיתה [אבג]׳)<\/button>/g)].map((m) => m[1]), ["כיתה א׳", "כיתה ב׳", "כיתה ג׳"]);
  assert.match(html, /בינתיים התרגילים הם של כיתה א׳/, "says what happens until then");
});
t("it saves through PATCH /api/kids with the kid's id and the grade, then reloads the dashboard", () => {
  const c = src("components/parent/GradePrompt.tsx");
  assert.match(c, /fetch\("\/api\/kids", \{\s*method: "PATCH",[\s\S]{0,120}body: JSON\.stringify\(\{ id: kidId, grade \}\)/);
  assert.match(c, /if \(!res\.ok\) throw new Error[\s\S]{0,40}onSaved\(\);/);
});
t("the dashboard shows it only for a kid whose grade is missing — and nothing else changes for the kid", () => {
  const page = src("app/page.tsx");
  assert.match(page, /\{kid\.grade == null && <GradePrompt kidId=\{kid\.id\} kidName=\{kid\.name\} onSaved=\{load\} \/>\}/);
  assert.match(src("lib/kids/grade.ts"), /return kid\.grade \?\? readLegacyStoredGrade\(kid\.id\) \?\? "א";/, "the kid's fallback until then is unchanged");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
