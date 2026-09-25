/**
 * Loading the signed-in parent's kids — and telling "the parent has no kids"
 * (genuinely empty: onboard them) from "the fetch failed" (say so and offer a
 * retry).
 *
 * BUG (found in the multi-kid trace, 2026-09-25): the fetch used to turn every
 * failure into `[]` — offline, a 5xx, a bad body, a 401 that outlived its
 * retry. The page reads `[]` as "no kids", shows full onboarding, and the
 * parent finishing it POSTs another kid: a duplicate row for a parent who
 * already had one, and nothing caps kids per parent. Now a failure is an
 * `error` result and NEVER an empty list.
 */

export type KidsLoad<K> = { status: "loaded"; kids: K[] } | { status: "error" };

/** The same fresh-sign-in cookie-propagation race handled for /api/stt: the
 *  first request right after sign-in can 401 for a genuinely signed-in
 *  parent, so a 401 is retried once after this pause. */
export const KIDS_FETCH_RETRY_DELAY_MS = 400;

export interface LoadKidsDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** GET /api/kids?view=kid. `loaded` only for a 2xx whose body has a `kids`
 *  array — an empty array there is a real "no kids yet". Anything else,
 *  including a body that isn't what we expect, is `error`. */
export async function loadKids<K>(deps: LoadKidsDeps = {}): Promise<KidsLoad<K>> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const get = () => fetchImpl("/api/kids?view=kid").catch(() => null);

  let res = await get();
  if (res?.status === 401) {
    await sleep(KIDS_FETCH_RETRY_DELAY_MS);
    res = await get();
  }
  if (!res?.ok) return { status: "error" };
  try {
    const body = (await res.json()) as { kids?: unknown };
    return Array.isArray(body?.kids) ? { status: "loaded", kids: body.kids as K[] } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** Where the load state leaves the page. `retry` for a failure; `onboarding`
 *  only for a load that succeeded and found no kid. */
export type KidsScreen = "loading" | "retry" | "onboarding" | "kid";

export function kidsScreen(load: "pending" | "loaded" | "error", hasKid: boolean): KidsScreen {
  if (load === "pending") return "loading";
  if (load === "error") return "retry";
  return hasKid ? "kid" : "onboarding";
}
