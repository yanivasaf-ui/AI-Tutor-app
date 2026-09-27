import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { tokenize } from "@/lib/voice/matchAnswer";
import { Computation, computeAnswer, falseClaimsIn, formatAnswer, lineIsArithmeticallySafe, wrongMathTermsIn } from "./arithmetic";
import { Exercise, ExerciseEvaluation } from "./types";
import type { KidGender } from "@/lib/memory/types";
import { OPENERS, openerKindFor, type OpenerKind } from "./openers";
import {
  MODEL_RULES,
  effortModeling,
  shouldModelEffort,
  STRATEGY_PRAISE_EXAMPLE,
  REST_CORRECT,
  restExplanation as constitutionExplanation,
  restHint,
  violatesConstitution,
} from "@/lib/feedback/constitution";

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
/**
 * The deterministic lines: the opener the character says the INSTANT the
 * verdict is locked, and the part that follows it. The openers themselves
 * live in ./openers (a module with no imports) because the client needs
 * them too — see that file.
 */
export { OPENERS, openerKindFor, type OpenerKind };

// Every deterministic line below is owned by lib/feedback/constitution.ts.
// This module composes them with the verified number; it does not author
// them, and it is not where a wording change belongs.
const restExplanation = (answer: number) => constitutionExplanation(formatAnswer(answer));

const SAFE_CORRECT = `${OPENERS.correct} ${REST_CORRECT}`;
const safeHint = (gender?: KidGender | null) => `${OPENERS.hint} ${restHint(gender)}`;
const safeExplanation = (answer: number) => `${OPENERS.explain} ${restExplanation(answer)}`;

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
  opts: { verifiedAnswer: number | null; correct: boolean; secondAttempt: boolean; computation?: Computation | null; childGender?: KidGender | null }
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
  return safeHint(opts.childGender);
}

/**
 * Same gate, same remedy, for the case where the opener has ALREADY been
 * spoken: the deterministic fallback returns only the part that follows
 * it, so a child doesn't hear "כל הכבוד! כל הכבוד! זה בדיוק נכון."
 *
 * The gate itself is untouched — this only changes which deterministic
 * text replaces a line the gate rejected.
 */
export function safeFeedbackAfterOpener(
  modelText: string,
  opts: { verifiedAnswer: number | null; correct: boolean; secondAttempt: boolean; computation?: Computation | null; childGender?: KidGender | null }
): string {
  const { verifiedAnswer, correct, secondAttempt, computation } = opts;
  const text = modelText.trim();
  if (text && lineIsArithmeticallySafe(text, verifiedAnswer, computation)) return text;
  if (text) {
    console.warn(
      `[exercise-evaluate] replaced an unsafe feedback line (verifiedAnswer=${verifiedAnswer}): ${JSON.stringify(text)} claims=${JSON.stringify(falseClaimsIn(text))} badTerms=${JSON.stringify(wrongMathTermsIn(text, computation))}`
    );
  }
  if (correct) return REST_CORRECT;
  if (secondAttempt && verifiedAnswer !== null) return restExplanation(verifiedAnswer);
  return restHint(opts.childGender);
}

/**
 * feat: specific praise — the section that turns "כל הכבוד" into "כל
 * הכבוד, בפעם שעברה חילוק היה קשה". Returns "" when the kid has no
 * history, and then the prompt below is byte-for-byte what it was, so a
 * first session behaves exactly as before this feature.
 *
 * The anti-hallucination clause is the load-bearing one: a model handed a
 * memory block will happily invent a fourth session that never happened,
 * and to a child an invented memory is indistinguishable from a real one.
 */
