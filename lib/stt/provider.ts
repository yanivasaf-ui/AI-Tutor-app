/**
 * Speech-to-text provider adapter (ROADMAP.md Phase 1A: "Provider-agnostic
 * adapter so the STT vendor is swappable").
 *
 * ============================================================
 * DECISION: staged STT -> LLM -> TTS, not realtime speech-to-speech.
 * ============================================================
 *
 * Considered a realtime/streaming bidirectional speech model (persistent
 * duplex session, sub-second turn-taking, ASR+reasoning+TTS in one model)
 * against the staged pipeline this app already has. Chose staged, for
 * four reasons in descending weight:
 *
 * 1. Realtime would mean rebuilding the tutor, not adding voice to it.
 *    The product's actual value lives in the staged path: RAG grounding
 *    against the Ministry curriculum index (lib/rag/), exercise
 *    generation with locked pedagogical subtypes (lib/exercises/
 *    generate.ts), answer evaluation with structured errorNote
 *    (lib/exercises/evaluate.ts), the per-kid memory layer
 *    (lib/memory/update.ts), and the locked hint-first/process-praise
 *    system prompt. In a realtime session every one of those has to be
 *    re-expressed as tool calls, and carefully-tuned text pedagogy
 *    becomes much less controllable voice-native behavior. That is a
 *    tutor rewrite wearing a Phase-1 voice-feature costume.
 *
 * 2. Infrastructure incompatibility, hard. Realtime needs a persistent
 *    duplex connection; Vercel serverless functions don't hold
 *    WebSockets. This app is pinned to the Hobby plan's 12-function cap
 *    with an explicit no-new-backend constraint. Realtime means standing
 *    up a separate always-on service: new deploy target, new cost, new
 *    ops surface, for a pre-revenue MVP.
 *
 * 3. Turn-based dialogue doesn't need it. "Character asks -> kid answers
 *    -> character responds" is a discrete exchange. Realtime's real
 *    advantage is interruption and overlap, which a 6-year-old answering
 *    a math question is not doing.
 *
 * 4. It would weld shut the exact axis the roadmap flags as riskiest.
 *    Hebrew child STT is the #1 technical risk per ROADMAP.md's own risk
 *    flag, and realtime models are weakest precisely on non-English +
 *    child speech. Locking into one realtime vendor means that when the
 *    WER spike comes back bad you cannot swap just the ASR — you abandon
 *    the whole path. Staged keeps the risky component isolated behind
 *    this interface.
 *
 * ============================================================
 * DECISION (2026-09-13): cloud recognition by default, browser as fallback.
 * ============================================================
 *
 * The first cut shipped the browser's SpeechRecognition as the default —
 * free, no upload, no extra serverless function. iPhone QA (2026-09-12)
 * found it unreliable for Hebrew child speech on iOS Safari, which is
 * exactly the swap this adapter was built for. Now:
 *
 * - cloudSpeechProvider (default): MediaRecorder captures the hold-to-talk
 *   press; on release the clip is uploaded to POST /api/stt, which
 *   transcribes it with OpenAI (lib/stt/openai.ts — model and why there).
 *   Returns a real confidence number, which the browser engine never did.
 * - browserSpeechProvider (fallback): unchanged, still here.
 * - autoSpeechProvider — what getSttProvider() hands out — picks per
 *   press: cloud unless the route has said it's unusable this session
 *   (401/503: not signed in, or no key configured — neither fixes itself
 *   mid-session), in which case browser from then on; after a transient
 *   cloud failure (5xx, network, timeout) or an empty transcript, the
 *   browser engine gets the kid's retry, then cloud resumes.
 *
 * Why fallback is "for the retry" and not "for this same utterance": the
 * browser recognizer listens to a live microphone — it can't be handed a
 * clip that's already been recorded. Rescuing the same utterance would
 * mean running both engines on the one microphone at once, and on iOS
 * Safari (two consumers of the same audio session) that's untested here
 * and could break the primary engine on precisely the platform this change
 * is for. So a cloud failure costs the kid one re-ask — the existing
 * "לא שמעתי טוב" line — and the retry goes through the other engine.
 *
 * Privacy, stated rather than buried: the cloud engine sends the kid's
 * recorded answer to OpenAI. The browser engine (Chrome) already streamed
 * captured audio to Google. Neither is a new category of exposure, but
 * it's a real fact a parent could reasonably ask about.
 */

