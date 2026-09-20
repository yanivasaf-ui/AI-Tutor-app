/**
 * Where the time goes between "the kid lets go of the mic" and "we have their
 * words" — instrumentation ONLY.
 *
 * feat: STT timing marks. The roadmap's target is ~2s after release, and the
 * one number we have (useVoiceInput's "transcribe" leg) is the whole wait in
 * one lump. This splits it so a real device can say which part is slow,
 * before anyone decides what to tune:
 *
 *   stop ─flush→ recorder-stopped ─close→ upload-closed ─wait→ response ─parse→ transcript
 *
 *   flush   MediaRecorder finalising the last slice after release
 *   close   recorder end → the request body finished (streamed) or the
 *           assembled POST was issued
 *   wait    body finished → response headers back: network + server + vendor
 *   vendor  the vendor's own share of `wait`, read from the route's
 *           `Server-Timing: vendor;dur=` header
 *   net+srv `wait` minus `vendor`: what the network and our own route (auth,
 *           body read) cost, by subtraction — an inference, labelled as one
 *
 * It changes no behaviour: it reads performance.now() and writes a log line.
 * Nothing here decides anything, retries anything or shortens anything, and
 * every entry point swallows its own failures so a broken log can never touch
 * a child's answer. Push-to-talk is untouched.
 *
 * Privacy: a summary holds durations, a byte count and a status — never the
 * transcript or the audio. Like lib/voice/timing.ts it goes to the console
 * (and the ?audiodebug=1 strip) on this device and nowhere else.
 */

export type SttMark = "stop" | "recorder-stopped" | "upload-closed" | "response" | "transcript";
export type SttEngine = "cloud" | "browser";
export type SttOutcome = "ok" | "no-speech" | "tap" | "cancelled" | "cloud-unavailable" | "cloud-failed" | "error";

export interface SttTraceInfo {
  engine: SttEngine;
  /** How the audio went up: mid-press as a streamed body, or in one piece at release. */
  mode?: "streamed" | "assembled";
  /** How long the mic was held. */
  heldMs?: number;
  /** Size of the recording. */
  bytes?: number;
  /** HTTP status of the /api/stt response. */
  status?: number;
  /** The first response was a 401 and the request was retried once. */
  retried401?: boolean;
  /** Vendor time reported by the server (Server-Timing). */
  vendorMs?: number | null;
  /** When the streamed upload opened, in ms after the press began. */
  streamOpenedAfterMs?: number;
}

export interface SttTimingSummary {
  at: number;
  engine: SttEngine;
  mode: "streamed" | "assembled" | null;
  outcome: SttOutcome;
  heldMs: number | null;
  bytes: number | null;
  status: number | null;
  retried401: boolean;
  streamOpenedAfterMs: number | null;
  /** stop → transcript: the number the ~2s target is about. */
  totalMs: number | null;
  flushMs: number | null;
  closeMs: number | null;
  waitMs: number | null;
  parseMs: number | null;
  vendorMs: number | null;
  /** waitMs − vendorMs; null when either is unknown or the result is negative. */
  netServerMs: number | null;
}

const between = (marks: Partial<Record<SttMark, number>>, from: SttMark, to: SttMark): number | null => {
  const a = marks[from];
  const b = marks[to];
  return a === undefined || b === undefined ? null : Math.round(b - a);
};

/** `vendor;dur=830` (possibly among other entries) → 830. */
export function parseServerTimingVendor(header: string | null | undefined): number | null {
  if (!header) return null;
  for (const entry of header.split(",")) {
    const [name, ...params] = entry.trim().split(";");
    if (name.trim() !== "vendor") continue;
    for (const p of params) {
      const m = /^\s*dur\s*=\s*"?(\d+(?:\.\d+)?)"?\s*$/.exec(p);
      if (m) return Math.round(Number(m[1]));
    }
  }
  return null;
}

