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
 * DECISION: browser SpeechRecognition as the default provider, for now.
 * ============================================================
 *
 * ROADMAP.md sketches MediaRecorder -> POST /api/stt -> cloud vendor. The
 * UI revamp already shipped browser SpeechRecognition in MicButton, and
 * the brief for this task says build on what exists. Shipping the browser
 * provider as the default because it is free, adds zero serverless
 * functions (the app is at 3 route files; /api/stt would add one more
 * against a 12-function cap), and has no upload round-trip so it is the
 * lowest-latency staged option.
 *
 * The roadmap's real requirement is not "use a cloud vendor" — it is
 * "make the vendor swappable so the WER spike can change the answer."
 * That is what this file delivers. When the spike says browser he-IL is
 * not good enough for 6-year-olds (a genuinely likely outcome), swapping
 * is one file, not a re-architecture.
 *
 * Two honest costs of this choice, stated rather than buried:
 *
 * - No usable confidence score. Chrome's he-IL recognizer reports
 *   `confidence` as 0/undefined in practice, so ROADMAP.md's
 *   confidence-gated "מה? לא שמעתי, אפשר שוב?" cannot be driven by a
 *   real confidence number on this provider. It is implemented on match
 *   failure instead (see lib/voice/matchAnswer.ts). True confidence
 *   gating arrives with a cloud provider.
 *
 * - Privacy: Chrome's implementation streams captured audio to Google's
 *   servers for recognition. For a children's product that is a real
 *   fact a parent could reasonably care about, not an implementation
 *   detail. It is one more reason the cloud-provider swap may end up
 *   being a policy decision rather than only a quality one.
 */

export type SttProviderId = "browser" | "cloud";

export interface SttSession {
  /** Stop capture. The provider resolves its onResult/onEnd callbacks. */
  stop(): void;
}

export interface SttStartOptions {
  /** Fired once with the final transcript. Not fired if nothing was heard. */
  onResult: (transcript: string) => void;
  /** Fired when the session ends for any reason (result, error, or stop). */
  onEnd: () => void;
  onError?: (reason: string) => void;
}

export interface SttProvider {
  id: SttProviderId;
  /** False when this environment can't run the provider at all — callers
   *  must not render a mic affordance that would silently do nothing.
   *  Safe to call during render; must not throw. */
  isAvailable(): boolean;
  /** Begins capture. Must be called from inside a user-gesture handler. */
  start(opts: SttStartOptions): SttSession;
}

// Minimal shape of the Web Speech API surface actually used here — not in
// lib.dom.d.ts by default. Moved from MicButton.tsx, unchanged in meaning.
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: unknown) => void) | null;
  onerror: (() => void) | null;
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
 * Default provider: the browser's built-in recognizer. Free, no upload,
 * no serverless function. `he-IL`, single utterance, final results only.
 */
export const browserSpeechProvider: SttProvider = {
  id: "browser",

  isAvailable() {
    return !!getRecognitionCtor();
  },

  start({ onResult, onEnd, onError }) {
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
    recognition.onerror = () => {
      onError?.("recognition error");
      endOnce();
    };
    recognition.onend = endOnce;

    recognition.start();

    return {
      stop() {
        recognition.stop();
      },
    };
  },
};

/**
 * Cloud provider seam — deliberately NOT implemented.
 *
 * This is the swap point the whole adapter exists for: when the Hebrew
 * child-speech WER spike (ROADMAP.md Phase 1A risk flag) says the browser
 * recognizer isn't good enough, implement this against a real vendor and
 * change getSttProvider()'s default. Doing so means:
 *
 *   1. Capture audio with MediaRecorder instead of SpeechRecognition
 *      (this provider's start() would own that).
 *   2. POST the resulting Blob to a new app/api/stt/route.ts — budget 1
 *      more route file against the 12-function Hobby cap.
 *   3. Return the vendor's transcript AND its confidence, which is what
 *      finally makes ROADMAP.md's confidence-gated re-ask path real
 *      rather than the match-failure approximation used today.
 *
 * It throws rather than silently degrading, so a mis-set default surfaces
 * immediately instead of producing a mic button that does nothing.
 */
export const cloudSpeechProvider: SttProvider = {
  id: "cloud",
  isAvailable() {
    return false;
  },
  start() {
    throw new Error(
      "cloudSpeechProvider is not implemented. See lib/stt/provider.ts — implement MediaRecorder capture + POST /api/stt before selecting this provider."
    );
  },
};

/**
 * Single place the active provider is chosen. Kept as a function (not a
 * const) so a future env-var / remote-config switch has an obvious home.
 */
export function getSttProvider(): SttProvider {
  return browserSpeechProvider;
}