export type SttProviderId = "browser" | "cloud" | "auto";

export interface SttSession {
  /** Stop capture. The provider resolves its onResult/onEnd callbacks. */
  stop(): void;
  /** Abandon the session: no upload, no callbacks. Used on unmount (kid
   *  taps back to the map mid-press). Falls back to stop() if absent. */
  cancel?(): void;
}

export interface SttStartOptions {
  /** Fired once with the final transcript. Not fired if nothing was heard. */
  onResult: (transcript: string) => void;
  /** Fired when the session ends for any reason (result, error, or stop). */
  onEnd: () => void;
  /** Why the session failed or came back empty. Browser recognizer codes
   *  pass through as-is ("not-allowed", "no-speech", "network", ...); the
   *  cloud engine reuses them where they mean the same thing and adds
   *  "cloud-unavailable" (route 401/503) and "cloud-failed" (anything
   *  else). */
  onError?: (reason: string) => void;
  /** Capture has stopped and the audio is being turned into text — for the
   *  cloud engine, the upload + transcription wait after release. */
  onCaptureEnd?: () => void;
}

export interface SttProvider {
  id: SttProviderId;
  /** False when this environment can't run the provider at all — callers
   *  must not render a mic affordance that would silently do nothing.
   *  Safe to call during render; must not throw; must NOT request
   *  microphone permission (that only ever happens inside start(), i.e.
   *  on the kid's first actual mic press). */
  isAvailable(): boolean;
  /** Begins capture. Must be called from inside a user-gesture handler. */
  start(opts: SttStartOptions): SttSession;
}

// ---- Browser engine ---------------------------------------------------------

// Minimal shape of the Web Speech API surface actually used here — not in
// lib.dom.d.ts by default.
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

type WindowWithSpeech = Window &
  typeof globalThis & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as WindowWithSpeech;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * The browser's built-in recognizer. Free, no upload, no serverless
 * function. `he-IL`, single utterance, final results only. Now the
 * fallback engine (see the decision above).
 */
export const browserSpeechProvider: SttProvider = {
  id: "browser",

  isAvailable() {
    return !!getRecognitionCtor();
  },

  start({ onResult, onEnd, onError, onCaptureEnd }) {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      onError?.("SpeechRecognition unavailable");
      onEnd();
      return { stop() {} };
    }

    const recognition = new Ctor();
    recognition.lang = "he-IL";
    recognition.interimResults = false;
    recognition.continuous = false;

    let ended = false;
    const endOnce = () => {
      if (ended) return;
      ended = true;
      onEnd();
    };

    recognition.onresult = (event: unknown) => {
      const e = event as { results: { 0: { transcript: string } }[] };
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) onResult(transcript);
    };
    recognition.onerror = (event: unknown) => {
      // SpeechRecognitionErrorEvent.error carries the real reason
      // ("not-allowed", "no-speech", "network", ...) — a UI needs it to
      // tell a blocked microphone apart from silence.
      const e = event as { error?: string };
      onError?.(e?.error ?? "recognition error");
      endOnce();
    };
    recognition.onend = endOnce;

    recognition.start();

    return {
      stop() {
        onCaptureEnd?.();
        recognition.stop();
      },
    };
  },
};

// ---- Cloud engine -------------------------------------------------------------

/** Hard stop, whether or not the kid has let go — matches /api/stt's upload
 *  cap (lib/stt/openai.ts). */
const CLOUD_MAX_MS = 15_000;
/** Shorter than this between capture start and release is a tap, not an
 *  answer: treated as nothing heard, never uploaded. */
const CLOUD_MIN_MS = 400;
/** A little longer than the route's own vendor timeout, so a slow vendor
 *  surfaces as the route's clean 502 rather than a client-side abort. This
 *  budget covers a 401 retry too (see transcribe() below) — a 401 never
 *  reaches OpenAI, so it and the retry pause cost well under a second,
 *  leaving the retried request nearly the full window for its own vendor
 *  call in the ordinary case. */