export function summarizeSttTrace(
  marks: Partial<Record<SttMark, number>>,
  info: SttTraceInfo,
  outcome: SttOutcome,
  at: number = Date.now()
): SttTimingSummary {
  const waitMs = between(marks, "upload-closed", "response");
  const vendorMs = info.vendorMs ?? null;
  const net = waitMs !== null && vendorMs !== null ? waitMs - vendorMs : null;
  return {
    at,
    engine: info.engine,
    mode: info.mode ?? null,
    outcome,
    heldMs: info.heldMs === undefined ? null : Math.round(info.heldMs),
    bytes: info.bytes ?? null,
    status: info.status ?? null,
    retried401: !!info.retried401,
    streamOpenedAfterMs: info.streamOpenedAfterMs === undefined ? null : Math.round(info.streamOpenedAfterMs),
    totalMs: between(marks, "stop", "transcript"),
    flushMs: between(marks, "stop", "recorder-stopped"),
    closeMs: between(marks, "recorder-stopped", "upload-closed"),
    waitMs,
    parseMs: between(marks, "response", "transcript"),
    vendorMs,
    netServerMs: net !== null && net >= 0 ? net : null,
  };
}

const f = (label: string, v: number | null) => (v === null ? null : `${label}=${v}ms`);

/** One line, used for both the console and the on-screen strip. */
export function formatSttTimingLine(s: SttTimingSummary): string {
  return [
    `engine=${s.engine}`,
    s.mode ? `upload=${s.mode}` : null,
    `outcome=${s.outcome}`,
    f("total", s.totalMs),
    f("flush", s.flushMs),
    f("close", s.closeMs),
    f("wait", s.waitMs),
    f("vendor", s.vendorMs),
    f("net+srv", s.netServerMs),
    f("parse", s.parseMs),
    f("held", s.heldMs),
    s.bytes === null ? null : `bytes=${s.bytes}`,
    s.status === null ? null : `status=${s.status}`,
    s.retried401 ? "retried401" : null,
    f("streamOpen@", s.streamOpenedAfterMs),
  ]
    .filter(Boolean)
    .join(" ");
}

// ---- log ------------------------------------------------------------------------

const MAX_ENTRIES = 8;
let entries: readonly SttTimingSummary[] = [];
const listeners = new Set<() => void>();

/** Console for a laptop with devtools; the entries also feed the strip
 *  behind ?audiodebug=1 for a phone with none. Never throws. */
export function logSttTiming(summary: SttTimingSummary): void {
  try {
    console.log(`[stt-timing] ${formatSttTimingLine(summary)}`);
  } catch {
    /* a broken console must not reach the answer path */
  }
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), summary];
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      /* same */
    }
  }
}

export function getSttTimingLog(): readonly SttTimingSummary[] {
  return entries;
}

export function subscribeSttTimingLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only. */
export function __clearSttTimingLogForTests(): void {
  entries = [];
}

// ---- the per-press trace -------------------------------------------------------

export interface SttTrace {
  /** Stamp a mark now. Last write wins (a retried request's response replaces the first's). */
  mark(name: SttMark): void;
  /** Merge facts learned along the way. */
  info(patch: Partial<SttTraceInfo>): void;
  /** Close the trace and log it. Only the first call counts. */
  finish(outcome: SttOutcome): void;
}

export function createSttTrace(engine: SttEngine, now: () => number = () => performance.now()): SttTrace {
  const marks: Partial<Record<SttMark, number>> = {};
  const facts: SttTraceInfo = { engine };
  let finished = false;
  return {
    mark(name) {
      try {
        marks[name] = now();
      } catch {
        /* never reach the answer path */
      }
    },
    info(patch) {
      Object.assign(facts, patch);
    },
    finish(outcome) {
      if (finished) return;
      finished = true;
      try {
        logSttTiming(summarizeSttTrace(marks, facts, outcome));
      } catch {
        /* same */
      }
    },
  };
}
