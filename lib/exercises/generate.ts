import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { search } from "@/lib/rag/store";
import { getTopicById } from "@/lib/map/topics";
import {
  balancesEquation,
  computeAnswer,
  formatAnswer,
  parseComputation,
  questionStatesComputation,
  type Computation,
} from "./arithmetic";
import { SubjectProfile } from "@/lib/memory/types";
import { topicFit } from "./topic-fit";
import { Exercise, ExerciseSubtype, ExerciseType, NumberLineData, TileOrderData, GroupingData, Grade } from "./types";

/**
 * Tier 1 + Tier 2 subtypes from output/exercise-types-build-brief.md, each
 * mapped to a specific pedagogical pattern rather than leaving "open vs
 * multiple_choice vs number_line vs tile_order" as the model's own free
 * choice. Tier 2 (number_line_placement, pattern_completion, word_build,
 * sentence_order) additionally requires the model to return a numberLine or
 * tiles payload alongside the question — see the parsing logic below.
 */
const SUBTYPE_GUIDANCE: Record<ExerciseSubtype, string> = {
  fill_in_blank:
    'תרגיל חישוב בסיסי (חיבור/חיסור/כפל/חילוק, לפי המתאים לכיתה). type חייב להיות "open". מבנה השאלה — שני חלקים, בסדר הזה: (1) משפט פתיחה קצר אחד שמעגן את התרגיל בנושא הנלמד (למשל "בדיאגרמת העמודות ספרו כמה ילדים אוהבים כל פרי." או "לרועי יש 5 משולשים."); (2) התרגיל עצמו, בספרות ובסימן הפעולה, במפורש (למשל "כמה זה 5 + 4 + 3?"). חובה: החלק השני מופיע תמיד ככתבו — משפט הפתיחה מוסיף הקשר בלבד, הוא לא מחליף את התרגיל ולא מסתיר אותו, והתלמיד/ה צריך/ה רק לחשב ולא להסיק איזו פעולה לבחור. משפט אחד לפתיחה, לא בעיה מילולית שצריך לפענח. אם לא נמסר נושא תוכן (תרגול חופשי), אפשר להסתפק בתרגיל עצמו בלי משפט פתיחה. החזר/י שדה נוסף computation: {"operands": [המספרים לפי סדר הופעתם בשאלה], "operators": [סימני הפעולה ביניהם, אחד מתוך + - * /]} — לדוגמה לשאלה "10 × 4" החזר/י {"operands": [10, 4], "operators": ["*"]}. אל תחשב/י את התוצאה: האפליקציה מחשבת אותה בעצמה מהשדה הזה, ושדה correctAnswer שלך יוחלף. מותר לשרשר רק + ו- (למשל 87 - 39 + 24); כפל או חילוק חייבים להיות פעולה אחת בלבד. בחילוק — רק חלוקה ללא שארית. התוצאה חייבת להיות מספר שלם ולא שלילי.',
  pick_operation:
    'בעיית מילה קצרה. השאלה מבקשת מהתלמיד/ה לבחור איזו פעולה חשבונית פותרת אותה — לא לחשב את התוצאה עצמה. type חייב להיות "multiple_choice", 4 אפשרויות מתוך פעולות חשבון (חיבור/חיסור/כפל/חילוק, הרלוונטיות בלבד).',
  explain_thinking:
    'שאלה פתוחה שמבקשת מהתלמיד/ה להסביר את דרך החשיבה/האסטרטגיה לפתרון, לא רק תוצאה מספרית. type חייב להיות "open". אין תשובה נכונה יחידה — correctAnswer צריך לתאר בקצרה מה מאפיין הסבר טוב (למשל "הסבר שמזכיר פירוק למאות/עשרות/יחידות"), לא תשובה מדויקת.',
  comprehension:
    'כתוב/י קטע קריאה קצר (2-4 משפטים, מתאים לגיל) בשדה passage, ואז שאלת הבנה סגורה עליו בשדה question. type יכול להיות "open" (תשובה קצרה) או "multiple_choice".',
  spelling_correction_mc:
    'משפט קצר עם 4 אפשרויות כתיב למילה אחת בתוכו — רק אחת נכונה. type חייב להיות "multiple_choice".',
  root_pattern_mc:
    'תן/י שורש (למשל כ-ת-ב) ובקש/י לבחור איזו מילה מבין 4 אפשרויות נגזרת מהשורש הזה. type חייב להיות "multiple_choice".',
  number_line_placement:
    'תרגיל מיקום על ציר מספרים. type חייב להיות "number_line". קבע/י min, max, step כך שמספר הסימונים על הציר — ((max-min)/step)+1 — לא יעלה על 9, ומתאים לרמת הכיתה. החזר/י שדה נוסף numberLine: {"min": מספר, "max": מספר, "step": מספר}. נסח/י את question כשאלה שמבקשת למקם ערך מסוים על הציר. אל תסתפקו ב"היכן נמצא המספר 42 על הציר?" גנרי — ה-step וההקשר של השאלה חייבים לנבוע מהנושא הספציפי (למשל בנושא כפל/חילוק: step שהוא הגורם הרלוונטי, וניסוח שמזכיר את פעולת הכפל/חילוק עצמה, לא רק "מספר סתמי"). correctAnswer הוא הערך הנכון (כמחרוזת).',
  pattern_completion:
    'רצף של לפחות 4 מספרים עם קפיצה קבועה (אותו הפרש בין כל שני מספרים סמוכים — חיבור או חיסור, לא כפל), עם ערך אחד חסר בסוף הרצף. הרצף וההקשר שלו (הסיפור סביבו, אם יש) חייבים לנבוע מהנושא הספציפי, לא רק להיות ספירה כללית שדבוקה אליו במקרה — למשל בנושא כפל/חילוק ההפרש בין המספרים ברצף עצמו צריך להיות הכפולה הרלוונטית (5, 10, 15... או 100, 200, 300...), לא הפרש שרירותי. type חייב להיות "tile_order". החזר/י שדה נוסף tiles: {"items": [4 מספרים מעורבבים, קרובים לתשובה הנכונה, אחד מהם נכון]}. correctAnswer הוא הערך הנכון להשלמת הרצף — בדיוק המספר האחרון בתוספת אותו הפרש קבוע.',
  word_build:
    'תן/י מילה עברית קצרה ומתאימה לגיל (מהתוכן הלימודי או קרובה אליו). type חייב להיות "tile_order". החזר/י שדה נוסף tiles: {"items": [אותיות המילה בסדר מעורבב]} — קריטי: items חייב להכיל בדיוק את האותיות של המילה, אותה אחת אחת, בלי אף אות נוספת ובלי אף אות חסרה (רק הסדר מעורבב, לא התוכן). correctAnswer הוא אותה מילה בדיוק (האותיות ברצף הנכון, ללא רווחים ביניהן) — ודא/י ש-correctAnswer מכיל בדיוק את אותן אותיות כמו items, לא יותר ולא פחות.',
  sentence_order:
    'תן/י משפט קצר ופשוט (3-6 מילים) מתאים לגיל. type חייב להיות "tile_order". החזר/י שדה נוסף tiles: {"items": [מילות המשפט בסדר מעורבב]} — קריטי: items חייב להכיל בדיוק את מילות המשפט, אותה אחת אחת, בלי אף מילה נוספת ובלי אף מילה חסרה (רק הסדר מעורבב, לא התוכן). correctAnswer הוא אותו משפט בדיוק, עם רווחים בין המילים בסדר הנכון — ודא/י שמספר המילים ב-correctAnswer זהה למספר הפריטים ב-items.',
  // {MAX_GROUPING_ITEMS} is substituted per-grade in subtypeGuidance()
  // below — a kid tapping N items one-by-one into buckets is the actual
  // interaction cost here (GroupingWidget.tsx), and that cost scales with
  // N regardless of how easy the arithmetic is, so the cap is a UX limit
  // on tap count, not a difficulty limit.
  visual_grouping:
    'תן/י N חפצים זהים (אותו אמוג\'י חוזר, כגון 🍎 או ⭐, לא מילים) שמתחלקים בדיוק ל-groupCount קבוצות שוות ללא שארית — בחר/י N ו-groupCount כך ש-N מתחלק ב-groupCount בדיוק, N הכולל לא יעלה על {MAX_GROUPING_ITEMS}, ומתאים לרמת הכיתה (למשל 12 חפצים, 3 קבוצות). type חייב להיות "grouping". החזר/י שדה נוסף grouping: {"items": [N פעמים אותו אמוג\'י], "groupCount": מספר הקבוצות}. נסח/י את question כבקשה לחלק את החפצים ל-groupCount קבוצות שוות. correctAnswer הוא מספר הפריטים הנכון שאמור להיות בכל קבוצה (N חלקי groupCount), כמחרוזת.',
  equation_balance:
    'משוואת חיבור או חיסור פשוטה עם מקום ריק אחד (למשל "3 + ___ = 7"), מתאימה לרמת הכיתה. type חייב להיות "tile_order". החזר/י שדה נוסף tiles: {"items": [4 מספרים מעורבבים קרובים לתשובה, רק אחד מהם הופך את המשוואה לנכונה]}. נסח/י את question כמשוואה עם המקום הריק מסומן בבירור (למשל "___"). correctAnswer הוא המספר הנכון שמאזן את המשוואה, וחייב להיות אחד מהערכים ב-items.',
  shape_match:
    'רצף צורות עם דפוס ברור, מיוצג באמוג\'י צורות (למשל ⭐ 🔵 ⭐ 🔵 ___ או 🔺 🔺 🟦 🔺 🔺 ___), עם מקום ריק אחד בסוף. type חייב להיות "tile_order". החזר/י שדה נוסף tiles: {"items": [4 אמוג\'י צורות מעורבבים, רק אחד ממשיך את הדפוס נכון]}. נסח/י את question שמציג את רצף האמוג\'י עם מקום ריק בסוף. correctAnswer הוא אמוג\'י הצורה הנכונה, וחייב להיות אחד מהערכים ב-items.',
  vowel_select_mc:
    'תן/י מילה עברית קצרה מתאימה לגיל, ובקש/י לבחור את הניקוד הנכון שלה מבין 4 אפשרויות — כל אפשרות היא המילה המלאה עם ניקוד שונה (באמצעות תווי ניקוד יוניקוד, למשל "כֶּלֶב" לעומת "כָּלָב"), רק אחת מנוקדת נכון. type חייב להיות "multiple_choice".',
  phonemic_visual_mc:
    'גרסה חזותית/טקסטואלית של מודעות פונולוגית, ללא אודיו (אין השמעת קול באפליקציה הזו) — הצג/י מילת יעד ובקש/י לבחור מבין 4 מילים איזו מתחילה (או מסתיימת) באותו צליל/אות כמו מילת היעד. type חייב להיות "multiple_choice".',
};