const UPLOAD_TIMEOUT_MS = 9_000;
/** 2026-09-13: the first authenticated /api/stt call right after a fresh
 *  sign-in was intermittently 401ing — a session-propagation race, not a
 *  real "not signed in" — which killed cloud STT for the rest of the
 *  session on nothing more than bad timing. Considered a warm-up ping
 *  right after login instead (an early, throwaway call to settle the
 *  race before the kid ever presses the mic) and rejected it: it needs a
 *  new authenticated round trip at a DIFFERENT moment than the real
 *  recording, so it can settle the race and still leave the actual mic
 *  press exposed to a fresh one, and it adds a call that runs for every
 *  device whether or not that device would ever have hit the race. A
 *  short delay-then-retry on the SAME failing request, right here, fixes
 *  the exact call that failed. */
const AUTH_RACE_RETRY_DELAY_MS = 400;

/**
 * Container preference, first supported wins. webm/opus is small and is
 * what Chrome (and recent Safari) record; iOS Safari before webm support
 * records mp4/AAC only — so mp4 is the fallback, never the first ask.
 * Both are containers OpenAI accepts; ogg (Firefox's other option) is not,
 * so it's deliberately not in the list.
 */
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];

export function pickRecordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return null;
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

// ---- Shared microphone stream (page-lifetime, not per-press) ---------------
//
// One getUserMedia() call for the whole page session — see the DECISION
// note in this file's header for why. Module-level (not component-level)
// deliberately: ExerciseScreen remounts per topic, so anything scoped to
// one component's lifetime would still re-acquire (and iOS would still
// re-prompt) on the very next exercise.

let sharedStream: MediaStream | null = null;
/** In-flight acquisition, so a second press that lands while the first
 *  getUserMedia() call is still pending (e.g. the kid taps again while
 *  the permission prompt from the first press is still up) reuses that
 *  SAME call instead of firing a second, possibly duplicate, prompt. */
let sharedStreamPromise: Promise<MediaStream> | null = null;

/** True if the currently-held stream is still actually usable. A track
 *  can end on its own — the device is revoked in Settings, unplugged,
 *  another app takes exclusive capture — leaving `sharedStream` non-null
 *  but dead; re-checking readyState here is what makes that case
 *  re-acquire instead of silently recording nothing. */
function sharedStreamIsLive(): boolean {
  return !!sharedStream && sharedStream.getAudioTracks().some((t) => t.readyState === "live");
}

async function getSharedMicStream(): Promise<MediaStream> {
  if (sharedStreamIsLive()) return sharedStream!;
  sharedStream = null;
  if (!sharedStreamPromise) {
    sharedStreamPromise = navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
      .then((s) => {
        sharedStream = s;
        sharedStreamPromise = null;
        return s;
      })
      .catch((err) => {
        sharedStreamPromise = null;
        throw err;
      });
  }
  return sharedStreamPromise;
}

/** Stops drawing from the stream between presses WITHOUT releasing the
 *  device/permission — re-acquiring via a fresh getUserMedia() call is
 *  exactly the re-prompt this whole mechanism exists to avoid. Safe to
 *  call even if nothing is held (e.g. permission was never granted). */
function parkSharedMicStream(): void {
  sharedStream?.getAudioTracks().forEach((t) => (t.enabled = false));
}

/** The one place tracks actually stop. Call when the kid leaves the
 *  voice-capable part of the app — signing out (app/page.tsx's logout())
 *  — or the page unloads (wired below). Never call this between presses;
 *  that reintroduces the re-prompt bug this file was changed to fix. */
export function releaseSharedMicStream(): void {
  sharedStream?.getTracks().forEach((t) => t.stop());
  sharedStream = null;
  sharedStreamPromise = null;
}

if (typeof window !== "undefined") {
  // Covers a real navigation away, closing the tab, and iOS backgrounding
  // the tab hard enough to terminate it — the one case "on logout" alone
  // wouldn't catch.
  window.addEventListener("pagehide", releaseSharedMicStream);
}

function captureErrorReason(err: unknown): string {
  const name = (err as { name?: string })?.name;
  // Same codes the browser recognizer uses, so ExerciseScreen's existing
  // "microphone blocked" branch (micBlocked) catches both engines.
  if (name === "NotAllowedError" || name === "SecurityError") return "not-allowed";
  return "audio-capture";
}

