import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { tokenize } from "@/lib/voice/matchAnswer";
import { Computation, computeAnswer, falseClaimsIn, formatAnswer, lineIsArithmeticallySafe, wrongMathTermsIn } from "./arithmetic";
import { Exercise, ExerciseEvaluation } from "./types";
import type { KidGender } from "@/lib/memory/types";

/** Voice-experience fix item 4 (2026-09-15): the feedback prompt below was
 *  written to dodge the child's gender entirely ("לא בלשון זכר ולא בלשון
 *  נקבה — התלמיד/ה לא ידוע/ה") because it genuinely wasn't known. Now that
 *  a kid's gender is collected in onboarding, address them directly when
 *  it's known; fall back to the old neutral instruction otherwise (a kid
 *  from before this field existed). */
function genderInstruction(childGender: KidGender | null | undefined): string {
  return childGender === "boy"
    ? "התלמיד הוא ילד — פנה/י אליו בלשון זכר יחיד (אתה, ניסית, מצאת), לא בלשון רבים או נקבה."
    : childGender === "girl"
      ? "התלמידה היא ילדה — פני/פנה אליה בלשון נקבה יחיד (את, ניסית, מצאת), לא בלשון רבים או זכר."
      : "פנה/י בלשון רבים או סתמית, לא בלשון זכר ולא בלשון נקבה — התלמיד/ה לא ידוע/ה.";
}

/**
 * Judges a kid's answer. Feedback follows the same locked pedagogy as free
 * chat (lib/prompts/tutor-system-prompt.ts): process praise if right,
 * validate-then-hint (never just reveal the answer) if wrong.
 *
 * `secondAttempt` (adaptive levels): the kid already got the hint for this
 * question and tried again. Still wrong means the hint didn't land, so the
 * feedback becomes the full explanation — the method and the answer —
 * before the screen moves on to an easier exercise. Hint first, always;
 * the explanation only on the second miss.
 *
 * ARITHMETIC IS NOT THE MODEL'S JOB (2026-09-14, production bug: the
 * character said 10×4 was 14). When the exercise carries a structured
 * computation (lib/exercises/arithmetic.ts):
 *   - correctness is decided in CODE by comparing numbers, not by the model;
 *   - the model writes warmth and a hint, and is told not to state the
 *     result — the "התשובה הנכונה היא N" sentence is composed in code from
 *     the verified number;
 *   - whatever the model does return is run through lineIsArithmeticallySafe()
 *     before a child can hear it, and is thrown away for a deterministic
 *     line if it asserts arithmetic that isn't true.
 * The claim check runs on EVERY exercise, computation or not, so a reused
 * bank exercise or a rubric-style question can't slip a false sum through
 * either.
 */

/** Neutral, code-built lines — no model involved, nothing to get wrong.
 *  Gender-neutral per the rules in lib/guide/lines.ts. */
const SAFE_CORRECT = "כל הכבוד! זה בדיוק נכון.";
const SAFE_HINT = "זה בסדר, זה קורה! אפשר לנסות שוב, לאט ובשלבים.";
const safeExplanation = (answer: number) => `זה בסדר, זו שאלה לא פשוטה! התשובה הנכונה היא ${formatAnswer(answer)}.`;

/**
 * Did the kid land on the verified number? Runs over matchAnswer's
 * tokenizer, so a typed "40" and a spoken "ארבעים" are the same answer.
 * A restated answer ("20 ועוד 30 זה 50") is judged by the number it ends on.
 */
export function numericAnswerMatches(kidAnswer: string, answer: number): boolean {
  const numbers = tokenize(kidAnswer)
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
  if (numbers.length === 0) return false;
  if (numbers.length === 1) return numbers[0] === answer;
  const distinct = new Set(numbers);
  return numbers[numbers.length - 1] === answer || (distinct.size === 1 && distinct.has(answer));
}

/**
 * FIX 4 (2026-09-14, production bug): a kid answered an explain_thinking
 * story exercise with a bare wrong number ("45 ממתקים", answer 20) and the
 * feedback came back "התשובה 20 היא נכונה, אבל השאלה ביקשה להסביר" — the
 * child heard the RIGHT number affirmed, never told THEIRS was wrong. This
 * subtype has no single fixed answer by design (correctAnswer is a rubric
 * describing what a good explanation looks like, not a target — see
 * lib/exercises/types.ts), so the model alone decides `correct`; nothing
 * in code was checking its verdict against a number at all.
 *
 * True only when there's something solid to contradict: the kid's whole
 * answer is a single bare number (so this never second-guesses real
 * reasoning, which is the actual point of this subtype), the rubric names
 * exactly one number worth trusting as the implied target (its last
 * number — the same "final number is the answer" reading
 * numericAnswerMatches uses for a restatement), and the two disagree.
 * Whenever the rubric describes reasoning with no number at all, or the
 * kid wrote more than a bare number, this stays false and the model's own
 * judgment is left alone — the rule this enforces is asymmetric on
 * purpose: "a wrong numeric answer is wrong, with or without an
 * explanation," not "a bare number is graded like a computation exercise."
 */