/**
 * The one *expected* reason there's no exercise: the curriculum index has
 * nothing for this subject/grade/topic. Its own type so the route can
 * answer it distinctly (404 `no_content`) and the kid's screen can say
 * "nothing here yet" — every other failure (LLM error, malformed output,
 * DB error) is a real fault and stays a 500, which the screen shows as
 * "something broke, try again".
 */
export class NoCurriculumContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoCurriculumContentError";
  }
}

/**
 * BUG B: a finished draft that is well-formed but is not ABOUT the topic it
 * was requested for (a bare "כמה זה 5 + 3?" for gematria). Its own type so
 * the retry loop can tell "the model slipped on the format" from "the model
 * wrote a valid exercise about the wrong thing" and say so in the next ask.
 */
export class TopicFitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicFitError";
  }
}

/** Added to the next request after a TopicFitError, in the same prompt slot
 *  the seed script uses for its variety line. Internal model instruction,
 *  never shown to a child. */
const TOPIC_FIT_RETRY_HINT =
  "התרגיל הקודם נדחה: הוא היה תקין כתרגיל אבל לא עסק בתוכן הנושא (הוא היה תרגיל חשבון כללי). הפעם התרחיש, השאלה או האפשרויות חייבים להשתמש במושגים של הנושא עצמו.";

