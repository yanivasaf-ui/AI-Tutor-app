/**
 * The question-quality gate (lib/authoring/quality-gate.ts): the
 * deterministic half of the authoring rubric, at admission (generate.ts),
 * at serving (store.ts), and in the route's last resort.
 *
 * Fixtures marked REAL are rows read from the production bank on
 * 2026-09-25 (verbatim). ACCEPTANCE (a) is the brief's own quote of
 * today's failing question; the full question was never persisted (no
 * exercise row was written after 2026-09-15), so the quoted fragment is
 * the fixture. CONSTRUCTED fixtures pin a rule the bank happens not to
 * exercise.
 *
 * Run: npx tsx tests/quality-gate.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.ANTHROPIC_API_KEY ||= "test-key-never-used";
import { checkQuestionQuality, numberSeries, qualityRetryHint, QualityGateError } from "../lib/authoring/quality-gate";
import { reviewMode, reviewQuestion } from "../lib/authoring/quality-review";
import { VETTED_TEMPLATES, vettedTemplate } from "../lib/authoring/vetted-templates";
import { findReusableExercise } from "../lib/exercises/store";
import { generateExercise } from "../lib/exercises/generate";
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

let n = 0;
function ex(p: Partial<Exercise> & { question: string }): Exercise {
  return {
    id: `q${++n}`,
    subject: "math",
    grade: "ג",
    type: "open",
    topic: "t",
    correctAnswer: "0",
    difficulty: 2,
    ...p,
  } as Exercise;
}
const grouping = (question: string, count: number, groups: number, emoji = "🍎", topicId = "math-g-multiplication-division") =>
  ex({
    question,
    type: "grouping",
    subtype: "visual_grouping",
    topicId,
    grouping: { items: Array(count).fill(emoji), groupCount: groups },
    correctAnswer: String(count / groups),
  });
const rules = (e: Exercise) => checkQuestionQuality(e).violations.map((v) => v.rule);
/** A number-pattern exercise as the generator builds it: tile_order with
 *  one slot and a handful of candidate numbers. */
const patternTiles = (items: string[]) => ({
  type: "tile_order" as const,
  subtype: "pattern_completion" as const,
  tiles: { items, slotCount: 1, joinWith: " " as const },
});

// ---------------------------------------------------------------- parser
console.log("series parser");
t("'3, 6, 9, 12' is a progression with step 3", () => {
  const [s] = numberSeries("יש לה: 3, 6, 9, 12");
  assert.deepEqual(s.terms, [3, 6, 9, 12]);
  assert.equal(s.step, 3);
});
t("'8,400' is one number, not a series", () => {
  assert.deepEqual(numberSeries("כמה זה 8,400 ÷ 100?"), []);
});
t("two numbers are not a series", () => assert.deepEqual(numberSeries("3, 6"), []));
t("a list with no common difference is a list (step null)", () => {
  assert.equal(numberSeries("3, 7, 2, 9")[0].step, null);
});
t("a trailing blank does not break the run", () => {
  assert.deepEqual(numberSeries("השלימו את הרצף: 3, 6, 9, 12, ___")[0].terms, [3, 6, 9, 12]);
});

// ---------------------------------------------------------------- acceptance (a)
console.log("\nacceptance (a): a growing series presented as a static count");
t("ACCEPTANCE 'הנה כמה צדפים יש לה: 3, 6, 9, 12' is rejected as a series told as a count", () => {
  assert.deepEqual(rules(ex({ question: "הנה כמה צדפים יש לה: 3, 6, 9, 12", ...patternTiles(["15", "14", "18", "12"]), correctAnswer: "15" })), ["no-series-as-count"]);
});
t("...and asking 'מה המספר הבא?' after it does not redeem it — it is still a count", () => {
  assert.deepEqual(rules(ex({ question: "הנה כמה צדפים יש לה: 3, 6, 9, 12. מה המספר הבא?" })), ["no-series-as-count"]);
});
t("CONSTRUCTED the same numbers anchored in time pass", () => {
  assert.deepEqual(rules(ex({ question: "נועה אוספת צדפים. ביום הראשון היו לה 3, ובכל יום היא מוסיפה 3: 3, 6, 9, 12. כמה צדפים יהיו לה ביום החמישי?", correctAnswer: "15" })), []);
});
t("REAL 'השלימו את הרצף: 3, 6, 9, 12, ___' passes (explicitly a pattern)", () => {
  assert.deepEqual(rules(ex({ question: "השלימו את הרצף: 3, 6, 9, 12, ___", ...patternTiles(["15", "14", "18", "12"]), correctAnswer: "15" })), []);
});
t("CONSTRUCTED a bare series with no frame at all is rejected as unanchored", () => {
  assert.deepEqual(rules(ex({ question: "5, 10, 15, 20. כמה יהיו?" })), ["sequence-anchored"]);
});
t("a pattern_completion whose answer does not continue the series is rejected", () => {
  assert.deepEqual(rules(ex({ question: "השלימו את הרצף: 3, 6, 9, 12, ___", ...patternTiles(["15", "14", "18", "12"]), correctAnswer: "14" })), ["unambiguous-answer"]);
});

