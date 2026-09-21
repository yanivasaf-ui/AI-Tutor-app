/**
 * The feedback constitution, enforced.
 *
 * A pedagogy rule that lives only in a prompt is followed until it isn't,
 * and a child hears the exception once and it is gone. These tests are
 * what make the rules real:
 *
 *  - the forbidden shapes are actually caught (including the near-misses
 *    a blocklist of exact strings would walk straight past);
 *  - every string this codebase can say to a child obeys them;
 *  - no feedback-producing source file contains a forbidden phrasing;
 *  - and the one path a MODEL writes is checked at runtime, so a rule the
 *    model ignores is replaced rather than spoken.
 *
 * Run: npx tsx tests/feedback-constitution.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";

import {
  FORBIDDEN,
  MODEL_RULES,
  MIC_BLOCKED,
  NOT_HEARD,
  OPENERS,
  REST_CORRECT,
  SESSION_COMPLETE,
  STRATEGY_PRAISE_EXAMPLE,
  TOPIC_COMPLETE,
  effortModeling,
  neutralInvitation,
  obeysConstitution,
  restExplanation,
  restHint,
  shouldModelEffort,
  topicSummary,
  violatesConstitution,
} from "../lib/feedback/constitution";
import { generateFeedbackProse, safeFeedback, safeFeedbackAfterOpener } from "../lib/exercises/evaluate";
import { getAnthropicClient } from "../lib/llm/anthropic";
import type { Exercise } from "../lib/exercises/types";

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
async function at(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}

// ------------------------------------------------------------ the rules
console.log("the forbidden shapes are caught");

const MUST_BLOCK: [string, string][] = [
  ["אתה חכם", "the brief's first example"],
  ["אתה גאון", "the brief's second example"],
  ["טעית שוב", "the brief's third example"],
  ["עוד פעם?", "the brief's fourth example"],
  ["כל הכבוד! את חכמה מאוד", "person praise with the pronoun for a girl"],
  ["את כל כך חכמה!", "person praise with an intensifier between"],
  ["אתה ממש גאון", "another intensifier"],
  ["איזה גאון אתה", "the pronoun dropped in front"],
  ["אתם גאונים", "plural"],
  ["וואו, טעית שוב הפעם", "mid-sentence"],
  ["נו, עוד פעם ?", "spaced before the question mark"],
];
for (const [line, why] of MUST_BLOCK) {
  t(`blocks: "${line}"  (${why})`, () => {
    const v = violatesConstitution(line);
    assert.ok(v, "this must never reach a child");
    assert.ok(v!.rule.length > 10, "a violation must say which rule it broke, in actionable words");
  });
}

console.log("\n...and ordinary, good feedback is NOT blocked");
const MUST_ALLOW: [string, string][] = [
  [STRATEGY_PRAISE_EXAMPLE, "the brief's required praise pattern"],
  ["כל הכבוד! זה בדיוק נכון.", "the existing correct line"],
  ["כמעט! בוא נסתכל ביחד. אפשר לנסות שוב, לאט ובשלבים.", "the required neutral invitation"],
  ["הדרך שבחרת עבדה יפה", "strategy praise"],
  ["ניסית וזה עבד!", "effort praise"],
  ["זה היה קשה גם לי.", "the character modelling effort"],
  ["אפשר לחבר קודם את העשרות.", "a hint"],
  ["התשובה הנכונה היא 57.", "the code-composed answer"],
  ["חכמת ההמונים היא נושא מעניין", "the adjective's root in an unrelated word"],
  ["עוד פעם אחת ונצא להפסקה", "'עוד פעם' without the exasperated question mark"],
];
for (const [line, why] of MUST_ALLOW) {
  t(`allows: "${line.slice(0, 44)}"  (${why})`, () => {
    const v = violatesConstitution(line);
    assert.equal(v, null, `wrongly blocked${v ? ` on ${JSON.stringify(v.match)}` : ""}`);
  });
}

t("the patterns are Hebrew-aware — \\b is ASCII-only and would make every rule inert", () => {
  for (const { pattern } of FORBIDDEN) {
    assert.ok(!pattern.source.includes("\\b"), `\\b never matches beside Hebrew: ${pattern.source}`);
  }
  // The canary: if boundaries regress to \b, this stops being blocked.
  assert.ok(violatesConstitution("אתה חכם"), "the simplest forbidden line must be caught");
});

// -------------------------------------------- every owned string obeys
console.log("\nevery string the character can say obeys its own constitution");

const OWNED: [string, string][] = [
  ["OPENERS.correct", OPENERS.correct],
  ["OPENERS.hint", OPENERS.hint],
  ["OPENERS.explain", OPENERS.explain],
  ["REST_CORRECT", REST_CORRECT],
  ["restHint(boy)", restHint("boy")],
  ["restHint(girl)", restHint("girl")],
  ["restHint(unknown)", restHint(null)],
  ["restExplanation", restExplanation("57")],
  ["neutralInvitation(boy)", neutralInvitation("boy")],
  ["neutralInvitation(girl)", neutralInvitation("girl")],
  ["neutralInvitation(unknown)", neutralInvitation(null)],
  ["effortModeling", effortModeling(null)],
  ["NOT_HEARD", NOT_HEARD],
  ["MIC_BLOCKED", MIC_BLOCKED],
  ["TOPIC_COMPLETE", TOPIC_COMPLETE],
  ["SESSION_COMPLETE", SESSION_COMPLETE],
  ["topicSummary", topicSummary({ attempted: 5, correct: 4, topicLabel: '"השעון"' })],
];
for (const [name, text] of OWNED) {
  t(`${name} obeys`, () => {
    const v = violatesConstitution(text);
    assert.equal(v, null, `${name} breaks the constitution${v ? `: ${v.rule}` : ""}`);
    assert.ok(text.trim().length > 0, `${name} is empty`);
  });
}

console.log("\nthe required patterns");

t("a wrong answer opens an invitation to look together, in the child's own gender", () => {
  assert.match(restHint("boy"), /בוא נסתכל ביחד/);
  assert.match(restHint("girl"), /בואי נסתכל ביחד/);
  assert.match(restHint(null), /בואו נסתכל ביחד/);
  assert.notEqual(restHint("boy"), restHint("girl"), "a girl must not be addressed in the masculine");
});

t("the wrong-answer opener names the near-miss rather than judging the child", () => {
  assert.equal(OPENERS.hint, "כמעט!");
  assert.ok(obeysConstitution(`${OPENERS.hint} ${restHint("boy")}`));
});

t("praise names the strategy: the model is given the pattern, and it is the same string the tests use", () => {
  assert.ok(MODEL_RULES.includes(STRATEGY_PRAISE_EXAMPLE), "the prompt and the tests must not drift apart");
  assert.match(MODEL_RULES, /לא את מי שהוא/, "the rule itself must be stated to the model");
});

t("the model is told the forbidden phrasings by name", () => {
  for (const s of ["טעית שוב", "עוד פעם?"]) {
    assert.ok(MODEL_RULES.includes(s), `the model is never told not to say "${s}"`);
  }
});

console.log("\nthe character models effort — occasionally, and only where it is true");

t("never on a correct answer, and never before the hint has been tried", () => {
  // "ex_2" is an id the rotation WOULD fire on, so these two assertions
  // are carried by the guards and not by the hash happening to say no.
  const firing = { exerciseId: "ex_2", secondAttempt: true, correct: false };
  assert.equal(shouldModelEffort(firing), true, "precondition: this id fires when the moment is right");
  assert.equal(shouldModelEffort({ ...firing, correct: true }), false, "never alongside a correct answer");
  assert.equal(shouldModelEffort({ ...firing, secondAttempt: false }), false, "never before the hint was tried");
});

t("occasional, not every time — and not vanishingly rare either", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `ex_${i}`);
  const fired = ids.filter((id) => shouldModelEffort({ exerciseId: id, secondAttempt: true, correct: false })).length;
  assert.ok(fired > 30, `fired ${fired}/300 — too rare to be a voice`);
  assert.ok(fired < 210, `fired ${fired}/300 — said this often it is a tic, not a confession`);
});

t("deterministic, not random — the same exercise behaves the same way every time", () => {
  // Randomness would pass a two-call check better than half the time, so
  // this asks many times, and asks it of an id in each rotation bucket.
  for (const exerciseId of ["ex_2", "ex_3", "ex_1", "c", "a", "b"]) {
    const answers = Array.from({ length: 40 }, () => shouldModelEffort({ exerciseId, secondAttempt: true, correct: false }));
    assert.equal(new Set(answers).size, 1, `${exerciseId} gave different answers across identical calls`);
  }
});

// ------------------------------- no forbidden phrasing in any source file
console.log("\nno feedback-producing file contains a forbidden phrasing");

/** Every file that can put words in the character's mouth about the
 *  child's work. The constitution itself is excluded and checked
 *  separately below: it has to name the forbidden shapes in order to
 *  forbid them. */
