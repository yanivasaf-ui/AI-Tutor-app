/**
 * Cognitive-load pass: voice carries instruction, the screen holds math
 * objects, and nothing is delivered twice in two channels at once.
 *
 * The rule that matters most here is the grade split on answer options,
 * because it is the one with a hard spec: grades א-ב cannot read yet, so
 * options are read to them automatically; grade ג can, so options are
 * tap-to-hear and the automatic readout would be noise over a child who is
 * already reading.
 *
 * Run: npx tsx tests/cognitive-load.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const screen = readFileSync(new URL("../components/practice/ExerciseScreen.tsx", import.meta.url), "utf8");

console.log("answer options: read aloud for א-ב, tap-to-hear for ג+");

t("the automatic readout is gated to grades א and ב, and to options only", () => {
  const gate = /const autoRead = \(grade === "א" \|\| grade === "ב"\) && ex\.type === "multiple_choice" && !!ex\.choices\?\.length;/;
  assert.match(screen, gate, "the readout must be gated by grade AND by there being options to read");
});

t("...and it actually drives the readout, rather than being computed and ignored", () => {
  assert.match(
    screen,
    /speakAuto\(questionSpeech\(ex\), autoRead \? \{ onEnd: \(\) => readChoicesInOrder\(ex\.choices!, gen\) \} : undefined\)/,
    "options are read after the question, only when autoRead is true"
  );
});

t("grade ג gets a per-option tap-to-hear button instead", () => {
  assert.match(screen, /\{grade === "ג" && \(/, "the speaker button is grade-ג only");
  assert.match(screen, /aria-label=\{`הקראת התשובה \$\{choice\}`\}/, "and it is labelled per option");
  assert.match(screen, /speak\(choice, OWNER, character\)/, "tapping it reads that one option");
});

t("grade ג does NOT also get the automatic readout — that is the whole point of the split", () => {
  const autoReadLine = screen.split("\n").find((l) => l.includes("const autoRead ="))!;
  assert.ok(!autoReadLine.includes('"ג"'), "grade ג must not be in the auto-read set");
});

t("the readout reads options one at a time, in order, and stops if the question moves on", () => {
  const fn = screen.slice(screen.indexOf("function readChoicesInOrder"), screen.indexOf("function readChoicesInOrder") + 420);
  assert.match(fn, /gen/, "a stale readout must not talk over the next question");
  assert.match(fn, /onEnd: \(\) => readChoicesInOrder\(choices, gen, i \+ 1\)/, "one after another, not all at once");
});

console.log("\nthe hint screen: instruction is spoken, not also printed");

t("the rung's text is no longer rendered verbatim under the question", () => {
  assert.ok(!/\{hint\.say\}/.test(screen), "printing the spoken rung is the same instruction in two channels");
});

t("...and it is still spoken, with a replay for a child who missed it", () => {
  assert.match(screen, /speakAutoRef\.current\(rung\.say\)/, "the rung is still voiced");
  assert.match(screen, /onClick=\{\(\) => speak\(hint\.say, OWNER, character\)\}/, "and can be heard again on demand");
  assert.match(screen, /aria-label="לשמוע את הרמז שוב"/);
});

t("the one thing kept on screen is the math object: the small win's question", () => {
  // Rendered as visible text, not merely as the input's aria-label — a
  // label is read by a screen reader and seen by nobody.
  assert.match(
    screen,
    /<p[^>]*>\s*\{hint\.practice\.question\}\s*<\/p>/,
    "the question the child must answer has to be ON the screen, not just labelling a box"
  );
});

console.log("\nscreens deliberately left as they are");

t("the question is still both spoken and shown — removing either harms one group", () => {
  // A pre-reader needs the audio; a reader needs the text. The brief gives
  // a grade split for OPTIONS and none for the question, so this stays and
  // is reported rather than guessed at.
  assert.match(screen, /speakAuto\(questionSpeech\(ex\)/, "still spoken, for a child who cannot read it");
  assert.match(screen, /lines\.question\(kidName, exercise\.question\)/, "still shown, for a child who can");
});

t("the verdict line is still both spoken and shown, for the same reason", () => {
  assert.match(screen, /lines\.feedback\(kidName, evaluation\.feedback\)/);
  assert.match(screen, /speakAuto\(lines\.spoken\(lines\.feedback\(kidName, opener\)\)/);
});

t("the question reminder after feedback is kept — it is recall support, not duplication", () => {
  assert.match(screen, /showQuestionReminder/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