// ---------------------------------------------------------------- acceptance (b)
console.log("\nacceptance (b): division without a sharing or grouping frame");
t("REAL bare 'כמה זה 60 ÷ 10?' is rejected", () => {
  assert.deepEqual(
    rules(ex({ question: "כמה זה 60 ÷ 10?", subtype: "fill_in_blank", computation: { operands: [60, 10], operators: ["/"] }, correctAnswer: "6" })),
    ["division-sharing-frame"]
  );
});
t("REAL bare equation '4,500 ÷ ___ = 45' is rejected", () => {
  assert.deepEqual(rules(ex({ question: "השלימו את המשוואה: 4,500 ÷ ___ = 45", subtype: "equation_balance", correctAnswer: "100" })), ["division-sharing-frame"]);
});
t("REAL sharing story with the equation ('...לחלק אותן שווה ל-6 חברות...') passes", () => {
  assert.deepEqual(
    rules(ex({ question: "לאורי יש 24 מדבקות. היא רוצה לחלק אותן שווה ל-6 חברות. כמה מדבקות תקבל כל חברה? 24 ÷ 6 = ___", subtype: "equation_balance", correctAnswer: "4" })),
    []
  );
});
t("REAL grouping 'חלקו את התפוחים ל-4 קבוצות שוות. כמה תפוחים יהיו בכל קבוצה?' passes", () => {
  assert.deepEqual(rules(grouping("חלקו את התפוחים ל-4 קבוצות שוות. כמה תפוחים יהיו בכל קבוצה?", 12, 4)), []);
});
t("CORPUS quotitive frame ('בקבוצות של 3. כמה קבוצות יש?') passes — both kinds of division", () => {
  assert.deepEqual(
    rules(ex({ question: "9 בקבוקי שוקו מסודרים בקבוצות של 3. כמה קבוצות יש?", computation: { operands: [9, 3], operators: ["/"] }, correctAnswer: "3" })),
    []
  );
});
t("a pick_operation whose answer is חילוק must carry the frame too", () => {
  const bare = ex({ question: "יש 12 ו-3. איזו פעולה?", type: "multiple_choice", subtype: "pick_operation", choices: ["חיבור", "חיסור", "כפל", "חילוק"], correctAnswer: "חילוק" });
  assert.deepEqual(rules(bare), ["division-sharing-frame"]);
});

// ---------------------------------------------------------------- consistency / answer
console.log("\ninternal consistency and an unambiguous answer");
t("REAL '180 כדורים ... ל-10 קופסאות' drawn as 20 balls is rejected", () => {
  const e = grouping("במפעל צעצועים ייצרו 180 כדורים צבעוניים. הם רוצים לארוז אותם ב-10 קופסאות שוות. כמה כדורים יהיו בכל קופסה? (חלקו את הכדורים למטה ל-10 קבוצות שוות)", 20, 10, "⚽");
  assert.ok(rules(e).includes("internal-consistency"), JSON.stringify(checkQuestionQuality(e).violations));
});
t("REAL a grouping that never asks how many per group is rejected", () => {
  const e = grouping("רונן מודד כמה דקות עברו בין שתי פעילויות. הוא סימן כל דקה בעיגול 🕐. חלקו את כל העיגולים ל-4 קבוצות שוות כדי לעזור לרונן לארגן את המדידות שלו.", 20, 4, "🕐", "math-g-time");
  assert.ok(rules(e).includes("unambiguous-answer"));
});
t("REAL stated total matches the drawn objects ('לרונית יש 15 פרחים ... ל-3 אגרטלים') passes", () => {
  assert.deepEqual(rules(grouping("לרונית יש 15 פרחים 🌸. היא רוצה לחלק אותם ל-3 אגרטלים באופן שווה. כמה פרחים יהיו בכל אגרטל?", 15, 3, "🌸")), []);
});
t("the group count written as a word counts as stated ('לשלושה ילדים')", () => {
  assert.deepEqual(rules(grouping("יש 12 תפוחים. חלקו אותם שווה בשווה לשלושה ילדים. כמה תפוחים יקבל כל ילד?", 12, 3)), []);
});
t("CONSTRUCTED mixed objects in one grouping are inconsistent", () => {
  const e = grouping("חלקו את התפוחים ל-2 קבוצות שוות. כמה תפוחים בכל קבוצה?", 4, 2);
  e.grouping!.items = ["🍎", "🍎", "🍐", "🍎"];
  assert.ok(rules(e).includes("internal-consistency"));
});
t("CONSTRUCTED two questions at once break one-task", () => {
  assert.deepEqual(rules(ex({ question: "לדן יש 5 כדורים. כמה כדורים יש לו? וכמה יהיו לו אם יקבל עוד 2?" })), ["one-task"]);
});
t("multiple choice: the answer must be on offer exactly once", () => {
  const base = { question: "איזו פעולה פותרת את הבעיה?", type: "multiple_choice" as const };
  assert.deepEqual(rules(ex({ ...base, choices: ["חיבור", "חיסור"], correctAnswer: "כפל" })), ["unambiguous-answer"]);
  assert.deepEqual(rules(ex({ ...base, choices: ["חיבור", "חיבור", "חיסור"], correctAnswer: "חיבור" })), ["unambiguous-answer", "unambiguous-answer"]);
  assert.deepEqual(rules(ex({ ...base, choices: ["חיבור", "חיסור"], correctAnswer: "חיבור" })), []);
});
t("niqqud does not hide a violation (checked on the letters)", () => {
  assert.deepEqual(rules(ex({ question: "הִנֵּה כַּמָּה צְדָפִים יֵשׁ לָהּ: 3, 6, 9, 12" })), ["no-series-as-count"]);
});
t("Hebrew exercises are not checked — and say so (checked: false)", () => {
  const r = checkQuestionQuality(ex({ subject: "hebrew", question: "יש לה: 3, 6, 9, 12" }));
  assert.deepEqual(r, { ok: true, checked: false, violations: [] });
});
t("the retry hint names each broken rule once, in the rubric's Hebrew", () => {
  const hint = qualityRetryHint([
    { rule: "no-series-as-count", detail: "a" },
    { rule: "no-series-as-count", detail: "b" },
  ]);
  assert.match(hint, /הקודם נדחה/);
  assert.equal(hint.split("לעולם לא להציג סדרה").length - 1, 1);
});