const FEEDBACK_SOURCES = [
  "lib/exercises/evaluate.ts",
  "lib/exercises/openers.ts",
  "lib/guide/lines.ts",
  "lib/guide/nudges.ts",
  "components/practice/ExerciseScreen.tsx",
  "lib/prompts/tutor-system-prompt.ts",
];
/** Only what can actually be SAID is scanned: string literals, not
 *  comments. A comment that quotes a forbidden line in order to explain
 *  why it is forbidden is doing its job; a string literal containing one
 *  is a line waiting to reach a child.
 *
 *  Written as a small scanner rather than a regex because a regex cannot
 *  tell a quote inside a comment from a real literal — and this file's own
 *  comments quote the forbidden lines on purpose. */
function stringLiteralsIn(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let buf = "";
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          buf += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        buf += src[i];
        i++;
      }
      i++;
      out.push(buf);
    } else {
      i++;
    }
  }
  return out;
}

for (const rel of FEEDBACK_SOURCES) {
  t(`${rel} is clean`, () => {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    for (const literal of stringLiteralsIn(src)) {
      const v = violatesConstitution(literal);
      assert.equal(v, null, v ? `${rel} contains a speakable ${JSON.stringify(v.match)} — ${v.rule}` : "");
    }
  });
}

t("the scanner reads string literals, not comments — and would catch a real one", () => {
  const planted = 'const line = "כל הכבוד! אתה חכם";';
  const found = stringLiteralsIn(planted).some((l) => violatesConstitution(l));
  assert.ok(found, "a forbidden line inside a string literal must be caught");
  assert.equal(stringLiteralsIn("// אתה חכם").length, 0, "a comment is not a speakable string");
});

