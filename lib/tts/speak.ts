import type { CharacterId } from "@/lib/characters";
import { synthesizeSpeech, TtsNotConfiguredError } from "./cartesia";

/**
 * The speak action's server side: Cartesia, with every failure classified
 * by STAGE and SCOPE instead of flattened into "502 tts_failed".
 *
 * Why (QA sweep 2026-09-26: 118/177 speak calls failed): the account's
 * Cartesia credit ran out mid-sweep. Cartesia said so — 402
 * quota_exceeded — but the route reported every non-OK answer as a 502,
 * and the client treats a 502 as a one-line blip: each following line
 * still paid a niqqud model call and a Cartesia round trip, failed, and
 * fell back to the browser voice (silent on a device with no Hebrew
 * voice). Read-aloud "died for long stretches".
 *
 *   scope "session" — the account cannot synthesize at all right now
 *                     (credit exhausted, key rejected, not configured).
 *                     The client turns the cloud voice off; with a
 *                     retry-after it turns it back on by itself later.
 *                     A breaker here answers the same without calling
 *                     anything (no niqqud call, no Cartesia call) until
 *                     the cooldown ends.
 *   scope "line"    — this one line failed (rate/concurrency limit,
 *                     Cartesia 5xx, timeout, network). Retried once when
 *                     that can help; then the client says this line in
 *                     the browser voice and tries Cartesia for the next.
 *
 * Nothing here ever reaches the child as an error: every failure is a 503
 * the client's voice fallback consumes. Never logs the text (lines
 * address the child by name).
 */

export type TtsStage = "config" | "breaker" | "request" | "upstream";
export type TtsScope = "session" | "line";

export interface TtsFailure {
  stage: TtsStage;
  scope: TtsScope;
  /** Short machine reason: quota, credentials, not_configured, rate_limited, upstream_error, rejected, timeout, network. */
  reason: string;
  /** Upstream HTTP status, when Cartesia answered. */
  status?: number;
  /** Seconds after which the client may try Cartesia again (session scope). */
  retryAfterSec?: number;
}

export type SpeakResult = { ok: true; response: Response } | { ok: false; failure: TtsFailure };

/** How long an account-level outage keeps the cloud voice off. Short
 *  enough that restored credit is heard within minutes. */
export const SESSION_OUTAGE_COOLDOWN_SEC = 300;
/** A request Cartesia has not answered by then is a line failure. */
export const UPSTREAM_TIMEOUT_MS = 12_000;
/** The one retry's wait, for a limit that frees up in moments. */
export const RETRY_DELAY_MS = 400;

let outage: { until: number; failure: TtsFailure } | null = null;
let upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS;
let retryDelayMs = RETRY_DELAY_MS;

/** Tests only. */
export const __ttsTestHooks = {
  reset() {
    outage = null;
    upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS;
    retryDelayMs = RETRY_DELAY_MS;
  },
  setTimeouts(timeoutMs: number, retryMs: number) {
    upstreamTimeoutMs = timeoutMs;
    retryDelayMs = retryMs;
  },
};

/** A non-audio Cartesia answer, as a failure. */
export function classifyUpstream(status: number, errorCode: string | undefined): Omit<TtsFailure, "stage"> {
  if (status === 402 || errorCode === "quota_exceeded") return { scope: "session", reason: "quota", status, retryAfterSec: SESSION_OUTAGE_COOLDOWN_SEC };
  if (status === 401 || status === 403) return { scope: "session", reason: "credentials", status, retryAfterSec: SESSION_OUTAGE_COOLDOWN_SEC };
  if (status === 429) return { scope: "line", reason: "rate_limited", status };
  if (status >= 500) return { scope: "line", reason: "upstream_error", status };
  return { scope: "line", reason: "rejected", status };
}

const retryable = (f: TtsFailure) => f.reason === "rate_limited" || f.reason === "upstream_error" || f.reason === "network";

function log(f: TtsFailure, attempt: number, extra = "") {
  console.error(
    `[tts] stage=${f.stage} scope=${f.scope} reason=${f.reason}${f.status ? ` status=${f.status}` : ""} attempt=${attempt}${extra}`
  );
}

async function attemptOnce(
  text: string,
  character: CharacterId,
  signal: AbortSignal | undefined,
  opts: { prefetch?: boolean; live?: boolean }
): Promise<SpeakResult> {
  const timeout = AbortSignal.timeout(upstreamTimeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await synthesizeSpeech(text, character, combined, opts);
  } catch (err) {
    if (err instanceof TtsNotConfiguredError) {
      return { ok: false, failure: { stage: "config", scope: "session", reason: "not_configured" } };
    }
    if (signal?.aborted) throw err; // the client went away: not a TTS failure
    const timedOut = timeout.aborted;
    return { ok: false, failure: { stage: "request", scope: "line", reason: timedOut ? "timeout" : "network" } };
  }
  if (res.ok && res.body) return { ok: true, response: res };
  const detail = await res.text().catch(() => "");
  let code: string | undefined;
  try {
    code = (JSON.parse(detail) as { error_code?: string }).error_code;
  } catch {
    /* not JSON */
  }
  return { ok: false, failure: { stage: "upstream", ...classifyUpstream(res.status, code) } };
}

export async function speakWithFallback(
  text: string,
  character: CharacterId,
  signal?: AbortSignal,
  opts: { prefetch?: boolean; live?: boolean } = {}
): Promise<SpeakResult> {
  if (outage && Date.now() < outage.until) {
    const f: TtsFailure = { ...outage.failure, stage: "breaker", retryAfterSec: Math.max(1, Math.ceil((outage.until - Date.now()) / 1000)) };
    return { ok: false, failure: f };
  }
  outage = null;

  let result = await attemptOnce(text, character, signal, opts);
  let attempt = 1;
  if (!result.ok && retryable(result.failure)) {
    log(result.failure, attempt, " — retrying once");
    await new Promise((r) => setTimeout(r, retryDelayMs));
    if (signal?.aborted) return result;
    result = await attemptOnce(text, character, signal, opts);
    attempt = 2;
  }
  if (!result.ok) {
    const f = result.failure;
    if (f.scope === "session" && f.retryAfterSec) {
      outage = { until: Date.now() + f.retryAfterSec * 1000, failure: f };
      log(f, attempt, ` — cloud voice off for ${f.retryAfterSec}s`);
    } else {
      log(f, attempt);
    }
  }
  return result;
}