const MATH_SUBTYPES: ExerciseSubtype[] = [
  "fill_in_blank",
  "pick_operation",
  "explain_thinking",
  "number_line_placement",
  "pattern_completion",
  "visual_grouping",
  "equation_balance",
  "shape_match",
];
const HEBREW_SUBTYPES: ExerciseSubtype[] = [
  "comprehension",
  "spelling_correction_mc",
  "root_pattern_mc",
  "word_build",
  "sentence_order",
  "vowel_select_mc",
  "phonemic_visual_mc",
];

/** Subtypes that fill exactly ONE of several offered tile_order slots
 *  (the correct value is one of a handful of candidates) rather than
 *  placing every offered tile — pattern_completion, equation_balance, and
 *  shape_match all share this shape. word_build/sentence_order place
 *  every tile instead. */
const SINGLE_SLOT_TILE_SUBTYPES: ExerciseSubtype[] = ["pattern_completion", "equation_balance", "shape_match"];

/** root_pattern_mc is flagged in the locked inventory as likely ב'-ג' only,
 *  not grade א' — excluded there rather than generated and hoped to be fine. */
function pickSubtype(subject: "math" | "hebrew", grade: Grade): ExerciseSubtype {
  const pool =
    subject === "math"
      ? MATH_SUBTYPES
      : HEBREW_SUBTYPES.filter((s) => !(s === "root_pattern_mc" && grade === "א"));
  return pool[Math.floor(Math.random() * pool.length)];
}

