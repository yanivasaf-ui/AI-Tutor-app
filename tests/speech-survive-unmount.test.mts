/**
 * FIX 1 (2026-09-14): tapping a topic label in free practice never spoke
 * it. Root cause: FreePractice's pickTopic() calls guide.say(label) then
 * onPick(t) synchronously; onPick unmounts FreePractice, and useGuide's
 * unmount cleanup (stopSpeaking(owner), lib/guide/useGuide.ts) cancelled
 * the just-issued utterance before it ever played — its own owner's
 * cleanup was still targeting the same, still-in-flight utterance.
 *
 * lib/speech/useSpeech.ts's speak()/stopSpeaking() now support
 * `surviveOwnerUnmount`: the ONE utterance an owner just marked this way
 * survives that owner's own next owner-scoped stopSpeaking() call, once.
 * These tests exercise the real speak()/stopSpeaking() functions (not a
 * reimplementation) via the Cartesia/fetch path, whose AbortController
 * gives a synchronous, DOM-free way to observe "was this utterance
 * actually cancelled" — no Audio/speechSynthesis stubbing required, since
 * cancellation happens (or doesn't) before either is ever reached.
 *
 * Run: npm test -- tests/speech-survive-unmount.test.mts (or npm run test:all)
 */
import assert from "node:assert/strict";

// Minimal browser stub — just enough for useSpeech.ts's module-load guard
// (`if (typeof window !== "undefined") window.addEventListener(...)`) and
// its speakCloud() path (`character && state.cloud && typeof window !==
// "undefined"`) to engage. No Audio/speechSynthesis: this suite never lets
// a fetch settle, so playback code is never reached.
(globalThis as unknown as { window: { addEventListener: () => void } }).window = { addEventListener: () => {} };

const fetchCalls: { signal: AbortSignal }[] = [];
(globalThis as unknown as { fetch: typeof fetch }).fetch = ((_url: string, opts: { signal: AbortSignal }) => {
  fetchCalls.push({ signal: opts.signal });
  // Never settles on its own — only abort() (real or absent) determines
  // the observable outcome each test checks, synchronously.
  return new Promise(() => {});
}) as typeof fetch;

const { speak, stopSpeaking } = await import("../lib/speech/useSpeech");

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

console.log("an owner's own unmount cleanup must not cancel a line it just protected");
t("surviveOwnerUnmount: the owner's own stopSpeaking(owner) right after does NOT abort it", () => {
  speak("שם הנושא", "free", "milo" as never, { surviveOwnerUnmount: true });
  const call = fetchCalls.at(-1)!;
  stopSpeaking("free"); // the unmount cleanup FreePractice's onPick triggers
  assert.equal(call.signal.aborted, false, "the protected utterance's fetch was aborted by its own owner's unmount");
});

console.log("\nan ordinary (unprotected) line is unaffected — the general unmount-silences-its-own-line behavior still works");
t("without surviveOwnerUnmount, the owner's own stopSpeaking(owner) still aborts it", () => {
  speak("שאלה רגילה", "free", "milo" as never);
  const call = fetchCalls.at(-1)!;
  stopSpeaking("free");
  assert.equal(call.signal.aborted, true, "an ordinary line survived its own owner's unmount stop — should have been cancelled");
});

console.log("\nprotection is consumed once, not sticky");
t("a second line from the same owner, after a protected one, is cancelled normally", () => {
  speak("שם נושא ראשון", "free", "milo" as never, { surviveOwnerUnmount: true });
  stopSpeaking("free"); // consumes the protection (case 1, re-verified implicitly)
  speak("שם נושא שני", "free", "milo" as never); // ordinary line, same owner
  const call = fetchCalls.at(-1)!;
  stopSpeaking("free");
  assert.equal(call.signal.aborted, true, "protection leaked into a later, unrelated utterance from the same owner");
});

console.log("\na genuine mute (ownerless stop) always wins, protected or not");
t("stopSpeaking() with no owner cancels a protected utterance too", () => {
  speak("שם נושא", "free", "milo" as never, { surviveOwnerUnmount: true });
  const call = fetchCalls.at(-1)!;
  stopSpeaking(); // the mute toggle's call — no owner argument
  assert.equal(call.signal.aborted, true, "a global stop must always cancel speech, even a protected utterance");
});

console.log("\na DIFFERENT owner's stop never touches another owner's protected line");
t("stopSpeaking('exercise') does nothing to a 'free'-owned protected utterance", () => {
  speak("שם נושא", "free", "milo" as never, { surviveOwnerUnmount: true });
  const call = fetchCalls.at(-1)!;
  stopSpeaking("exercise"); // a different screen's own unmount cleanup
  assert.equal(call.signal.aborted, false, "an unrelated owner's stop cancelled another owner's speech");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length > 0 ? 1 : 0);