export function isWrongBareNumberAgainstRubric(kidAnswer: string, rubricCorrectAnswer: string): boolean {
  const kidNumbers = tokenize(kidAnswer)
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
  if (kidNumbers.length !== 1) return false;
  const rubricNumbers = tokenize(rubricCorrectAnswer)
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
  if (rubricNumbers.length === 0) return false;
  const impliedAnswer = rubricNumbers[rubricNumbers.length - 1];
  return kidNumbers[0] !== impliedAnswer;
}

/**
 * The last gate before the character speaks. Returns the model's line when
 * it is arithmetically clean, and a deterministic line when it is not.
 */
export function safeFeedback(
  modelText: string,
  opts: { verifiedAnswer: number | null; correct: boolean; secondAttempt: boolean; computation?: Computation | null }
): string {
  const { verifiedAnswer, correct, secondAttempt, computation } = opts;
  const text = modelText.trim();
  if (text && lineIsArithmeticallySafe(text, verifiedAnswer, computation)) return text;
  // Worth knowing about: either the model asserted arithmetic that isn't
  // true, misused a place-value word, or returned nothing usable. Never
  // logged with the kid's own answer attached.
  if (text) {
    console.warn(
      `[exercise-evaluate] replaced an unsafe feedback line (verifiedAnswer=${verifiedAnswer}): ${JSON.stringify(text)} claims=${JSON.stringify(falseClaimsIn(text))} badTerms=${JSON.stringify(wrongMathTermsIn(text, computation))}`
    );
  } else {
    console.warn("[exercise-evaluate] model returned empty feedback; using a deterministic line");
  }
  if (correct) return SAFE_CORRECT;
  if (secondAttempt && verifiedAnswer !== null) return safeExplanation(verifiedAnswer);
  return SAFE_HINT;
}