/**
 * MediaRecorder capture on the hold-to-talk press, uploaded on release to
 * POST /api/stt.
 *
 * iOS Safari specifics:
 * - Microphone permission is requested only on the kid's first real mic
 *   press — never on mount or render. On that very first press the
 *   permission prompt usually outlives the press itself; if the finger
 *   lifts before the stream is live, the press ends as "nothing heard"
 *   (the kid presses again, now with permission already granted).
 * - DECISION (2026-09-14): the microphone stream is now acquired ONCE and
 *   kept alive for the page's lifetime — see getSharedMicStream() below —
 *   instead of being released at the end of every press. Confirmed root
 *   cause of the prior behavior: releasing the stream's tracks after each
 *   recording made iOS Safari re-prompt for permission on every single
 *   getUserMedia() call after, not just once per session. Compounding it,
 *   ExerciseScreen remounts per topic (its `key` in KidHome.tsx), so even
 *   a stream kept alive only for one component's lifetime would still
 *   have re-prompted on the next exercise — the shared stream lives at
 *   module scope for exactly this reason, and survives every such
 *   remount. Tracks are only stopped on releaseSharedMicStream() (wired
 *   to `pagehide` and to sign-out — see app/page.tsx's logout()), never
 *   between presses.
 * - Tradeoff, stated rather than buried: while a getUserMedia() stream's
 *   tracks are live, iOS shows its own microphone-in-use indicator, and —
 *   per this file's own prior note — was observed routing audio playback
 *   to the earpiece at phone-call volume while a capture stream was open.
 *   Mitigation here: getSharedMicStream() disables (never stops) the
 *   tracks between presses, so the browser keeps holding the granted
 *   device/permission (no re-prompt) without continuously drawing audio
 *   from it, and re-enables them right before each new recording. Whether
 *   this fully avoids the earpiece-routing symptom is NOT verified on a
 *   physical iPhone from here — if it resurfaces, that disable/enable
 *   toggle is the next thing to check.
 * - The shared <audio> unlock (lib/speech/useSpeech.ts) runs on the
 *   page's first pointerdown in the capture phase — before this press's
 *   own handler — and is a muted 0.1s blip. Recording only begins once
 *   the stream is live, and useVoiceInput cancels any line the character
 *   is saying or about to say before calling start() (its audio would
 *   otherwise be recorded and transcribed as the kid's answer). So the
 *   two don't contend for the audio session on the same gesture. Not
 *   verified on a physical iPhone from here.
 */