export function specificPraiseSection(memoryBlock: string): string {
  if (!memoryBlock) return "";
  return `
${memoryBlock}

## משוב ספציפי, לא כללי
- כשיש למעלה עובדה שקשורה לתרגיל הזה — שבצ/י אותה, במשפט אחד קצר ובעברית טבעית. עובדה אחת, לא שתיים.
- אסור להמציא היסטוריה. אם אין למעלה עובדה רלוונטית, תן/י משוב כללי קצר בדיוק כמו קודם — עדיף כללי מאשר מומצא.
- לעולם אל תזכיר/י שיש לך "זיכרון", "רשימה" או "נתונים", ואל תקריא/י את העובדה כפי שהיא כתובה.
- רק כששולבת עובדה כזאת מותר משפט קצר שני. זה החריג היחיד לכלל האורך שלמעלה; בלי עובדה, האורך נשאר כפי שנקבע שם.

דוגמאות (הפורמט זהה, רק התוכן משתנה):
כללי, פחות טוב:  {"correct": true, "feedback": "כל הכבוד!"}
ספציפי, טוב:     {"correct": true, "feedback": "כל הכבוד! בפעם שעברה חילוק היה קשה, והיום זה הלך חלק."}
כללי, פחות טוב:  {"correct": false, "feedback": "זה בסדר, אפשר לנסות שוב."}
ספציפי, טוב:     {"correct": false, "feedback": "זה בסדר — זו בדיוק הנקודה שהסתבכה גם אתמול. נתחיל מהעשרות."}
`;
}

/**
 * Everything both calls need, derived in code from the exercise and the
 * answer. Computed once and handed to each call, so the verdict call and
 * the prose call can never disagree about what kind of exercise this is.
 */
interface ExerciseSetup {
  verifiedAnswer: number | null;
  codeGraded: boolean;
  correctByCode: boolean;
  isRubric: boolean;
  judgingInstruction: string;
}

function analyzeExercise(exercise: Exercise, kidAnswer: string): ExerciseSetup {
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

  return { verifiedAnswer, codeGraded, correctByCode, isRubric, judgingInstruction };
}

/**
 * A verdict the code has finished deciding. Nothing downstream may change
 * `correct` — the prose call is handed this and told to agree with it.
 */
export interface LockedVerdict {
  correct: boolean;
  verifiedAnswer: number | null;
  codeGraded: boolean;
  secondAttempt: boolean;
  /** True when the verdict was forced to false by the bare-number
   *  override. The model's prose is not trusted at all in this case — see
   *  generateFeedbackProse, which skips the model call entirely. */
  overridden: boolean;
  /** The opener the character says the instant this verdict is locked. */
  openerKind: OpenerKind;
}

/**
 * feat: verdict-first evaluation — step 1 of 2.
 *
 * Decides right/wrong and NOTHING else. No prose, so no prose to wait for:
 * on a computation exercise this is pure arithmetic in code and costs no
 * model call at all, and everywhere else it is one tiny JSON call with a
 * 16-token ceiling.
 *
 * Verdict semantics are byte-identical to the single-call version that
 * preceded this: code owns correctness wherever there is a verified
 * number, the model only decides it for the non-arithmetic subtypes, and
 * the bare-number override still forces false and never the opposite.
 */
