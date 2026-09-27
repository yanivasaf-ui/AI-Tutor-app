/**
 * No duplicate kid on a failed fetch (lib/kids/load.ts, app/page.tsx).
 *
 * The bug: the kids fetch turned EVERY failure into `[]`; the page read `[]`
 * as "no kids", showed full onboarding, and finishing it POSTed a duplicate
 * kid for a parent who already had one. Two paths are pinned here:
 *   error          → the retry screen, never onboarding
 *   genuinely empty → onboarding, as before
 *
 * Run: npx tsx tests/kids-load.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as unknown as { React: typeof React }).React = React;
import { loadKids, kidsScreen, KIDS_FETCH_RETRY_DELAY_MS } from "../lib/kids/load";
const errorModule = await import("../components/home/KidsLoadError");
const unwrap = (m: unknown): unknown => (m && typeof m === "object" && "default" in m ? unwrap((m as { default: unknown }).default) : m);
const KidsLoadError = unwrap(errorModule) as typeof errorModule.default;

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

type Reply = { status: number; body?: unknown; rawBody?: string } | "network-error";
/** A fake fetch that plays `replies` in order, and records every call. */
function fakeFetch(replies: Reply[]) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r === "network-error") throw new TypeError("Failed to fetch");
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => {
        if (r.rawBody !== undefined) return JSON.parse(r.rawBody);
        return r.body;
      },
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const noSleep = async () => {};
const load = (replies: Reply[]) => {
  const f = fakeFetch(replies);
  return loadKids<{ id: string }>({ fetchImpl: f.impl, sleep: noSleep }).then((r) => ({ r, calls: f.calls }));
};

console.log("path 1 — the fetch FAILED: an error, never an empty list");
for (const [name, replies] of [
  ["a 500", [{ status: 500 }]],
  ["a 503", [{ status: 503 }]],
  ["a network failure (offline)", ["network-error"]],
  ["a 401 that is still a 401 after the retry", [{ status: 401 }, { status: 401 }]],
  ["a 2xx whose body isn't JSON", [{ status: 200, rawBody: "<html>" }]],
  ["a 2xx with no kids field", [{ status: 200, body: {} }]],
  ["a 2xx whose kids is not an array", [{ status: 200, body: { kids: null } }]],
  ["a 404", [{ status: 404 }]],
] as [string, Reply[]][]) {
  await at(`${name} → status "error"`, async () => {
    const { r } = await load(replies);
    assert.deepEqual(r, { status: "error" });
  });
}
t("the error state leads to the retry screen, and only that", () => {
  assert.equal(kidsScreen("error", false), "retry");
  assert.equal(kidsScreen("error", true), "retry", "even with a stale kid in state");
});

console.log("\npath 2 — genuinely empty: onboarding, as before");
await at("a 200 with kids: [] is a loaded result with no kids", async () => {
  const { r } = await load([{ status: 200, body: { kids: [] } }]);
  assert.deepEqual(r, { status: "loaded", kids: [] });
});
t("loaded with no kid → onboarding; loaded with a kid → the kid's home", () => {
  assert.equal(kidsScreen("loaded", false), "onboarding");
  assert.equal(kidsScreen("loaded", true), "kid");
});
t("pending is a loading screen, never onboarding or retry", () => {
  assert.equal(kidsScreen("pending", false), "loading");
  assert.equal(kidsScreen("pending", true), "loading");
});
t("onboarding is reachable ONLY from a successful, empty load (exhaustive over the state space)", () => {
  for (const load of ["pending", "loaded", "error"] as const) {
    for (const hasKid of [true, false]) {
      const screen = kidsScreen(load, hasKid);
      assert.equal(screen === "onboarding", load === "loaded" && !hasKid, `${load}/${hasKid} → ${screen}`);
    }
  }
});

console.log("\nunchanged behaviour");
await at("kids are returned, in the server's order", async () => {
  const { r } = await load([{ status: 200, body: { kids: [{ id: "a" }, { id: "b" }] } }]);
  assert.deepEqual(r, { status: "loaded", kids: [{ id: "a" }, { id: "b" }] });
});
await at("the fresh-sign-in 401 race is still retried once: 401 then 200 → loaded", async () => {
  const { r, calls } = await load([{ status: 401 }, { status: 200, body: { kids: [{ id: "a" }] } }]);
  assert.deepEqual(r, { status: "loaded", kids: [{ id: "a" }] });
  assert.equal(calls.length, 2);
});
await at("...and only a 401 is retried (a 500 is not, and costs one request)", async () => {
  const { calls } = await load([{ status: 500 }]);
  assert.equal(calls.length, 1);
});
await at("the retry waits the configured delay", async () => {
  const waits: number[] = [];
  const f = fakeFetch([{ status: 401 }, { status: 401 }]);
  await loadKids({ fetchImpl: f.impl, sleep: async (ms) => void waits.push(ms) });
  assert.deepEqual(waits, [KIDS_FETCH_RETRY_DELAY_MS]);
});
await at("it asks for view=kid", async () => {
  const { calls } = await load([{ status: 200, body: { kids: [] } }]);
  assert.deepEqual(calls, ["/api/kids?view=kid"]);
});

console.log("\nthe retry screen");
t("it says the profile could not be loaded, offers a retry and a sign-out, and is not onboarding", () => {
  const html = renderToStaticMarkup(React.createElement(KidsLoadError, { onRetry: () => {}, onLogout: () => {} }));
  assert.match(html, /לא הצלחנו לטעון את הפרופיל/);
  assert.match(html, />לנסות שוב</);
  assert.match(html, />התנתקות</);
  assert.match(html, /role="alert"/);
  assert.ok(!/שם|דמות|כיתה/.test(html), "no onboarding fields on the retry screen");
});

console.log("\nthe page uses it (source check — the page has no DOM harness)");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
t("the page loads kids through loadKids and no longer swallows failures into []", () => {
  assert.match(page, /loadKids<Kid>\(\)/);
  assert.ok(!/function fetchKids/.test(page), "the old fetchKids is gone");
  assert.ok(!/\.finally\(\(\) => \{\s*if \(!cancelled\) setKidLoadState\("loaded"\)/.test(page), "a failure must not settle to loaded");
});
t("an error result sets the error state, and a thrown load does too", () => {
  assert.match(page, /result\.status === "error"[\s\S]{0,80}setKidLoadState\("error"\)/);
  assert.match(page, /\.catch\(\(\) => \{\s*if \(!cancelled\) setKidLoadState\("error"\)/);
});
t("the retry screen is rendered BEFORE the full-onboarding branch", () => {
  const retry = page.indexOf('kidsScreen(kidLoadState, kid !== null) === "retry"');
  const onboarding = page.indexOf('<Onboarding mode="full"');
  assert.ok(retry > -1 && onboarding > -1 && retry < onboarding, `retry@${retry} onboarding@${onboarding}`);
});
t("retry re-runs the load: it goes back to pending and bumps the effect's dependency", () => {
  assert.match(page, /setKidLoadState\("pending"\);\s*setKidsAttempt\(\(n\) => n \+ 1\)/);
  assert.match(page, /\}, \[userId, kidsAttempt\]\)/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
