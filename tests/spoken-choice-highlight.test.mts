/**
 * Kids-App UX Benchmark, build-first item 3: highlight the multiple-choice
 * option currently being read aloud during the grades-א/ב automatic
 * readout (readChoicesInOrder / speakQuestionAndMaybeReadout).
 *
 * This is source-tripwire only — ExerciseScreen has no DOM harness in this
 * repo (same limitation as tests/exercise-screen-wiring.test.mts and
 * tests/leave-confirm.test.mts), and the highlight's correctness genuinely
 * depends on framer-motion + the live `speaking` reactive flag, which this
 * plain-tsx harness cannot exercise. The actual behaviour (highlight
 * appears/moves/clears correctly across completion, a new exercise, retry,
 * mute, and mic barge-in) was verified live in a local browser — see the
 * commit message.
 *
 * Run: npx tsx tests/spoken-choice-highlight.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");

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

/** The text of a function/block starting at `startMarker`, through its
 *  matching closing brace — same helper as the other ExerciseScreen tripwires. */
function block(startMarker: string): string {
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

console.log("state exists and is set at the moment a choice's speak() call starts");

t("speakingChoiceIndex state exists, initialised to null", () => {
  assert.match(src, /const \[speakingChoiceIndex, setSpeakingChoiceIndex\] = useState<number \| null>\(null\);/);
});

t("readChoicesInOrder sets it immediately before speak(choices[i], ...) — not before, not after", () => {
  const fn = block("function readChoicesInOrder(");
  const setIdx = fn.indexOf("setSpeakingChoiceIndex(i);");
  const speakCall = fn.indexOf("speak(choices[i], OWNER, character,");
  assert.ok(setIdx >= 0, "setSpeakingChoiceIndex(i) must be present");
  assert.ok(speakCall > setIdx, "the highlight must be set before that choice's own speak() call, not after");
  assert.ok(speakCall - setIdx < 120, "they must be adjacent — not set for a different choice than the one about to speak");
});

console.log("\nclearing relies on the reactive `speaking` flag, never on speak()'s onEnd (which does not fire on cancellation)");

t("a useEffect watches `speaking` and clears the highlight the instant it goes false — this is the ONLY place that clears it reactively", () => {
  assert.match(
    src,
    /useEffect\(\(\) => \{\s*if \(!speaking\) setSpeakingChoiceIndex\(null\);\s*\}, \[speaking\]\);/
  );
});

t("readChoicesInOrder's own onEnd does NOT itself clear speakingChoiceIndex — clearing is the speaking-effect's job alone, so it also covers cancellation (which never reaches onEnd)", () => {
  const fn = block("function readChoicesInOrder(");
  const onEndArrow = fn.slice(fn.indexOf("onEnd: () =>"));
  assert.ok(!/setSpeakingChoiceIndex/.test(onEndArrow), "onEnd should only chain to the next choice; clearing must not depend on onEnd firing");
});

t("this is deliberate, not an oversight: speak()'s onEnd contract (lib/speech/useSpeech.ts) only fires on genuine completion, never on a superseded/cancelled utterance", () => {
  const speechSrc = readFileSync(new URL("../lib/speech/useSpeech.ts", import.meta.url), "utf8");
  assert.match(speechSrc, /onEnd.*fires once this exact utterance genuinely\s*\n?\s*\*?\s*finishes \(not superseded\)/);
});

console.log("\nwhy `speaking` catches every case the brief lists (cancellation, new exercise, retry, mute, replacement speech)");

t("speak() ALWAYS flips `speaking` false before starting a new utterance — this is what makes a new exercise/retry/hint/nudge (all funnel through speak()) reliably clear a stale highlight", () => {
  const speechSrc = readFileSync(new URL("../lib/speech/useSpeech.ts", import.meta.url), "utf8");
  const speakFn = (() => {
    const start = speechSrc.indexOf("export function speak(");
    const open = speechSrc.indexOf("{", speechSrc.indexOf(")", start));
    let depth = 0;
    for (let i = open; i < speechSrc.length; i++) {
      if (speechSrc[i] === "{") depth++;
      else if (speechSrc[i] === "}" && --depth === 0) return speechSrc.slice(start, i + 1);
    }
    throw new Error("unbalanced");
  })();
  assert.match(speakFn, /stopPlayback\(\);/);
  assert.match(speakFn, /if \(state\.speaking\) emit\(\{ speaking: false, owner: null \}\);/);
});

t("muting calls the SAME stopSpeaking() that flips `speaking` false — lib/speech/autoSpeak.ts's setAutoSpeak(false)", () => {
  const autoSpeakSrc = readFileSync(new URL("../lib/speech/autoSpeak.ts", import.meta.url), "utf8");
  assert.match(autoSpeakSrc, /if \(!next\) stopSpeaking\(\);/);
});

console.log("\nreset on a fresh question (belt-and-suspenders alongside the reactive clear)");

t("loadNextExercise explicitly resets speakingChoiceIndex too, alongside wrongChoiceIndex/attempt/checkFailed", () => {
  const fn = block("async function loadNextExercise(");
  assert.match(fn, /setWrongChoiceIndex\(null\);\s*setSpeakingChoiceIndex\(null\);/);
});

console.log("\nthe render: highlight via framer-motion's own animate prop, not a Tailwind transform class");

t("uses motion.button's animate prop for the lift (y/scale) — never a Tailwind transform utility class on this element, which would fight whileTap for control of the transform property", () => {
  const choicesBlock = src.slice(src.indexOf('{!evaluation && exercise.type === "multiple_choice" && exercise.choices && ('), src.indexOf("{/* Voice-experience fix item 3: grade ג+"));
  assert.match(choicesBlock, /animate=\{\{ y: speakingChoiceIndex === i \? -2 : 0, scale: speakingChoiceIndex === i \? 1\.015 : 1 \}\}/);
  assert.ok(!/-translate-y-|scale-\[1\.0/.test(choicesBlock), "no Tailwind transform utility class should appear alongside whileTap on this element");
});

t("the glow (border/background/shadow) is a plain conditional className — no motion needed for it, so it is never suppressed under reduced motion", () => {
  const choicesBlock = src.slice(src.indexOf('{!evaluation && exercise.type === "multiple_choice" && exercise.choices && ('), src.indexOf("{/* Voice-experience fix item 3: grade ג+"));
  assert.match(choicesBlock, /speakingChoiceIndex === i\s*\?\s*"border-\[var\(--color-teal\)\] bg-\[var\(--color-teal-soft\)\] shadow-md"/);
});

t("reduced motion is inherited for free from the app-wide MotionConfig, not reimplemented here", () => {
  const motionRootSrc = readFileSync(new URL("../components/MotionRoot.tsx", import.meta.url), "utf8");
  assert.match(motionRootSrc, /<MotionConfig reducedMotion="user">/);
});

t("this is not a reward: no celebrate()/confetti/sound call anywhere near the highlight logic", () => {
  const readoutFn = block("function readChoicesInOrder(");
  assert.ok(!/celebrate\(|fireConfetti|playWrongCue|playHeardCue/.test(readoutFn));
});

t("grade ג's own tap-to-hear icon is untouched and unaffected — it never sets speakingChoiceIndex (the highlight is scoped to the automatic readout, which grade ג never runs)", () => {
  // The closing `{choice}` marker must be searched for STARTING FROM a
  // point AFTER this block's own 🔊 span, not from the block's own start —
  // the aria-label just inside this same block reads `הקראת התשובה
  // ${choice}`, a template interpolation whose literal text also contains
  // the substring "{choice}" and which appears BEFORE the real speak()
  // call and the real closing {choice}. Anchoring off the block's own
  // start alone would match that aria-label first, truncating the slice
  // before it ever reaches speak(choice, OWNER, character) — a vacuous
  // pass of the same shape caught by mutation-testing earlier in
  // tests/wrong-answer-cue.test.mts.
  const gimelStart = src.indexOf('{grade === "ג" && (');
  assert.ok(gimelStart >= 0, "could not find the grade-ג block");
  const emojiIdx = src.indexOf("🔊", gimelStart);
  assert.ok(emojiIdx > gimelStart, "could not find this block's own 🔊 icon");
  const gimelEnd = src.indexOf("{choice}", emojiIdx);
  assert.ok(gimelEnd > emojiIdx, "could not find this block's own closing {choice}, after the icon");
  const gimelBlock = src.slice(gimelStart, gimelEnd);
  assert.ok(gimelBlock.length > 20, "sanity: the extracted block must not be empty/tiny");
  assert.ok(!/setSpeakingChoiceIndex/.test(gimelBlock));
  assert.match(gimelBlock, /speak\(choice, OWNER, character\);/, "grade ג's manual per-choice speak call is unchanged");
});

t("submitting an answer is unaffected — the highlight logic never touches submitAnswer/choiceIndex (item 2's mechanism)", () => {
  const submitFn = block("async function submitAnswer(");
  assert.ok(!/setSpeakingChoiceIndex/.test(submitFn), "item 3 must not reach into item 2's verdict-gated logic");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