export async function evaluateVerdict(
  exercise: Exercise,
  kidAnswer: string,
  opts?: { secondAttempt?: boolean }
): Promise<LockedVerdict> {
  const secondAttempt = opts?.secondAttempt === true;
  const { verifiedAnswer, codeGraded, correctByCode, isRubric, judgingInstruction } = analyzeExercise(
    exercise,
    kidAnswer
  );

  let modelSaysCorrect: boolean;
  if (codeGraded) {
    // Code already knows. Asking a model to restate arithmetic it was
    // explicitly told not to re-judge would be latency for nothing.
    modelSaysCorrect = correctByCode;
  } else {
    const anthropic = getAnthropicClient();
    const prompt = `שאלה שנשאלה לתלמיד/ה: "${exercise.question}"
${exercise.passage ? `קטע קריאה: "${exercise.passage}"` : ""}
${exercise.choices ? `אפשרויות: ${exercise.choices.join(" | ")}` : ""}
התשובה הנכונה: "${exercise.correctAnswer}"
התשובה שהתלמיד/ה נתן/ה: "${kidAnswer}"

${judgingInstruction}

החזר/י אך ורק: {"correct": true} או {"correct": false}`;

    const response = await anthropic.messages.create({
      model: TUTOR_MODEL,
      // A verdict is one boolean. The ceiling is the latency control.
      max_tokens: 16,
      system: "את/ה מחזיר/ה אך ורק JSON תקין, ללא טקסט נוסף, ללא markdown code fences.",
      messages: [{ role: "user", content: prompt }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("Exercise verdict returned no text content.");
    }
    const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    modelSaysCorrect = JSON.parse(raw).correct === true;
  }

  // FIX 4: overrides the model's own verdict — never its opposite. A bare
  // wrong number against the rubric forces `correct = false` regardless of
  // what the model said; it never flips a false to true.
  const overridden = !codeGraded && isRubric && isWrongBareNumberAgainstRubric(kidAnswer, exercise.correctAnswer);
  const correct = overridden ? false : modelSaysCorrect;

  return {
    correct,
    verifiedAnswer,
    codeGraded,
    secondAttempt,
    overridden,
    openerKind: openerKindFor({ correct, secondAttempt, verifiedAnswer }),
  };
}

/**
 * feat: verdict-first evaluation — step 2 of 2.
 *
 * Writes what the character says AFTER the opener, for a verdict that is
 * already locked. The model is told the verdict as a decided fact and
 * required to agree with it, so it cannot praise an answer the code
 * marked wrong.
 *
 * Its output is gated WHOLE by lineIsArithmeticallySafe, exactly as
 * before — sentence-by-sentence gating was measured to miss both a false
 * claim split across a sentence boundary and a wrong stated answer, so
 * this text is never spoken in pieces.
 */
export async function generateFeedbackProse(
  exercise: Exercise,
  kidAnswer: string,
  verdict: LockedVerdict,
  opts?: { childGender?: KidGender | null; memoryBlock?: string }
): Promise<{ feedback: string; errorNote?: string }> {
  const { correct, verifiedAnswer, codeGraded, secondAttempt, overridden } = verdict;
  const opener = OPENERS[verdict.openerKind];

  // The override discards the model's words entirely — its prose was very
  // possibly written to affirm the number it thought was right. Same
  // decision as before the split; now it also saves the whole call.
  if (overridden) {
    return {
      feedback: safeFeedbackAfterOpener("", {
        verifiedAnswer,
        correct,
        secondAttempt,
        computation: exercise.computation,
        childGender: opts?.childGender ?? null,
      }),
    };
  }

  const childGender = opts?.childGender ?? null;
  const memorySection = specificPraiseSection(opts?.memoryBlock ?? "");
  const { isRubric } = analyzeExercise(exercise, kidAnswer);
  const anthropic = getAnthropicClient();

  // On a computation exercise the model never writes the result: code owns
  // that sentence and appends it after the model's words.
  const wrongBranch = secondAttempt
    ? isRubric
      ? `זה כבר הניסיון השני של התלמיד/ה בשאלה הזאת. אין לשאלה הזאת תשובה נכונה יחידה, אז אל תמציא/י "תשובה נכונה" אחת. עד שני משפטים קצרים: (1) הסבר מה מאפיין הסבר טוב לשאלה הזאת, (2) דוגמה קצרה לדרך חשיבה אפשרית. ${genderInstruction(childGender)}`
      : codeGraded
        ? `זה כבר הניסיון השני של התלמיד/ה בשאלה הזאת — רמז כבר ניתן ולא עזר, אז עכשיו מסבירים את הדרך. משפט אחד עד שניים: הדרך לפתרון, צעד אחר צעד, במילים של ילד/ה. קריטי: אל תכתוב/י את התוצאה הסופית ואל תסיים/י במשפט שמכריז מה התשובה — המערכת מוסיפה את התשובה הנכונה בעצמה מיד אחרי המשפטים שלך. אפשר לנסח את דרך הפתרון עצמה בלשון רבים ("מחברים", "בואו נספור") — אבל כל פנייה ישירה לתלמיד/ה עצמו/ה: ${genderInstruction(childGender)}`
        : `זה כבר הניסיון השני של התלמיד/ה בשאלה הזאת — רמז כבר ניתן ולא עזר, אז עכשיו מסבירים עד הסוף. עד שני משפטים קצרים: (1) הדרך לפתרון, צעד אחר צעד, במילים של ילד/ה, (2) התשובה הנכונה, במפורש. בלי שאלה בסוף. אפשר לנסח את דרך הפתרון עצמה בלשון רבים ("מחברים", "בואו נספור") — אבל כל פנייה ישירה לתלמיד/ה עצמו/ה: ${genderInstruction(childGender)}
  דוגמה לאורך הנכון בדיוק: "קודם מחברים את העשרות: 20 ועוד 30 זה 50, ואז את היחידות: 4 ועוד 3 זה 7. אז התשובה היא 57."`
    : `רמז אחד קצר בלבד, עד כ-8 מילים, שמכוון לכיוון הנכון בלי לגלות את התשובה. בלי משפט שני. אפשר לנסח את הרמז בלשון רבים ("אפשר ל...", "בואו נ...") — אבל כל פנייה ישירה לתלמיד/ה עצמו/ה: ${genderInstruction(childGender)}
  דוגמה לאורך הנכון בדיוק: "אפשר לחבר קודם את העשרות."`;

  const prompt = `שאלה שנשאלה לתלמיד/ה: "${exercise.question}"
${exercise.passage ? `קטע קריאה: "${exercise.passage}"` : ""}
${exercise.choices ? `אפשרויות: ${exercise.choices.join(" | ")}` : ""}
${codeGraded ? "" : `התשובה הנכונה: "${exercise.correctAnswer}"`}
התשובה שהתלמיד/ה נתן/ה: "${kidAnswer}"

## הקביעה כבר נעשתה
המערכת כבר קבעה סופית: התשובה ${correct ? "נכונה" : "לא נכונה"}. זו עובדה סגורה — אל תשפוט/י מחדש, אל תסתייג/י, ואל תרמוז/י אחרת.
${correct ? "כל מילה שתכתוב/י חייבת להיות חיובית ומאשרת." : "כל מילה שתכתוב/י חייבת להתייחס לתשובה כלא נכונה. אסור בתכלית האיסור לשבח/לאשר את התשובה עצמה."}

## מה כבר נאמר
הדמות כבר אמרה לתלמיד/ה בקול: "${opener}"
אתה/את כותב/ת את ההמשך בלבד. אל תחזור/י על הפתיח הזה, אל תפתח/י בברכה או בתיקוף רגשי נוסף — זה כבר נאמר. המשך/המשיכי ישירות לתוכן.

${MODEL_RULES}

כתוב/י את ההמשך בעברית, בטון חם ומעודד — קצר מאוד, ילד/ה בכיתה יסודית קורא/ת את זה. אורך הוא כלל נוקשה כאן, לא המלצה:
${correct ? `- משפט אחד קצר בלבד, לא יותר. שבח/י על מה שנעשה בפועל — נקוב/י בדרך שהתלמיד/ה בחר/ה (למשל "${STRATEGY_PRAISE_EXAMPLE}" או "ניסית וזה עבד!").\n  דוגמה לאורך הנכון בדיוק: "מצאת את זה!"` : `- ${wrongBranch}`}
${memorySection}
החזר/י אך ורק אובייקט JSON תקין:
{
  "feedback": "ההמשך לתלמיד/ה כמתואר לעיל, בלי הפתיח שכבר נאמר",
  "errorNote": "רק אם לא נכון - תיאור קצר של סוג הטעות (למשל 'בלבול בין חיבור לחיסור' או 'טעות בכיוון הגזירה'), לצורך מעקב פנימי - לא מוצג לתלמיד/ה"
}`;

  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    // Was 400 — generous headroom that let feedback run long (real
    // examples seen: 3-4 sentences for one correct answer). The prompt
    // above now hard-caps feedback length itself; this cap is a second,
    // structural backstop — a shorter ceiling also bounds worst-case
    // generation time, part of the "make it faster" pass. Lower than
    // before the split, because the opener is no longer part of it.
    max_tokens: secondAttempt ? 280 : 180,
    system: "את/ה מחזיר/ה אך ורק JSON תקין, ללא טקסט נוסף, ללא markdown code fences.",
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Exercise feedback returned no text content.");
  }
  const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(raw);

  const modelText = typeof parsed.feedback === "string" ? parsed.feedback : "";
  let feedback = safeFeedbackAfterOpener(modelText, {
    verifiedAnswer,
    correct,
    secondAttempt,
    computation: exercise.computation,
    childGender,
  });

  // The constitution, enforced rather than requested. MODEL_RULES tells the
  // model the rules; this is what makes a violation harmless when it writes
  // one anyway. Deliberately a SEPARATE pass, after the arithmetic gate
  // above and touching none of it: the two answer different questions (is
  // this true? / may we say this to a child?) and a line can fail either.
  // Checked on the accumulated line, because "כל הכבוד! את כל כך חכמה"
  // only breaks the rule once the opener is in front of it.
  const violation = violatesConstitution(`${opener} ${feedback}`);
  if (violation) {
    console.warn(
      `[exercise-evaluate] replaced a line that broke the feedback constitution (${violation.rule}): ${JSON.stringify(violation.match)}`
    );
    feedback = safeFeedbackAfterOpener("", {
      verifiedAnswer,
      correct,
      secondAttempt,
      computation: exercise.computation,
      childGender,
    });
  }

  // The character admits the work was hard for it too — rationed by the
  // constitution (roughly one such moment in three) and only where it is
  // true: after a hint has already missed. Composed here, after the
  // arithmetic gate, because it carries no arithmetic and cannot be
  // affected by it; same position as the verified-answer sentence below.
  if (shouldModelEffort({ exerciseId: exercise.id, secondAttempt, correct })) {
    feedback = `${effortModeling(childGender)} ${feedback}`;
  }

  // The verified answer is stated by code, not by the model — and only
  // when the child has already had their hint and missed again.
  // Matched as a whole number, not a substring: an answer of 7 must not be
  // considered "already stated" because the line happens to mention 70.
  // Checked against the ACCUMULATED line (opener + prose), which is what
  // the child actually hears, not the prose alone.
  const spokenSoFar = `${opener} ${feedback}`;
  const statesAnswerAlready = new RegExp(`(?<!\\d)${formatAnswer(verifiedAnswer ?? 0)}(?!\\d)`).test(spokenSoFar);
  // codeGraded is by definition `verifiedAnswer !== null`; spelled out
  // here so the narrowing survives the destructure above.
  if (verifiedAnswer !== null && codeGraded && !correct && secondAttempt && !statesAnswerAlready) {
    feedback = `${feedback} התשובה הנכונה היא ${formatAnswer(verifiedAnswer)}.`;
  }

  return { feedback, errorNote: typeof parsed.errorNote === "string" ? parsed.errorNote : undefined };
}

/**
 * The whole evaluation as one await — verdict, then prose, joined into the
 * single line the character used to say.
 *
 * Kept for callers that have no use for the split (and as the definition
 * of record for what opener + prose is supposed to add up to). The tutor
 * route no longer uses it: it needs the verdict on its own, early, so the
 * opener can be spoken while the prose is still being written.
 */
export async function evaluateExerciseAnswer(
  exercise: Exercise,
  kidAnswer: string,
  opts?: { secondAttempt?: boolean; childGender?: KidGender | null; memoryBlock?: string }
): Promise<ExerciseEvaluation> {
  const verdict = await evaluateVerdict(exercise, kidAnswer, { secondAttempt: opts?.secondAttempt });
  const prose = await generateFeedbackProse(exercise, kidAnswer, verdict, opts);
  return {
    correct: verdict.correct,
    feedback: `${OPENERS[verdict.openerKind]} ${prose.feedback}`.trim(),
    errorNote: prose.errorNote,
  };
}