export const cloudSpeechProvider: SttProvider = {
  id: "cloud",

  isAvailable() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!pickRecordingMimeType();
  },

  start({ onResult, onEnd, onError, onCaptureEnd }) {
    const mimeType = pickRecordingMimeType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      onError?.("audio-capture");
      onEnd();
      return { stop() {} };
    }

    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let capturedAt = 0;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;
    let stopRequested = false;
    let cancelled = false;
    let captureEnded = false;
    let finished = false;
    const chunks: Blob[] = [];
    const upload = new AbortController();

    const release = () => {
      clearTimeout(maxTimer);
      // Park, don't stop — see getSharedMicStream()'s header note. Stopping
      // these tracks is exactly what caused iOS to re-prompt for
      // permission on every subsequent recording.
      if (stream) parkSharedMicStream();
      stream = null;
    };
    const endCapture = () => {
      if (captureEnded) return;
      captureEnded = true;
      onCaptureEnd?.();
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      release();
      if (!cancelled) onEnd();
    };

    async function postAudio(blob: Blob): Promise<Response> {
      return fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
        signal: upload.signal,
      });
    }

    async function transcribe(blob: Blob) {
      const timeout = setTimeout(() => upload.abort(), UPLOAD_TIMEOUT_MS);
      try {
        let res = await postAudio(blob);
        if (res.status === 401 && !cancelled) {
          // A 401 on the FIRST call right after a fresh sign-in can be a
          // transient race — the server re-reads the Supabase session
          // (lib/supabase/server.ts's cookies()) fresh on every request,
          // and that read can lose the race against the just-set auth
          // cookie propagating, especially on a cold container. That's
          // not "this session can never use cloud" — the same request,
          // retried once after a short pause, lets the server re-read the
          // session and almost always succeeds. A 503 (no API key
          // configured) never gets this: that's a real misconfiguration,
          // not a race, and retrying cannot fix it — falls straight
          // through to cloud-unavailable below, unchanged.
          await new Promise((resolve) => setTimeout(resolve, AUTH_RACE_RETRY_DELAY_MS));
          if (cancelled) return;
          res = await postAudio(blob);
        }
        if (cancelled) return;
        if (res.status === 401 || res.status === 503) {
          onError?.("cloud-unavailable");
          return;
        }
        if (!res.ok) {
          onError?.("cloud-failed");
          return;
        }
        const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
        const text = typeof data?.text === "string" ? data.text.trim() : "";
        if (text) onResult(text);
        else onError?.("no-speech");
      } catch {
        if (!cancelled) onError?.("cloud-failed");
      } finally {
        clearTimeout(timeout);
        finish();
      }
    }

    getSharedMicStream()
      .then((s) => {
        if (cancelled || stopRequested) {
          // Released (or unmounted) before the microphone came up — most
          // often the permission prompt on the very first press. Park
          // rather than stop: this is the SHARED stream, other presses
          // will reuse it.
          parkSharedMicStream();
          if (!cancelled) {
            endCapture();
            finish();
          }
          return;
        }
        stream = s;
        // A prior press's release() disabled these; a fresh acquisition
        // (the very first press) already has them enabled by default —
        // this covers both.
        s.getAudioTracks().forEach((t) => (t.enabled = true));
        recorder = new MediaRecorder(s, { mimeType, audioBitsPerSecond: 32_000 });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          const heldMs = performance.now() - capturedAt;
          release();
          if (cancelled) return;
          const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType });
          if (heldMs < CLOUD_MIN_MS || blob.size < 1024) {
            finish(); // a tap, not an answer — nothing heard, nothing uploaded
            return;
          }
          void transcribe(blob);
        };
        recorder.start();
        capturedAt = performance.now();
        maxTimer = setTimeout(() => session.stop(), CLOUD_MAX_MS);
      })
      .catch((err) => {
        if (cancelled) return;
        onError?.(captureErrorReason(err));
        endCapture();
        finish();
      });

    const session: SttSession = {
      stop() {
        if (stopRequested) return;
        stopRequested = true;
        endCapture();
        // If the stream isn't live yet, the getUserMedia .then above sees
        // stopRequested and ends the session there.
        if (recorder && recorder.state !== "inactive") recorder.stop();
      },
      cancel() {
        cancelled = true;
        upload.abort();
        if (recorder && recorder.state !== "inactive") recorder.stop();
        release();
      },
    };
    return session;
  },
};

// ---- Engine choice ----------------------------------------------------------

/** The route said cloud can't work this session (401 not signed in, 503 no
 *  key). Neither fixes itself mid-session: browser engine from now on. */
let cloudOffForSession = false;
/** The last cloud press failed transiently or heard nothing: give the
 *  browser engine the kid's retry, then go back to cloud. */
let browserForNextPress = false;

/** Cloud first, browser as automatic fallback — see the decision above. */
export const autoSpeechProvider: SttProvider = {
  id: "auto",

  isAvailable() {
    return cloudSpeechProvider.isAvailable() || browserSpeechProvider.isAvailable();
  },

  start(opts) {
    const cloudUsable = !cloudOffForSession && cloudSpeechProvider.isAvailable();
    const browserUsable = browserSpeechProvider.isAvailable();
    const useBrowser = browserUsable && (!cloudUsable || browserForNextPress);
    browserForNextPress = false;

    if (useBrowser) return browserSpeechProvider.start(opts);
    if (!cloudUsable) {
      opts.onError?.("cloud-unavailable");
      opts.onEnd();
      return { stop() {} };
    }

    return cloudSpeechProvider.start({
      ...opts,
      onError: (reason) => {
        if (reason === "cloud-unavailable") cloudOffForSession = true;
        else if (reason === "cloud-failed" || reason === "no-speech") browserForNextPress = true;
        // "not-allowed" / "audio-capture" deliberately flip nothing: a
        // blocked or missing microphone blocks the browser engine too.
        opts.onError?.(reason);
      },
    });
  },
};

/**
 * Single place the active provider is chosen. Kept as a function (not a
 * const) so a future env-var / remote-config switch has an obvious home.
 */
export function getSttProvider(): SttProvider {
  return autoSpeechProvider;
}