/** grouping's per-grade item cap (2026-09-12 iPhone QA: tapped through 20+
 *  stars one-by-one with no counter and no instructions — a real UX dead
 *  end, not just a big number). Grade ג gets more room since equal-split
 *  arithmetic there already reaches higher totals (e.g. dividing 20 into 4
 *  groups of 5) than א/ב's curriculum calls for. Prompt guidance only —
 *  not code-enforced, same trust-the-prompt pattern already used for "4
 *  choices" on multiple_choice (see NumberLineData's doc comment). */
function subtypeGuidance(subtype: ExerciseSubtype, grade: Grade): string {
  const maxGroupingItems = grade === "ג" ? 20 : 12;
  return SUBTYPE_GUIDANCE[subtype].replace("{MAX_GROUPING_ITEMS}", String(maxGroupingItems));
}

/** The kid's adaptive level on this topic (lib/practice/state.ts), as a
 *  concrete instruction. Always inside the grade's curriculum — level 1 is
 *  gentler, not a grade down; level 3 is a stretch, not the next grade. */
const LEVEL_GUIDANCE: Record<1 | 2 | 3, string> = {
  1: "רמת קושי 1 מתוך 3 (קלה): בתוך תוכנית הכיתה, אבל בגרסה הפשוטה ביותר — מספרים קטנים ועגולים, צעד אחד בלבד, מילים מוכרות, ניסוח קצר מאוד.",
  2: "רמת קושי 2 מתוך 3 (רגילה): תרגיל טיפוסי לרמת הכיתה.",
  3: "רמת קושי 3 מתוך 3 (מאתגרת): עדיין בתוך תוכנית הכיתה, אבל עם מספרים גדולים יותר, שני צעדים, או מילים ומשפטים ארוכים יותר.",
};

/**
 * Generates one new exercise, grounded in the RAG curriculum content at
 * (roughly) the kid's current level — not a fixed problem bank. This is the
 * core mechanism Leo flagged as missing: without a real, structured exercise
 * loop, "placement derived from real exercise performance" (the locked
 * decision) had nothing concrete to derive from.
 *
 * Picks one of the Tier 1 exercise subtypes (see SUBTYPE_GUIDANCE above)
 * and asks the model to build specifically that pattern, rather than
 * leaving "open vs multiple_choice" as the model's own free choice — this
 * is what makes each generated exercise match one of the locked inventory's
 * distinct pedagogical patterns instead of drifting toward whichever shape
 * the model finds easiest.
 */
