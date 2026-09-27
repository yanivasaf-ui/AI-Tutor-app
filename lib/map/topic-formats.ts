import type { ExerciseSubtype } from "@/lib/exercises/types";
import type { Operation } from "./topics";

/**
 * THE per-topic allowed-format table: for every topic, which exercise
 * formats may be built, served or banked under it, and which arithmetic
 * operations an exercise under it may use.
 *
 * WHY (BUG B, grade-ב sweep 2026-09-26). The format of an exercise used to
 * be chosen at random, blind to the topic (generate.ts pickSubtype), and the
 * 2026-09-14 bank seed deliberately cycled every format through every topic.
 * So "צורות" held arithmetic sequences, "למדוד אורך" held +5 sequences,
 * "לקרוא סיפור קצר" held root drills. The topic check that followed only
 * looked at vocabulary, and a sequence about triangles has triangle
 * vocabulary. This table answers the question structurally: a format either
 * belongs to a topic or it does not.
 *
 * HOW IT WAS MADE. Each entry is derived from the topic's own curriculum text
 * (lib/rag/curriculum-seed.ts, the Ministry wording) — `basis` quotes the
 * phrase it rests on — and from the owner's decisions of 2026-09-26, marked
 * "owner:". Nothing here is stretched to fill a format the text does not
 * name. Where no format fits, the topic is UNSERVED (hidden from the map,
 * never generated or served) rather than filled with something foreign.
 *
 * READ IT AS A LIST: docs/topic-formats.md is generated from this module
 * (scripts/print-topic-formats.ts) and a test keeps the two identical.
 *
 * `explain_thinking` ("explain how you worked it out") is allowed only where
 * the text names a computation or procedure there is something to explain.
 *
 * No runtime imports: this is read by the client (the map, the picker) and
 * the server (generation, admission, serving) alike.
 */

export type FormatCondition =
  /** number_line_placement only when the exercise involves an operation
   *  (owner G5): placing a stated number is not adding or subtracting. */
  "number-line-needs-operation";

export interface TopicFormatRule {
  /** Formats this topic may use. Empty only when `unserved`. */
  formats: readonly ExerciseSubtype[];
  /** Operations an exercise under this topic may use (math only; Hebrew []). */
  operations: readonly Operation[];
  conditions?: readonly FormatCondition[];
  /** Set when no format fits: the topic is hidden from the map and never
   *  generated, banked or served. The reason is shown in the table doc. */
  unserved?: string;
  /** The curriculum phrase(s) and owner decisions this entry rests on. */
  basis: string;
}

const NL_NEEDS_OP: readonly FormatCondition[] = ["number-line-needs-operation"];