export async function evaluateExerciseAnswer(
  exercise: Exercise,
  kidAnswer: string,
  opts?: { secondAttempt?: boolean; childGender?: KidGender | null }
): Promise<ExerciseEvaluation> {
  const secondAttempt = opts?.secondAttempt === true;
  const childGender = opts?.childGender ?? null;
  const anthropic = getAnthropicClient();

  // The one number this app is allowed to call "the answer" for a
  // computation exercise — derived from the operands, in code.
  const verifiedAnswer = exercise.computation ? computeAnswer(exercise.computation) : null;
  const codeGraded = verifiedAnswer !== null;
  const correctByCode = codeGraded && numericAnswerMatches(kidAnswer, verifiedAnswer);

  // "explain_thinking" has no single right answer — correctAnswer holds a
  // description of what a good explanation looks like, not a literal
  // target. Judging it like every other subtype (fuzzy match against a
  // fixed answer) would mark a valid-but-different explanation wrong.
  // pattern_completion/word_build/sentence_order/equation_balance/shape_match
  // are all tile-arrangement tasks (see lib/exercises/types.ts TileOrderData)
  // — the kid's placed tiles get serialized into one string by PracticeMode,
  // same shape as correctAnswer. Unlike the fuzzy math/explanation judging
  // below, exact match is the actual thing being tested here, so "close but
  // scrambled/wrong tile" must not pass.
  const isTileOrderSubtype =
    exercise.subtype === "pattern_completion" ||
    exercise.subtype === "word_build" ||
    exercise.subtype === "sentence_order" ||
    exercise.subtype === "equation_balance" ||
    exercise.subtype === "shape_match";
  /** correctAnswer describes what a good answer looks like — there is no
   *  single value to reveal, so the second miss must not demand one. */
  const isRubric = exercise.subtype === "explain_thinking";

  const judgingInstruction = codeGraded
    ? `התשובה כבר נבדקה על ידי המערכת — התלמיד/ה ${correctByCode ? "ענה/תה נכון" : "ענה/תה לא נכון"}. אל תשפוט/י מחדש ואל תחשב/י את התרגיל בעצמך: תפקידך לנסח את המשוב בלבד, בהתאם לקביעה הזו.`
    : exercise.subtype === "explain_thinking"
      ? `אין כאן תשובה נכונה יחידה. "${exercise.correctAnswer}" הוא תיאור של מה מאפיין הסבר טוב, לא תשובה מדויקת לחפש. שפוט/י אם ההסבר של התלמיד/ה מציג חשיבה הגיונית ותקפה על הבעיה — גם אם הדרך שונה מהמתואר.`
      : isTileOrderSubtype
        ? `זהו תרגיל של סידור אבנים/אריחים לפי סדר/ערך נכון. קבל/י כתשובה נכונה רק אם התשובה תואמת בדיוק את "${exercise.correctAnswer}" (מותר להתעלם מהבדלי רווחים), לא סידור "קרוב" או חלקית נכון.`
        : exercise.subtype === "visual_grouping"
          ? `התלמיד/ה חילק/ה חפצים לקבוצות. התשובה שהתלמיד/ה נתן/ה מכילה את מספר הפריטים בכל אחת מהקבוצות שיצר/ה, מופרדים בפסיקים. התשובה הנכונה, "${exercise.correctAnswer}", היא מספר הפריטים שאמור להיות בכל קבוצה. קבל/י כתשובה נכונה רק אם כל המספרים בתשובת התלמיד/ה שווים בדיוק למספר הזה — אם קבוצה כלשהי גדולה או קטנה ממנו, זו תשובה שגויה.`
          : `שפוט/י אם התשובה נכונה — קבל/י ניסוחים שונים או תשובות חלקיות-אך-נכונות מבחינה מהותית, לא רק התאמה מילולית מדויקת.`;

  // On a computation exercise the model never writes the result: code owns
  // that sentence and appends it after the model's words.
  const wrongBranch = secondAttempt
    ? isRubric
      ? `- אם לא נכון: זה כבר הניסיון השני של התלמיד/ה בשאלה הזאת. אין לשאלה הזאת תשובה נכונה יחידה, אז אל תמציא/י "תשובה נכונה" אחת. במקום זה, עד שלושה משפטים קצרים: (1) תיקוף רגשי קצר, (2) הסבר מה מאפיין הסבר טוב לשאלה הזאת, (3) דוגמה קצרה לדרך חשיבה אפשרית. ${genderInstruction(childGender)}`
      : codeGraded
        ? `- אם לא נכון: זה כבר הניסיון השני של התלמיד/ה בשאלה הזאת — רמז כבר ניתן ולא עזר, אז עכשיו מסבירים את הדרך. עד שני משפטים קצרים: (1) תיקוף רגשי קצר ("זה בסדר, זו שאלה לא פשוטה"), (2) הדרך לפתרון, צעד אחר צעד, במילים של ילד/ה. קריטי: אל תכתוב/י את התוצאה הסופית ואל תסיים/י במשפט שמכריז מה התשובה — המערכת מוסיפה את התשובה הנכונה בעצמה מיד אחרי המשפטים שלך. אפשר לנסח את דרך הפתרון עצמה בלשון רבים ("מחברים", "בואו נספור") — אבל כל פנייה ישירה לתלמיד/ה עצמו/ה: ${genderInstruction(childGender)}`
        : `- אם לא נכון: זה כבר הניסיון השני של התלמיד/ה בשאלה הזאת — רמז כבר ניתן ולא עזר, אז עכשיו מסבירים עד הסוף. עד שלושה משפטים קצרים: (1) תיקוף רגשי קצר ("זה בסדר, זו שאלה לא פשוטה"), (2) הדרך לפתרון, צעד אחר צעד, במילים של ילד/ה, (3) התשובה הנכונה, במפורש. בלי שאלה בסוף. אפשר לנסח את דרך הפתרון עצמה בלשון רבים ("מחברים", "בואו נספור") — אבל כל פנייה ישירה לתלמיד/ה עצמו/ה: ${genderInstruction(childGender)}
  דוגמה לאורך הנכון בדיוק: "זה בסדר, זו שאלה לא פשוטה! קודם מחברים את העשרות: 20 ועוד 30 זה 50, ואז את היחידות: 4 ועוד 3 זה 7. אז התשובה היא 57."`
    : `- אם לא נכון: עד שני חלקים קצרים בלבד, כל חלק עד כ-8 מילים — (1) תיקוף רגשי קצר ("זה בסדר, זה קורה") ואז (2) רמז אחד קצר שמכוון לכיוון הנכון, בלי לגלות את התשובה. בלי משפט שלישי. אפשר לנסח את הרמז עצמו בלשון רבים ("אפשר ל...", "בואו נ...") — אבל כל פנייה ישירה לתלמיד/ה עצמו/ה: ${genderInstruction(childGender)}
  דוגמה לאורך הנכון בדיוק: "זה בסדר, זה קורה! אפשר לחבר קודם את העשרות."`;

  const prompt = `שאלה שנשאלה לתלמיד/ה: "${exercise.question}"
${exercise.passage ? `קטע קריאה: "${exercise.passage}"` : ""}
${exercise.choices ? `אפשרויות: ${exercise.choices.join(" | ")}` : ""}
${codeGraded ? "" : `התשובה הנכונה: "${exercise.correctAnswer}"`}
התשובה שהתלמיד/ה נתן/ה: "${kidAnswer}"

${judgingInstruction}

כתוב/י משוב לתלמיד/ה, בעברית, בטון חם ומעודד — קצר מאוד, ילד/ה בכיתה יסודית קורא/ת את זה, לא מבוגר/ת. אורך הוא כלל נוקשה כאן, לא המלצה:
- אם נכון: משפט אחד בלבד, לא יותר. שבח/י על התהליך/המאמץ, לא על תכונה מולדת (למשל "ניסית וזה עבד!" ולא "את/ה כל כך חכם/ה"). בלי הסבר נוסף אחרי זה.
  דוגמה לאורך הנכון בדיוק: "כל הכבוד, מצאת את זה!"
${wrongBranch}

החזר/י אך ורק אובייקט JSON תקין:
{
  "correct": true | false,
  "feedback": "המשוב לתלמיד/ה כמתואר לעיל",
  "errorNote": "רק אם לא נכון - תיאור קצר של סוג הטעות (למשל 'בלבול בין חיבור לחיסור' או 'טעות בכיוון הגזירה'), לצורך מעקב פנימי - לא מוצג לתלמיד/ה"
}`;

  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    // Was 400 — generous headroom that let feedback run long (real
    // examples seen: 3-4 sentences for one correct answer). The prompt
    // above now hard-caps feedback length itself; this cap is a second,
    // structural backstop — a shorter ceiling also bounds worst-case
    // generation time, part of the "make it faster" pass.
    // The second-attempt explanation (method + answer, up to three
    // sentences) needs more room than a one-line hint.
    max_tokens: secondAttempt ? 320 : 220,
    system: "את/ה מחזיר/ה אך ורק JSON תקין, ללא טקסט נוסף, ללא markdown code fences.",
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Exercise evaluation returned no text content.");
  }

  const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(raw);

  // Code decides correctness whenever there's a verified number; the model
  // only ever gets to decide it for the non-arithmetic subtypes.
  const modelSaysCorrect = codeGraded ? correctByCode : parsed.correct === true;
  // FIX 4: overrides the model's own verdict — never its opposite. A bare
  // wrong number against the rubric forces `correct = false` regardless of
  // what parsed.correct said; it never flips a false to true.
  const wrongBareNumber = !codeGraded && isRubric && isWrongBareNumberAgainstRubric(kidAnswer, exercise.correctAnswer);
  const correct = wrongBareNumber ? false : modelSaysCorrect;
  // The model's own prose can't be trusted once its verdict is overridden
  // — it was very possibly written to affirm the number it thought was
  // right, which is exactly the confusing "20 is correct, but explain"
  // sentence this fix exists for. Discarding it here (not passing it to
  // safeFeedback at all) falls through to that function's own existing
  // deterministic fallback, the same safety net the arithmetic guard uses.
  const modelText = wrongBareNumber ? "" : typeof parsed.feedback === "string" ? parsed.feedback : "";
  let feedback = safeFeedback(modelText, { verifiedAnswer, correct, secondAttempt, computation: exercise.computation });

  // The verified answer is stated by code, not by the model — and only
  // when the child has already had their hint and missed again.
  // Matched as a whole number, not a substring: an answer of 7 must not be
  // considered "already stated" because the line happens to mention 70.
  const statesAnswerAlready = new RegExp(`(?<!\\d)${formatAnswer(verifiedAnswer ?? 0)}(?!\\d)`).test(feedback);
  if (codeGraded && !correct && secondAttempt && !statesAnswerAlready) {
    feedback = `${feedback} התשובה הנכונה היא ${formatAnswer(verifiedAnswer)}.`;
  }

  return {
    correct,
    feedback,
    errorNote: typeof parsed.errorNote === "string" ? parsed.errorNote : undefined,
  };
}
