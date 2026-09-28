/**
 * Kids-App UX Benchmark, build-first item 2: a gentle, wordless cue for a
 * wrong answer, and retiring the already-tried multiple-choice option on
 * the retry.
 *
 * Two things are unit-testable without a browser: the note DATA (shape,
 * softness) exported from lib/speech/cue.ts, and the mute decision (does
 * the wrong-cue's own source call isAutoSpeakOn()?). Actual audio playback
 * needs an AudioContext this Node harness doesn't have — same limitation
 * the pre-existing playHeardCue has always had, and for the same reason,
 * both no-op safely under `typeof window === "undefined"` rather than
 * throwing (checked below).
 *
 * The wiring into ExerciseScreen (verdict-gated, index-safe, voice-exempt,
 * reset-on-new-question, survives the retry) is a source tripwire, same
 * convention as tests/leave-confirm.test.mts and
 * tests/exercise-screen-wiring.test.mts.
 *
 * Run: npx tsx tests/wrong-answer-cue.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HEARD_CUE_NOTES,
  HEARD_CUE_PEAK_GAIN,
  WRONG_CUE_NOTES,
  WRONG_CUE_PEAK_GAIN,
  playHeardCue,
  playWrongCue,
} from "../lib/speech/cue";

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

console.log("the wrong-cue's own two notes: gentle, falling, never a buzzer");

t("both notes are within human hearing and in the same soft register as the heard-cue (no siren/alarm range)", () => {
  for (const note of WRONG_CUE_NOTES) {
    assert.ok(note.freq >= 200 && note.freq <= 1200, `freq ${note.freq}Hz is outside a calm speaking-adjacent range`);
    assert.ok(note.len > 0 && note.len <= 0.25, `note length ${note.len}s is too long for a short cue`);
  }
});

t("the pair falls (second note lower than the first) — the one interval every ear reads as 'not quite', never rising like the heard-cue", () => {
  assert.equal(WRONG_CUE_NOTES.length, 2, "exactly two notes, as specified");
  assert.ok(WRONG_CUE_NOTES[1].freq < WRONG_CUE_NOTES[0].freq, "the wrong-cue must fall, not rise");
  assert.ok(HEARD_CUE_NOTES[1].freq > HEARD_CUE_NOTES[0].freq, "regression guard: the heard-cue must still rise");
});

t("quieter than the heard-cue — 'gentle', never louder than the nudge it sits beside", () => {
  assert.ok(WRONG_CUE_PEAK_GAIN > 0, "must be audible");
  assert.ok(WRONG_CUE_PEAK_GAIN <= HEARD_CUE_PEAK_GAIN, `wrong-cue gain ${WRONG_CUE_PEAK_GAIN} must not exceed the heard-cue's ${HEARD_CUE_PEAK_GAIN}`);
  assert.ok(WRONG_CUE_PEAK_GAIN <= 0.1, "a peak gain this low cannot read as a buzzer or alarm");
});

t("the second note doesn't start before the first one finishes ramping down — no overlap that would read as a chord/dissonance", () => {
  const [a, b] = WRONG_CUE_NOTES;
  assert.ok(b.at >= a.len - 0.02, `note 2 starts at ${b.at}s but note 1 runs ${a.len}s — they would overlap`);
});

console.log("\nboth cues no-op safely with no window (this test harness, and any non-browser context)");

t("playHeardCue() and playWrongCue() return without throwing when there is no window/AudioContext", () => {
  assert.doesNotThrow(() => playHeardCue());
  assert.doesNotThrow(() => playWrongCue());
});

console.log("\nthe mute decision, made explicit and locked in (not assumed)");

const cueSrc = readFileSync(new URL("../lib/speech/cue.ts", import.meta.url), "utf8");

/** The text of a function starting at `startMarker`, through its matching
 *  closing brace — same helper as tests/exercise-screen-wiring.test.mts. */