// ---------------------------------------------------------------- serving
console.log("\nserving: a rubric-violating bank row is never handed to a kid");
function row(e: Exercise) {
  return {
    id: e.id, subject: e.subject, grade: e.grade, type: e.type, subtype: e.subtype ?? null, topic: "t", topic_id: e.topicId ?? null,
    passage: null, question: e.question, choices: e.choices ?? null, number_line: null, tiles: e.tiles ?? null,
    grouping: e.grouping ?? null, correct_answer: e.correctAnswer, computation: e.computation ?? null, difficulty: 2,
  };
}
const client = (rows: ReturnType<typeof row>[]) => ({ rpc: async () => ({ data: rows, error: null }) }) as never;
const badRow = ex({ question: "כמה זה 60 ÷ 10?", subtype: "fill_in_blank", topicId: "math-g-multiplication-division", computation: { operands: [60, 10], operators: ["/"] }, correctAnswer: "6" });
const goodRow = grouping("חלקו את התפוחים ל-4 קבוצות שוות. כמה תפוחים יהיו בכל קבוצה?", 12, 4);

await at("with one violating and one good row, only the good row is served", async () => {
  for (let i = 0; i < 200; i++) {
    const got = await findReusableExercise(client([row(badRow), row(goodRow)]), "math", "ג", "kid", "math-g-multiplication-division", 2);
    assert.equal(got?.id, goodRow.id);
  }
});
await at("only violating rows → null, so the caller generates a gated one", async () => {
  assert.equal(await findReusableExercise(client([row(badRow)]), "math", "ג", "kid", "math-g-multiplication-division", 2), null);
});
await at("the topic-fit escape hatch does NOT lift the rubric", async () => {
  const got = await findReusableExercise(client([row(badRow)]), "math", "ג", "kid", "math-g-multiplication-division", 2, undefined, { ignoreTopicFit: true });
  assert.equal(got, null);
});

// ---------------------------------------------------------------- admission
console.log("\nadmission: generateExercise refuses a rubric-violating draft and asks again");
type Call = { messages: { content: string }[] };
function fakeModel(replies: (object | string)[]) {
  const calls: Call[] = [];
  const messages = getAnthropicClient().messages as unknown as { create: (req: Call) => Promise<unknown> };
  messages.create = async (req: Call) => {
    calls.push(req);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { content: [{ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) }] };
  };
  return calls;
}
const bareDiv = { type: "open", topic: "כפל וחילוק", question: "כמה זה 24 ÷ 6?", computation: { operands: [24, 6], operators: ["/"] }, correctAnswer: "4" };
const framedDiv = {
  type: "open",
  topic: "כפל וחילוק",
  question: "לאורי יש 24 מדבקות והיא מחלקת אותן שווה בשווה ל-6 חברות. כמה זה 24 ÷ 6?",
  computation: { operands: [24, 6], operators: ["/"] },
  correctAnswer: "4",
};
const gen = () =>
  generateExercise({ subject: "math", grade: "ג", profile: null, topicId: "math-g-multiplication-division", level: 2, forceSubtype: "fill_in_blank" });
