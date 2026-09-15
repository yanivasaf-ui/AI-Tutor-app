/**
 * What a parent sees when sign-in / sign-up fails.
 *
 * Supabase auth reports a dead network or a down auth server as an error
 * whose message is the browser's raw fetch failure — "Failed to fetch" in
 * Chrome, "Load failed" in Safari. During a Supabase outage that reads
 * like the form rejected the parent's email or password. Anything at the
 * network/server level gets one clear Hebrew line instead; genuine auth
 * errors (wrong password, rate limit, unconfirmed email) keep their
 * message.
 *
 * Classification, broadest signal first:
 * - AuthRetryableFetchError — supabase-js's own type for "request never
 *   completed" (status 0) and gateway failures (502/503/504);
 * - any other 5xx — the auth server itself erroring;
 * - a thrown TypeError — what fetch throws when the network is down;
 * - the raw fetch-failure strings, as a last net across browsers.
 */
export const NETWORK_ERROR_MESSAGE = "שגיאת תקשורת, נסו שוב בעוד כמה דקות";
const GENERIC_ERROR_MESSAGE = "משהו השתבש, נסו שוב";

const RAW_FETCH_FAILURE = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const e = err as { name?: unknown; message?: unknown; status?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  if (e.name === "AuthRetryableFetchError") return true;
  if (typeof e.status === "number" && e.status >= 500) return true;
  return typeof e.message === "string" && RAW_FETCH_FAILURE.test(e.message);
}

export function authErrorMessage(err: unknown): string {
  if (isNetworkError(err)) return NETWORK_ERROR_MESSAGE;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : GENERIC_ERROR_MESSAGE;
}