t("the constitution names the forbidden shapes only to forbid them, never as something to say", () => {
  const src = readFileSync(new URL("../lib/feedback/constitution.ts", import.meta.url), "utf8");
  // Anything forbidden in this file must sit inside the FORBIDDEN table or
  // the rules handed to the model — never in an exported line.
  for (const [name, text] of OWNED) {
    assert.equal(violatesConstitution(text), null, `${name} must not contain a forbidden shape`);
  }
  assert.ok(src.includes("FORBIDDEN"), "sanity: this is the file that defines them");
});

// -------------------------------------------- the model path, at runtime
console.log("\nthe path a MODEL writes is checked before a child hears it");

const exercise: Exercise = {
  id: "ex_1", subject: "math", grade: "ב", type: "open", subtype: "fill_in_blank",
  topic: "חיבור", topicId: "math-b-arithmetic", question: "כמה זה 20 + 30?",
  correctAnswer: "50", difficulty: 2, computation: { operands: [20, 30], operators: ["+"] },
};
const verdict = {
  correct: true, verifiedAnswer: 50, codeGraded: true, secondAttempt: false,
  overridden: false, openerKind: "correct" as const,
};
function fakeModel(feedback: string) {
  const messages = getAnthropicClient().messages as unknown as { create: (r: unknown) => Promise<unknown> };
  messages.create = async () => ({ content: [{ type: "text", text: JSON.stringify({ feedback }) }] });
}
const quiet = console.warn;

await at("a model line that praises the child is replaced, not spoken", async () => {
  console.warn = () => {};
  fakeModel("את כל כך חכמה!");
  const out = await generateFeedbackProse(exercise, "50", verdict, { childGender: "girl" });
  console.warn = quiet;
  assert.equal(violatesConstitution(`${OPENERS.correct} ${out.feedback}`), null, "a forbidden line reached the child");
  assert.equal(out.feedback, REST_CORRECT, "falls back to the deterministic line");
});

await at("a model line that obeys is passed through untouched", async () => {
  fakeModel("ראיתי שחיברת קודם את העשרות.");
  const out = await generateFeedbackProse(exercise, "50", verdict, { childGender: "girl" });
  assert.equal(out.feedback, "ראיתי שחיברת קודם את העשרות.");
});