const quiet = console.warn;
console.warn = () => {};

await at("a bare division draft is re-requested, and the retry names the division rule", async () => {
  const calls = fakeModel([bareDiv, framedDiv]);
  const out = await gen();
  assert.equal(out.question, framedDiv.question);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].messages[0].content.includes("חילוק תמיד מוצג כחלוקה שווה"), "the retry must carry the broken rule");
});
await at("if every draft violates the rubric it throws QualityGateError (nothing returned, nothing saved)", async () => {
  const calls = fakeModel([bareDiv]);
  await assert.rejects(gen(), (err: unknown) => err instanceof QualityGateError && err.violations[0].rule === "division-sharing-frame");
  assert.equal(calls.length, 3, "bounded by MAX_GENERATION_ATTEMPTS");
});
await at("review is OFF by default: a passing draft costs exactly one model call", async () => {
  delete process.env.QUESTION_REVIEW;
  const calls = fakeModel([framedDiv]);
  await gen();
  assert.equal(calls.length, 1);
});
await at("QUESTION_REVIEW=inline adds the review call, and a review rejection is retried like any gate failure", async () => {
  process.env.QUESTION_REVIEW = "inline";
  try {
    const reject = { pass: false, violations: [{ rule: "spoken-hebrew", detail: "too formal" }] };
    const calls = fakeModel([framedDiv, reject, framedDiv, { pass: true }]);
    const out = await gen();
    assert.equal(out.question, framedDiv.question);
    assert.equal(calls.length, 4, "draft, review(reject), draft, review(pass)");
    assert.ok(calls[2].messages[0].content.includes("עברית מדוברת"), "the retry names the rule the review broke");
  } finally {
    delete process.env.QUESTION_REVIEW;
  }
});

// ---------------------------------------------------------------- review
console.log("\nmodel review (off by default, fail-open)");
t("reviewMode is off unless QUESTION_REVIEW=inline", () => {
  delete process.env.QUESTION_REVIEW;
  assert.equal(reviewMode(), "off");
  process.env.QUESTION_REVIEW = "yes";
  assert.equal(reviewMode(), "off");
  process.env.QUESTION_REVIEW = "inline";
  assert.equal(reviewMode(), "inline");
  delete process.env.QUESTION_REVIEW;
});
await at("unparseable review output passes the draft (fail-open) and says nothing was checked", async () => {
  fakeModel(["not json"]);
  assert.deepEqual(await reviewQuestion(goodRow), { ok: true, checked: false, violations: [] });
});
await at("a rejection naming only unknown rules is not acted on", async () => {
  fakeModel([{ pass: false, violations: [{ rule: "made-up", detail: "x" }] }]);
  assert.equal((await reviewQuestion(goodRow)).ok, true);
});
await at("a rejection naming a real rule is returned as a violation", async () => {
  fakeModel([{ pass: false, violations: [{ rule: "concrete-scenario", detail: "abstract" }] }]);
  const r = await reviewQuestion(goodRow);
  assert.deepEqual(r.violations, [{ rule: "concrete-scenario", detail: "abstract" }]);
});
console.warn = quiet;

// ---------------------------------------------------------------- fallback
console.log("\nthe last resort: vetted templates");
t("every vetted template passes the same gate a generated draft must", () => {
  for (const tpl of VETTED_TEMPLATES) {
    const r = checkQuestionQuality({ id: "tpl", ...tpl.exercise });
    assert.ok(r.ok, `${tpl.exercise.question}: ${JSON.stringify(r.violations)}`);
    assert.equal(tpl.exercise.topicId, tpl.topicId);
  }
});
t("no topic, or a topic with no template → null", () => {
  assert.equal(vettedTemplate(undefined), null);
  assert.equal(vettedTemplate("no-such-topic"), null);
});
{
  const route = readFileSync(new URL("../app/api/tutor/route.ts", import.meta.url), "utf8");
  const block = route.slice(route.indexOf("} catch (genErr) {"), route.indexOf("const generateMs"));
  t("the route catches QualityGateError BEFORE the topic-fit safety net, and serves only a vetted template", () => {
    const q = block.indexOf("genErr instanceof QualityGateError");
    const f = block.indexOf("genErr instanceof TopicFitError");
    assert.ok(q > -1 && f > -1 && q < f);
    const qBlock = block.slice(q, f);
    assert.match(qBlock, /vettedTemplate\(topic\)/);
    assert.match(qBlock, /if \(!template\) throw genErr;/);
    assert.ok(!/ignoreTopicFit/.test(qBlock), "a rubric failure must never fall back to the unchecked bank");
    assert.match(qBlock, /source: "vetted-template"/);
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
