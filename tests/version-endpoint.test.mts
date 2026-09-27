/**
 * GET /api/version — the endpoint that makes a deploy verifiable.
 *
 * It exists because a server-only change leaves the client bundle
 * byte-identical, so nothing observable from outside said which commit was
 * live. These tests pin the two things that would quietly break that:
 * the shape a person greps for, and the promise that it reports the
 * RUNNING environment rather than a cached or build-time snapshot.
 *
 * Run: npx tsx tests/version-endpoint.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const src = readFileSync(new URL("../app/api/version/route.ts", import.meta.url), "utf8");
const { GET } = await import("../app/api/version/route");

console.log("the payload");

await at("reports the running commit in short form, plus the full sha", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = "32883bb424a51d0f13a190f7411e96507e59a494";
  const body = await (await GET()).json();
  assert.equal(body.sha, "32883bb", "short form is what a person compares by eye");
  assert.equal(body.fullSha, "32883bb424a51d0f13a190f7411e96507e59a494");
});

await at("says so plainly when there is no git metadata, rather than inventing one", async () => {
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  const body = await (await GET()).json();
  assert.equal(body.sha, null);
  assert.equal(body.fullSha, null);
  assert.equal(body.env, "local");
});

await at("carries the branch and the environment", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
  process.env.VERCEL_GIT_COMMIT_REF = "main";
  process.env.VERCEL_ENV = "production";
  const body = await (await GET()).json();
  assert.deepEqual([body.sha, body.branch, body.env], ["abcdef1", "main", "production"]);
});

await at("a request never reads a previous request's answer", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = "1111111aaaa";
  const first = await (await GET()).json();
  process.env.VERCEL_GIT_COMMIT_SHA = "2222222bbbb";
  const second = await (await GET()).json();
  assert.equal(first.sha, "1111111");
  assert.equal(second.sha, "2222222", "a cached answer would make the endpoint useless");
});

await at("answers 200 with no-store, so a CDN cannot serve a stale build's identity", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
});

console.log("\nthe route is configured to be read at request time");

t("declared dynamic — a statically rendered route would freeze one build's answer forever", () => {
  assert.match(src, /export const dynamic = "force-dynamic"/);
});

t("leaks nothing but the four listed fields: no env object, no tokens, no secrets", () => {
  const body = src.slice(src.indexOf("return NextResponse.json"));
  assert.ok(!/\bprocess\.env\s*[,)}]/.test(body), "process.env must never be serialized wholesale");
  assert.ok(!/\.\.\.process\.env/.test(src), "no spreading the environment into the response");
  const named = [...src.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(named)].sort(),
    ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_SHA"],
    "only these three environment variables may be read"
  );
});

t("GET only — nothing here should ever accept a write", () => {
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(src));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
process.exit(0);