await at("the check sees the opener too — praise only breaks the rule once the opener is in front of it", async () => {
  console.warn = () => {};
  // Reads innocently alone; "כל הכבוד! ... את חכמה" is the violation.
  fakeModel("את חכמה מאוד");
  const out = await generateFeedbackProse(exercise, "50", verdict, { childGender: "girl" });
  console.warn = quiet;
  assert.equal(out.feedback, REST_CORRECT);
});

t("the child's gender reaches the deterministic hint — a girl is not addressed in the masculine", () => {
  const girl = safeFeedbackAfterOpener("", { verifiedAnswer: 50, correct: false, secondAttempt: false, childGender: "girl" });
  const boy = safeFeedbackAfterOpener("", { verifiedAnswer: 50, correct: false, secondAttempt: false, childGender: "boy" });
  const unknown = safeFeedbackAfterOpener("", { verifiedAnswer: 50, correct: false, secondAttempt: false });
  assert.match(girl, /בואי/, "a girl gets the feminine invitation");
  assert.match(boy, /בוא /, "a boy gets the masculine invitation");
  assert.match(unknown, /בואו/, "unknown gender gets the plural, per lines.ts's convention");
  assert.equal(new Set([girl, boy, unknown]).size, 3, "all three forms must differ");
});

t("the deterministic fallbacks obey the constitution on every branch", () => {
  const branches = [
    safeFeedback("", { verifiedAnswer: 50, correct: true, secondAttempt: false }),
    safeFeedback("", { verifiedAnswer: 50, correct: false, secondAttempt: false, childGender: "girl" }),
    safeFeedback("", { verifiedAnswer: 50, correct: false, secondAttempt: true }),
    safeFeedbackAfterOpener("", { verifiedAnswer: 50, correct: true, secondAttempt: false }),
    safeFeedbackAfterOpener("", { verifiedAnswer: 50, correct: false, secondAttempt: false, childGender: "boy" }),
    safeFeedbackAfterOpener("", { verifiedAnswer: 50, correct: false, secondAttempt: true }),
  ];
  for (const line of branches) {
    assert.equal(violatesConstitution(line), null, `deterministic line breaks the constitution: ${line}`);
    assert.ok(line.trim().length > 0);
  }
});

await at("the character's effort line reaches the child on the moments the constitution allows", async () => {
  const hard = { ...exercise, id: "ex_2" };
  const missed = { correct: false, verifiedAnswer: 50, codeGraded: true, secondAttempt: true, overridden: false, openerKind: "explain" as const };
  assert.equal(shouldModelEffort({ exerciseId: "ex_2", secondAttempt: true, correct: false }), true, "precondition");
  fakeModel("קודם מחברים את העשרות.");
  const out = await generateFeedbackProse(hard, "40", missed, { childGender: "boy" });
  assert.ok(out.feedback.includes(effortModeling("boy")), `effort line missing from: ${out.feedback}`);
  assert.equal(violatesConstitution(out.feedback), null);
});

await at("...and stays quiet on the moments it does not", async () => {
  const easy = { ...exercise, id: "ex_3" };
  const missed = { correct: false, verifiedAnswer: 50, codeGraded: true, secondAttempt: true, overridden: false, openerKind: "explain" as const };
  assert.equal(shouldModelEffort({ exerciseId: "ex_3", secondAttempt: true, correct: false }), false, "precondition");
  fakeModel("קודם מחברים את העשרות.");
  const out = await generateFeedbackProse(easy, "40", missed, { childGender: "boy" });
  assert.ok(!out.feedback.includes(effortModeling("boy")), "must not be said every time");
});

t("the arithmetic gate still owns truth: the constitution check is a separate pass and did not replace it", () => {
  const src = readFileSync(new URL("../lib/exercises/evaluate.ts", import.meta.url), "utf8");
  assert.match(src, /lineIsArithmeticallySafe/, "the arithmetic gate must still be there");
  assert.match(src, /violatesConstitution\(`\$\{opener\} \$\{feedback\}`\)/, "the constitution check runs on the accumulated line");
  const gate = src.slice(src.indexOf("export function safeFeedbackAfterOpener"), src.indexOf("export function specificPraiseSection"));
  assert.ok(!/violatesConstitution/.test(gate), "the constitution check must NOT be wired inside the arithmetic gate");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
process.exit(0);