export const TOPIC_FORMATS: Readonly<Record<string, TopicFormatRule>> = {
  // ------------------------------------------------------------ math, grade א
  "math-a-numbers-0-100": {
    formats: ["pattern_completion", "number_line_placement"],
    operations: [],
    basis: "'ספירה בדילוגים של 2, 5 ו-10', 'הכרת ישר המספרים ועבודה עם סדרות (חוקיות)'; owner: skip-counting allowed under numbers topics",
  },
  "math-a-addition-subtraction": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance", "explain_thinking", "number_line_placement"],
    operations: ["add", "sub"],
    conditions: NL_NEEDS_OP,
    basis: "'הצגת מצבים של חיבור… וחיסור… בשפה מתמטית', 'חיבור וחיסור בתחום ה-20… ה-100'; owner G5: number line only with an operation",
  },
  "math-a-geometry": {
    formats: ["shape_match", "fill_in_blank"],
    operations: ["add"],
    basis: "'מיון מצולעים… לפי צלעות', 'פירוק והרכבה של מצולעים'; owner: shape patterns + counting sides/vertices only; owner G3: computation with addition is the counting container (e.g. 'משולש וריבוע, כמה צלעות? 3+4')",
  },
  "math-a-length": {
    formats: ["number_line_placement"],
    operations: [],
    basis: "'השוואה ישירה של אורכי עצמים', 'יחידת מידה סטנדרטית (סנטימטר)'; owner G2: measurement only (ruler / number line), no adding or subtracting lengths in grade א",
  },
  "math-a-time": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance", "explain_thinking"],
    operations: ["add", "sub"],
    basis: "'קריאת שעון… חישובי משך זמן', 'חיבור וחיסור בתחום ה-20 מיושם על שאלות מילוליות הקשורות למדידת זמן'",
  },
  "math-a-data": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance"],
    operations: ["add", "sub"],
    basis: "'קריאת נתונים מוצגים בדיאגרמת עמודות'; owner G2: computation / pick-operation / equation with the data given in words in the question (the app draws no charts)",
  },
  // ------------------------------------------------------------ math, grade ב
  "math-b-numbers-0-1000": {
    formats: ["pattern_completion", "number_line_placement"],
    operations: [],
    basis: "'ספירה בדילוגים של 2, 5, 10, 20, 50 ו-100', 'המבנה העשרוני'; owner: skip-counting allowed; owner G1: no grouping/division under numbers",
  },
  "math-b-arithmetic": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance", "explain_thinking", "visual_grouping", "number_line_placement"],
    operations: ["add", "sub", "mul", "div"],
    conditions: NL_NEEDS_OP,
    basis: "'חיבור וחיסור במאונך', 'תחילת הכפל: הכפל כחיבור חוזר', 'תחילת החילוק… חילוק לחלקים וחילוק לחלוקות'; owner G4: no sequences here; owner G5: number line only with an operation",
  },
  "math-b-geometry": {
    formats: ["shape_match", "fill_in_blank"],
    operations: ["add"],
    basis: "'מיון משולשים לפי סוגי צלעות… ולפי זוויות', 'פירוק והרכבה של מצולעים'; owner: shape patterns + counting sides/vertices only; owner G3: addition as the counting container",
  },
  "math-b-length": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance", "number_line_placement", "explain_thinking"],
    operations: ["add", "sub"],
    basis: "'מדידת אורך וסרטוט קווים ישרים לפי אורך נתון', 'חישוב אורך של קו שבור על ידי סיכום אורכי הקטעים'; owner: length = add/subtract lengths only, no sequences",
  },
  "math-b-volume": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance", "explain_thinking"],
    operations: ["add", "mul"],
    basis: "'חישוב מספר הקוביות המרכיבות תיבה באמצעות כפל מספר הקוביות בשכבה במספר השכבות'; owner: layers × cubes allowed (e.g. 6×4), no division. add: counting cubes layer by layer, and the other choice a pick-operation needs",
  },
  "math-b-time": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance", "explain_thinking"],
    operations: ["add", "sub"],
    basis: "'קריאת שעון בשעות, חצאי שעות ודקות', 'חישובי משך זמן… (לוח זמנים, שעת התחלה וסיום של פעילות)'",
  },
  "math-b-data": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance"],
    operations: ["add", "sub"],
    basis: "'קריאה ובניית דיאגרמות עמודות… המאפשרות השוואה (\"יותר\", \"פחות\", \"הכי הרבה\")'; owner G2: data given in words in the question",
  },
  // ------------------------------------------------------------ math, grade ג
  "math-g-numbers-0-10000": {
    formats: ["pattern_completion", "number_line_placement"],
    operations: [],
    basis: "'ספירה ומנייה בדילוגים שונים', 'זיהוי חוקיות ברצף המספרים'; owner: skip-counting allowed under numbers topics",
  },
  "math-g-gematria": {
    formats: ["explain_thinking"],
    operations: [],
    basis: "'הכרת ערכי האותיות… והשוואה בין השיטה העשרונית… לבין שיטת הגימטרייה'; owner G2: explain format only, no summing of letter values in grade ג",
  },
  "math-g-arithmetic": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance", "explain_thinking", "number_line_placement"],
    operations: ["add", "sub"],
    conditions: NL_NEEDS_OP,
    basis: "'חיבור וחיסור במאונך… בתחום הרבבה', 'אומדן', 'משוואות ואי-שוויונות (34+___=36+___)'; owner G5: number line only with an operation",
  },
  "math-g-multiplication-division": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance", "explain_thinking", "visual_grouping", "number_line_placement"],
    operations: ["add", "sub", "mul", "div"],
    conditions: NL_NEEDS_OP,
    basis: "'כפל וחילוק ב-10, 100 ו-1,000', 'חילוק עם שארית… חילוק לחלקים לחילוק לחלוקות', 'חוק הפילוג… סדר פעולות החשבון' (hence + and −); owner G4: skip-counting sequences only under numbers topics; owner G5: number line only with an operation",
  },
  "math-g-geometry": {
    formats: ["shape_match", "fill_in_blank"],
    operations: ["add"],
    basis: "'הכרת סוגי זוויות', 'סיווג משולשים לפי סוגי צלעות וזוויות'; owner: shape patterns + counting sides/vertices; owner G3: addition as the counting container (a classifying format is follow-on work)",
  },
  "math-g-area": {
    formats: ["fill_in_blank"],
    operations: ["add"],
    basis: "'מדידת שטח ביחידות מידה שרירותיות ולבסוף… סנטימטר-רבוע'; owner G2: computation with addition only (counting units), no multiplication",
  },
  "math-g-volume": {
    formats: [],
    operations: [],
    unserved: "the grade-ג text is nets only ('פריסה של תיבה') and no nets format exists (owner G2)",
    basis: "'המשך העיסוק בתיבות וקוביות, כולל פריסה של תיבה'",
  },
  "math-g-time": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance", "explain_thinking"],
    operations: ["add", "sub"],
    basis: "'קריאת שעות ודקות בשעון אנלוגי ודיגיטלי, כולל חישובי משך זמן'",
  },
  "math-g-data": {
    formats: ["fill_in_blank", "pick_operation", "equation_balance"],
    operations: ["add", "sub", "mul"],
    basis: "'דיאגרמות עמודות ופיקטוגרמות, כולל… קנה-מידה (כל סמל מייצג יותר מיחידה אחת)' (hence ×); owner G2: data given in words in the question",
  },
  // ------------------------------------------------------------ Hebrew, grade א
  "hebrew-a-alphabet-phonology": {
    formats: ["phonemic_visual_mc", "word_build"],
    operations: [],
    basis: "'מודעות פונולוגית — היכולת לזהות ולתפעל יחידות צליליות', 'שמות האותיות ומקשרים ביניהם לצלילים', 'יסודות הקריאה והכתיבה'",
  },
  "hebrew-a-early-reading": {
    formats: ["comprehension"],
    operations: [],
    basis: "'ההבנה מתפתחת… הקשבה לסיפור, ולסוגי טקסט שונים', 'הבנת הנקרא'",
  },
  "hebrew-a-early-writing": {
    formats: ["word_build", "vowel_select_mc"],
    operations: [],
    basis: "'כתיב פונטי (\"מה שאני שומע אני כותב\")', 'מודעות פונולוגית לתנועות עצמן'",
  },
  "hebrew-a-oral-vocabulary": {
    formats: ["comprehension"],
    operations: [],
    basis: "'הרחבה… של אוצר המילים… בהקשרים משמעותיים'; owner G2: only the parts the text names — the oral-discourse part has no format",
  },
  // ------------------------------------------------------------ Hebrew, grade ב
  "hebrew-b-standard-orthography": {
    formats: ["spelling_correction_mc"],
    operations: [],
    basis: "'להקנות במפורש חוקי כתיב', 'זוגות אותיות הומופוניות'; owner G6: dedicated spelling format only — comprehension as a container is banned",
  },
  "hebrew-b-metalinguistic": {
    formats: ["root_pattern_mc"],
    operations: [],
    basis: "'זיהוי מוספיות… זיהוי תבניות שורש ומשקל'; owner G6: dedicated root/pattern format only — comprehension as a container is banned",
  },
  "hebrew-b-reading-fluency-literature": {
    formats: ["comprehension"],
    operations: [],
    basis: "'שטף הקריאה', 'יצירות ספרות מגוונות', 'קריאה עצמאית לשם הנאה'; owner: Hebrew reading = comprehension formats only (no root/spelling drills)",
  },
  // ------------------------------------------------------------ Hebrew, grade ג
  "hebrew-g-reading-comprehension": {
    formats: ["comprehension"],
    operations: [],
    basis: "'הפקת משמעות מטקסטים עיוניים', 'הבחנה בין רעיון מרכזי לפרטים תומכים'",
  },
  "hebrew-g-literary-texts-reading-pleasure": {
    formats: ["comprehension"],
    operations: [],
    basis: "'לזהות מרכיבי סיפור — דמויות, עלילה, מקום'",
  },
  "hebrew-g-vocabulary": {
    formats: ["comprehension"],
    operations: [],
    basis: "'להסיק את משמען [של מילים] מן ההקשר'",
  },
  "hebrew-g-writing-process": {
    formats: ["spelling_correction_mc", "sentence_order"],
    operations: [],
    basis: "'ליישם כללי כתיב ופיסוק', 'תשומת לב… למבנה משפט'; owner G2: only the parts the text names — the planning/drafting process has no format",
  },
  "hebrew-g-oral-expression": {
    formats: [],
    operations: [],
    unserved: "oral presentation, argument and discussion — no exercise format fits (owner G2)",
    basis: "'ארגון והצגת דברור קצר', 'הבעת דעה תוך מתן נימוקים', 'השתתפות בדיון כיתתי'",
  },
  "hebrew-g-metalinguistic": {
    formats: ["root_pattern_mc", "spelling_correction_mc"],
    operations: [],
    basis: "'זיהוי שורש משותף', 'זיהוי מוספיות נפוצות', '…לכתיב נכון בכתיבה'; owner G6: dedicated formats only — comprehension as a container is banned",
  },
};

const EMPTY: TopicFormatRule = { formats: [], operations: [], basis: "" };

/** The rule for a topic id; an unknown id gets an empty rule (nothing allowed). */
export function topicRule(topicId: string): TopicFormatRule {
  return TOPIC_FORMATS[topicId] ?? EMPTY;
}

export function allowedFormats(topicId: string): readonly ExerciseSubtype[] {
  return topicRule(topicId).formats;
}

/** Whether a topic is served at all: known, with at least one format. */
export function isServedTopic(topicId: string): boolean {
  const rule = TOPIC_FORMATS[topicId];
  return !!rule && !rule.unserved && rule.formats.length > 0;
}

export function hasCondition(topicId: string, condition: FormatCondition): boolean {
  return topicRule(topicId).conditions?.includes(condition) ?? false;
}