function block(src: string, startMarker: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `could not find: ${startMarker}`);
  const open = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after: ${startMarker}`);
}

t("playHeardCue still checks isAutoSpeakOn() — it stands in for a spoken line, so it still honours mute (regression guard)", () => {
  const fn = block(cueSrc, "export function playHeardCue(");
  assert.match(fn, /if \(!isAutoSpeakOn\(\)\) return;/);
});

t("playWrongCue deliberately does NOT check isAutoSpeakOn() — the explicit decision: it follows the existing correct-answer chime's precedent (SFX, not voice), so a muted device still hears both right and wrong feedback", () => {
  const fn = block(cueSrc, "export function playWrongCue(");
  assert.ok(!/isAutoSpeakOn/.test(fn), "playWrongCue must not gate on the mute preference");
});

t("the existing correct-answer chime (lib/celebration/useCelebration.ts) is the precedent this decision follows: it doesn't check isAutoSpeakOn either", () => {
  const celebrationSrc = readFileSync(new URL("../lib/celebration/useCelebration.ts", import.meta.url), "utf8");
  assert.ok(!/isAutoSpeakOn/.test(celebrationSrc), "if this ever changes, the wrong-cue's mute decision above should be revisited too");
});

console.log("\nwiring into ExerciseScreen: verdict-gated, index-safe, voice-exempt");

const screenSrc = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");

t("playWrongCue() is imported from lib/speech/cue", () => {
  assert.match(screenSrc, /import \{ playWrongCue \} from "@\/lib\/speech\/cue";/);
});

t("playWrongCue() and the retirement are called ONLY inside the verdict's correct===false branch — never on the tap itself, never on an unchecked/network failure", () => {
  // Isolate the whole `if (msg.type === "verdict") { ... }` block so a
  // stray match anywhere else in this 1000+ line file can't satisfy this.
  const verdictBlock = block(screenSrc, 'if (msg.type === "verdict") {');
  const elseBranch = verdictBlock.slice(verdictBlock.indexOf("} else {\n              setBasePose(\"encouraging\");"));
  assert.match(elseBranch, /playWrongCue\(\);/, "playWrongCue must be called in the wrong-verdict branch");
  assert.match(elseBranch, /setWrongChoiceIndex\(opts\.choiceIndex\);/);
  // And it must NOT appear in the `checkWithRecovery`/"unchecked" catch path.
  // (indexOf for the closing marker must search FORWARD from the block's
  // own start, not from the top of this 1000+ line file — an earlier,
  // unrelated `} finally {` elsewhere would otherwise silently produce an
  // empty/negative slice and make this assertion vacuously true.)
  const uncheckedStart = screenSrc.indexOf('if (outcome === "unchecked") {');
  assert.ok(uncheckedStart >= 0, "could not find the unchecked-outcome branch");
  const uncheckedEnd = screenSrc.indexOf("} finally {", uncheckedStart);
  assert.ok(uncheckedEnd > uncheckedStart, "could not find this branch's own closing `} finally {`");
  const uncheckedBlock = screenSrc.slice(uncheckedStart, uncheckedEnd);
  assert.ok(uncheckedBlock.length > 20, "sanity: the extracted block must not be empty/tiny");
  assert.ok(!/playWrongCue/.test(uncheckedBlock), "an unchecked network error must never play the wrong-cue");
  assert.ok(!/setWrongChoiceIndex/.test(uncheckedBlock), "an unchecked network error must never retire a choice");
});

t("retirement is scoped to multiple_choice AND requires an explicit choiceIndex from the tap — never inferred from the answer's text", () => {
  const verdictBlock = block(screenSrc, 'if (msg.type === "verdict") {');
  assert.match(verdictBlock, /if \(exercise\.type === "multiple_choice" && opts\?\.choiceIndex !== undefined\) \{/);
  // No string-based lookup anywhere near this logic (indexOf/find on choices) — index-safety.
  const guardedBlock = verdictBlock.slice(verdictBlock.indexOf('if (exercise.type === "multiple_choice"'));
  assert.ok(!/choices\.indexOf|choices\.find/.test(guardedBlock), "the tapped index must be threaded through directly, never re-derived by matching the answer string (unsafe with repeated choice values)");
});

t("the multiple-choice button passes its own index at tap time, and disables/fades exactly that index on the retry — reusing the existing disabled:opacity-50 styling (no new copy)", () => {
  assert.match(screenSrc, /onClick=\{\(\) => submitAnswer\(choice, \{ choiceIndex: i \}\)\}/);
  assert.match(screenSrc, /disabled=\{submitting \|\| wrongChoiceIndex === i\}/);
  // The className carrying disabled:opacity-50 is untouched/still present.
  assert.match(screenSrc, /disabled:opacity-50/);
});

t("voice-driven submissions never carry a choiceIndex — matchChoice and the yes/no confirmation path are unchanged", () => {
  assert.match(screenSrc, /submitAnswer\(match\.value, \{ viaVoice: true \}\)/);
  assert.match(screenSrc, /submitAnswerRef\.current\(out\.value, \{ viaVoice: true \}\)/);
});

t("wrongChoiceIndex resets on every fresh question (loadNextExercise), alongside attempt/checkFailed — but the retry button does NOT reset it (it must survive into attempt 2)", () => {
  const loadNext = block(screenSrc, "async function loadNextExercise(");
  assert.match(loadNext, /setAttempt\(1\);\s*setCheckFailed\(false\);\s*setWrongChoiceIndex\(null\);/);

  // The retry ("לנסות שוב") button's own handler: setAttempt(2) + setEvaluation(null), no wrongChoiceIndex reset nearby.
  const retryButtonStart = screenSrc.indexOf('evaluation && !evaluation.correct && !finalMiss && (');
  const retryHandler = block(screenSrc.slice(retryButtonStart), "onClick={() => {");
  assert.match(retryHandler, /setAttempt\(2\);/);
  assert.ok(!/setWrongChoiceIndex/.test(retryHandler), "the retry button must not clear the retired choice — that is the one moment it needs to show");
});

t("wrongChoiceIndex state exists, initialised to null, and is documented", () => {
  assert.match(screenSrc, /const \[wrongChoiceIndex, setWrongChoiceIndex\] = useState<number \| null>\(null\);/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