/** How many times a rejected draft is re-requested before giving up. A
 *  draft is rejected for failing one of the code checks below (an answer
 *  that doesn't match its own computation, tiles that can't spell the
 *  word, an equation that doesn't balance). Those are model slips and
 *  usually don't repeat, so asking again costs one more call and saves the
 *  child a "משהו השתבש" screen. */
const MAX_GENERATION_ATTEMPTS = 3;

/**
 * Generates one exercise, retrying a draft the code checks reject.
 * NoCurriculumContentError is not a rejected draft — there is genuinely
 * nothing to build from — so it propagates immediately.
 */
export async function generateExercise(opts: Parameters<typeof generateExerciseOnce>[0]): Promise<Exercise> {
  let lastError: unknown;
  let request = opts;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    try {
      return await generateExerciseOnce(request);
    } catch (err) {
      if (err instanceof NoCurriculumContentError) throw err;
      if (err instanceof TopicFitError) {
        request = { ...opts, varietyHint: [opts.varietyHint, TOPIC_FIT_RETRY_HINT].filter(Boolean).join("\n") };
      }
      lastError = err;
      console.warn(
        `[exercise-generate] draft ${attempt}/${MAX_GENERATION_ATTEMPTS} rejected: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  throw lastError;
}

async function generateExerciseOnce(opts: {
  subject: "math" | "hebrew";
  grade: Grade;
  profile: SubjectProfile | null;
  /** Map node's topic id (feat: topic-scoped exercise generation). When
   *  given and it resolves to a real topic matching subject+grade,
   *  retrieval is scoped to that one curriculum chunk instead of the
   *  usual profile/grade-level query, and the returned exercise's `topic`
   *  is forced to that chunk's canonical topic string (not left to the
   *  model's own free-text echo) — this is what lets
   *  findReusableExercise() reliably match on it later. An unrecognized
   *  or subject/grade-mismatched id is NOT an error: falls back to
   *  normal (topic-less) behavior with a console.warn, same "don't break
   *  the kid's session over a stale id" leniency as the rest of this
   *  function's error handling. */
  topicId?: string;
  /** Adaptive level for this topic (lib/practice/state.ts). Defaults to 2,
   *  the middle level — which is also what diagnostic questions use. */
  level?: 1 | 2 | 3;
  /** Forces the subtype instead of picking one at random — the bank seed
   *  script's own way of cycling through every bankable subtype for
   *  variety, and of never landing on explain_thinking/shape_match
   *  (lib/exercises/bank-guard.ts's UNVERIFIABLE_SUBTYPES), which live
   *  generation's own random pickSubtype() is otherwise free to choose. */
  forceSubtype?: ExerciseSubtype;
  /** Extra prompt line — the bank seed script's way of steering away from
   *  names/scenarios already used in the same topic+level batch, so a kid
   *  doing several in a row doesn't feel the template ("no template
   *  smell", the task's own words). Ignored by live generation, which
   *  never sets it. */
  varietyHint?: string;
}): Promise<Exercise> {
  const { subject, grade, profile, topicId } = opts;
  const level = opts.level ?? 2;

  function resolveTopic(): ReturnType<typeof getTopicById> {
    if (!topicId) return undefined;
    const t = getTopicById(topicId);
    if (!t) {
      console.warn(`[exercise-generate] topicId "${topicId}" not found — falling back to topic-less generation.`);
      return undefined;
    }
    if (t.subject !== subject || t.grade !== grade) {
      console.warn(
        `[exercise-generate] topicId "${topicId}" is subject=${t.subject} grade=${t.grade}, doesn't match requested subject=${subject} grade=${grade} — falling back to topic-less generation.`
      );
      return undefined;
    }
    return t;
  }
  const resolvedTopic = resolveTopic();

  // Retrieval query: a resolved topic takes priority (the kid tapped this
  // exact node) over the profile-based query, which itself beats the
  // generic grade-level fallback. Lean on the kid's real profile when it
  // exists (recent summary + topics already covered) so a returning kid
  // gets grounded in where they actually are, not just their nominal
  // grade. A brand-new kid with neither falls back to a generic
  // grade-level query — the locked cold-start tradeoff, not a bug.
  const retrievalQuery = resolvedTopic
    ? resolvedTopic.topic
    : profile?.recentSummary
      ? `${profile.recentSummary} רמה: ${profile.estimatedLevel}`
      : `תרגיל ${subject === "math" ? "בחשבון" : "בעברית"} מתאים לכיתה ${grade}`;

  // A resolved topic makes search() below filter by exact chunk id, which
  // (ids are unique per chunk) returns at most one result — the query
  // embedding's score never affects which chunk comes back, only ITS
  // OWN relative ranking among candidates that don't exist here. Skipping
  // the call entirely avoids paying for both the embedding inference AND
  // — since this was the only static top-level import pulling
  // @huggingface/transformers into this module — the onnxruntime/sharp/
  // MiniLM-weights load on every generate_exercise cold start, topic-scoped
  // or not (2026-09-12 iPhone QA: "everything is slow"). The import is
  // dynamic and only reached on the path that genuinely needs semantic
  // ranking across multiple candidates (no topic resolved, so search()
  // falls back to subject/grade filtering) — keep it that way; a static
  // import at this module's top reintroduces the cost unconditionally.
  const queryEmbedding = resolvedTopic
    ? []
    : await import("@/lib/rag/embed").then((m) => m.embedText(retrievalQuery));
  const retrieved = search(queryEmbedding, { subject, grade, topK: 3, id: resolvedTopic?.id });

  if (retrieved.length === 0) {
    throw new NoCurriculumContentError(
      `No curriculum content for subject=${subject} grade=${grade}${resolvedTopic ? ` topic=${resolvedTopic.id}` : ""} — cannot ground an exercise.`
    );
  }

  const contextBlock = retrieved.map((c) => `- [${c.topic}] ${c.text}`).join("\n");
  const avoidTopics = profile?.topicsCovered.slice(-4).join(", ") || "";
  const subtype = opts.forceSubtype ?? pickSubtype(subject, grade);

  const prompt = `את/ה בונה תרגיל אחד לתלמיד/ה בכיתה ${grade}, בנושא ${subject === "math" ? "חשבון" : "עברית"}.

תוכן לימודי לביסוס התרגיל (מקור: תוכנית הלימודים):
${contextBlock}

${profile ? `רמה משוערת נוכחית של התלמיד/ה: ${profile.estimatedLevel || "ברירת מחדל לפי כיתה"}` : ""}
${avoidTopics ? `נושאים שתורגלו לאחרונה (עדיף לגוון, לא חובה להימנע לגמרי): ${avoidTopics}` : ""}
${LEVEL_GUIDANCE[level]}
${opts.varietyHint ?? ""}

בחר/י את אחד הנושאים לעיל ובנה/י תרגיל אחד קצר, ברור, ומתאים לגיל, לפי התבנית הבאה בדיוק:
${
  resolvedTopic
    ? `קריטי: התרגיל חייב לעסוק בפועל בתוכן הנושא "${resolvedTopic.topic}" — לא רק להיות תרגיל מספרי כללי שמזדמן להיות מתויג תחת הנושא הזה. לדוגמה: בנושא צורות גאומטריות התרחיש חייב לעסוק בצורות עצמן (סוגי צורות, מספר צלעות/זוויות, השוואה ביניהן) ולא בספירה כללית; בנושא כפל וחילוק התרגיל חייב לכלול בפועל פעולת כפל או חילוק (למשל קפיצות של מספר קבוע, חלוקה לקבוצות, כפולות), לא רק מיקום מספר כלשהו על ציר. אם התבנית שנבחרה (למטה) נוטה מטבעה להיות כללית (כמו מיקום על ציר או השלמת רצף), התאימו את התוכן הספציפי — הערך על הציר, ההפרש ברצף, התרחיש של בעיית המילה — כך שינבע ממש מהנושא "${resolvedTopic.topic}", לא ממספר שרירותי.`
    : ""
}
${subtypeGuidance(subtype, grade)}

החזר/י אך ורק אובייקט JSON תקין, ללא טקסט נוסף, בפורמט הזה:
{
  "type": "open" | "multiple_choice" | "number_line" | "tile_order" | "grouping",
  "topic": "שם הנושא מהרשימה לעיל",
  "passage": "רק אם התבנית דורשת קטע קריאה (comprehension) - הקטע עצמו, אחרת השמט שדה זה",
  "question": "נוסח השאלה, בעברית, מתאים לילד/ה",
  "choices": ["רק אם type הוא multiple_choice - 4 אפשרויות"],
  "numberLine": "רק אם type הוא number_line - {min, max, step}, אחרת השמט שדה זה",
  "tiles": "רק אם type הוא tile_order - {items: [...]}, אחרת השמט שדה זה",
  "grouping": "רק אם type הוא grouping - {items: [...], groupCount: מספר}, אחרת השמט שדה זה",
  "computation": "רק אם התבנית דורשת זאת (fill_in_blank) - {operands: [...], operators: [...]}, אחרת השמט שדה זה",
  "correctAnswer": "התשובה הנכונה (ראה ההנחיה המיוחדת לתבנית שנבחרה לעיל — לכל תבנית כללים משלה למה correctAnswer אמור להכיל)"
}`;

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    max_tokens: 500,
    system: "את/ה מחזיר/ה אך ורק JSON תקין, ללא טקסט נוסף, ללא markdown code fences.",
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Exercise generation returned no text content.");
  }

  const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(raw);

  if (typeof parsed.question !== "string" || typeof parsed.correctAnswer !== "string") {
    throw new Error("Exercise generation returned malformed JSON.");
  }

  const type: ExerciseType =
    parsed.type === "multiple_choice" ||
    parsed.type === "number_line" ||
    parsed.type === "tile_order" ||
    parsed.type === "grouping"
      ? parsed.type
      : "open";

  let numberLine: NumberLineData | undefined;
  if (type === "number_line") {
    const nl = parsed.numberLine;
    if (!nl || typeof nl.min !== "number" || typeof nl.max !== "number") {
      throw new Error("Exercise generation returned type=number_line with no valid numberLine payload.");
    }
    numberLine = { min: nl.min, max: nl.max, step: typeof nl.step === "number" && nl.step > 0 ? nl.step : 1 };
  }

  let tiles: TileOrderData | undefined;
  if (type === "tile_order") {
    const items = Array.isArray(parsed.tiles?.items) ? parsed.tiles.items.map(String) : null;
    if (!items || items.length === 0) {
      throw new Error("Exercise generation returned type=tile_order with no valid tiles payload.");
    }

    // The model sometimes pads items with an extra distractor letter/word
    // even when instructed not to (caught via testing: a 4-tile "אמא" —
    // 3 letters). For word_build/sentence_order every tile gets placed, so
    // a count mismatch makes an exact match impossible for any kid attempt
    // — reject rather than ship an unsolvable exercise.
    if (subtype === "word_build" && items.length !== parsed.correctAnswer.length) {
      throw new Error("word_build tile count doesn't match correctAnswer length.");
    }
    if (subtype === "sentence_order" && items.length !== parsed.correctAnswer.trim().split(/\s+/).length) {
      throw new Error("sentence_order tile count doesn't match correctAnswer word count.");
    }
    if (subtype && SINGLE_SLOT_TILE_SUBTYPES.includes(subtype) && !items.includes(parsed.correctAnswer)) {
      throw new Error(`${subtype} correctAnswer isn't among the offered tiles.`);
    }
    // Membership in the tiles was the only check here, which let a tile that
    // doesn't actually balance the equation through ("3 + ___ = 7" with the
    // answer 5, as long as 5 was on offer). Solve it in code instead.
    if (subtype === "equation_balance" && !balancesEquation(parsed.question, parsed.correctAnswer)) {
      throw new Error(
        `equation_balance answer "${parsed.correctAnswer}" doesn't balance "${parsed.question}".`
      );
    }

    tiles = {
      items,
      slotCount: subtype && SINGLE_SLOT_TILE_SUBTYPES.includes(subtype) ? 1 : items.length,
      joinWith: subtype === "word_build" ? "" : " ",
    };
  }

  // ---- Arithmetic: code computes, the model only supplies the operands ----
  // The model is not trusted to state what 10 × 4 is. It hands over the
  // computation as data; computeAnswer() produces the number, and the
  // question the child will SEE has to state that same computation, so the
  // rendered text and the verified answer cannot drift apart.
  let computation: Computation | undefined;
  let verifiedAnswer: string | undefined;
  if (subtype === "fill_in_blank") {
    const parsedComputation = parseComputation(parsed.computation);
    if (!parsedComputation) {
      throw new Error(
        `fill_in_blank returned no usable computation payload (got ${JSON.stringify(parsed.computation)}).`
      );
    }
    if (!questionStatesComputation(parsed.question, parsedComputation)) {
      throw new Error(
        `fill_in_blank question "${parsed.question}" doesn't state its own computation ${JSON.stringify(parsedComputation)}.`
      );
    }
    const answer = computeAnswer(parsedComputation);
    if (answer === null) {
      throw new Error(`fill_in_blank computation ${JSON.stringify(parsedComputation)} has no valid result.`);
    }
    computation = parsedComputation;
    verifiedAnswer = formatAnswer(answer);
  }

  let grouping: GroupingData | undefined;
  if (type === "grouping") {
    const items = Array.isArray(parsed.grouping?.items) ? parsed.grouping.items.map(String) : null;
    const groupCount = parsed.grouping?.groupCount;
    if (!items || items.length === 0 || typeof groupCount !== "number" || groupCount < 2) {
      throw new Error("Exercise generation returned type=grouping with no valid grouping payload.");
    }
    // Must divide evenly — an uneven split has no single correct "items
    // per group" answer, which is exactly what correctAnswer is supposed
    // to be. Same "reject an unsolvable exercise" discipline already
    // applied to word_build/sentence_order/pattern_completion above.
    if (items.length % groupCount !== 0) {
      throw new Error(`grouping items.length (${items.length}) isn't evenly divisible by groupCount (${groupCount}).`);
    }
    const expectedPerGroup = String(items.length / groupCount);
    if (parsed.correctAnswer.trim() !== expectedPerGroup) {
      throw new Error(`grouping correctAnswer "${parsed.correctAnswer}" doesn't match items.length/groupCount (${expectedPerGroup}).`);
    }
    grouping = { items, groupCount };
  }

  const exercise: Exercise = {
    id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    subject,
    grade,
    type,
    subtype,
    // A resolved topic wins over whatever the model echoed back — this is
    // what makes findReusableExercise()'s later `.eq("topic", ...)` filter
    // reliable instead of depending on the model consistently reproducing
    // the exact same string every time.
    topic: resolvedTopic ? resolvedTopic.topic : typeof parsed.topic === "string" ? parsed.topic : retrieved[0].topic,
    topicId: resolvedTopic?.id,
    passage: subtype === "comprehension" && typeof parsed.passage === "string" ? parsed.passage : undefined,
    question: parsed.question,
    choices: Array.isArray(parsed.choices) ? parsed.choices.map(String) : undefined,
    numberLine,
    tiles,
    grouping,
    // For a computation exercise this is the code-computed number, never
    // the model's own arithmetic (see ./arithmetic.ts).
    correctAnswer: verifiedAnswer ?? parsed.correctAnswer,
    computation,
    difficulty: level,
  };

  // The last gate, after every existing one: is this exercise ABOUT the topic
  // it is about to be filed under? Stamping `topicId` on a draft says where it
  // was asked for, not what it is (BUG B, docs/investigations/BUG-B-topic-
  // boundary.md). A miss is thrown so generateExercise() asks again; after its
  // last attempt the error propagates and nothing leaky is ever saved.
  const fit = topicFit(exercise, resolvedTopic?.id);
  if (!fit.ok) {
    throw new TopicFitError(`${subtype ?? type} draft is off-topic for ${resolvedTopic?.id}: ${fit.reason}. Question: "${exercise.question}"`);
  }
  return exercise;
}
