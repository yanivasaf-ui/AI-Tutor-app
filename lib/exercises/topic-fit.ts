import type { Exercise } from "./types";

/**
 * Does this exercise actually BELONG to the topic it is filed under?
 *
 * BUG B (see docs/investigations/BUG-B-topic-boundary.md). An exercise's
 * `topic_id` is stamped by whoever asked for it, so a tag says "this was
 * requested for topic T", never "this is about T". Bank admission
 * (bank-guard.ts) checks that an exercise agrees with ITSELF; nothing
 * checked that it agrees with its topic. The result, measured on the live
 * bank: "כמה זה 15 - 7 + 4?" filed under measuring time, "כמה זה 5 + 3?" under
 * gematria, "כמה זה 12 × 8?" under area — correctly tagged, entirely
 * off-topic, and served.
 *
 * This gives "belongs to the topic" a definition in code, checked at
 * admission (generate.ts), at serving (store.ts) and by the audit script.
 *
 * WHAT IT CHECKS, and — deliberately — what it does not:
 *  - Content topics (geometry, length, time, data, area, volume, gematria):
 *    the exercise's text must use the topic's own vocabulary at least once.
 *    The vocabulary comes from the Ministry's wording in
 *    lib/rag/curriculum-seed.ts, not from invention.
 *  - Arithmetic topics: their subject IS computation, so a bare
 *    "כמה זה 7 + 5?" is exactly on-topic there. Passed as-is.
 *  - Multiplication/division: must involve multiplication or division.
 *  - Hebrew topics: NOT CHECKED. Their subject is language skills, with no
 *    reliable vocabulary a wrong list of which would reject good exercises.
 *    The leak was measured in math; whether Hebrew topics leak into EACH
 *    OTHER is unmeasured, and this module says so rather than guessing.
 *
 * It is a VOCABULARY check. It catches "no topic content at all", which is
 * the demonstrated failure. It cannot tell an exercise that mentions
 * triangles but tests addition from one that tests triangles.
 *
 * Erring lenient is safe by construction: a rejected good exercise is merely
 * not served (the bank has ~30 per topic, and admission regenerates), while a
 * wrongly accepted one is the bug. So anchors are broad, and a rejection is
 * a reason to look, not proof of a bad exercise.
 */

export interface FitResult {
  ok: boolean;
  /** False when this topic has no fit rule (Hebrew, unknown ids): "ok"
   *  there means "nothing was checked", not "verified on-topic". */
  checked: boolean;
  reason?: string;
}

/** Topics whose subject is computation itself. A bare computation is the
 *  on-topic content here, so it passes. (Checked against the live bank: no
 *  out-of-scope operators or ranges in any of them.) */
export const ARITHMETIC_TOPICS: ReadonlySet<string> = new Set([
  "math-a-numbers-0-100",
  "math-a-addition-subtraction",
  "math-b-numbers-0-1000",
  "math-b-arithmetic",
  "math-g-numbers-0-10000",
  "math-g-arithmetic",
]);

/** Emoji the generator uses to draw shapes. */
const SHAPE_EMOJI = ["🔺", "🔻", "🔷", "🔶", "🔸", "🔹", "⬛", "⬜", "◼", "◻", "🟦", "🟥", "🟩", "🟨", "🟧", "🟪", "⭕", "🔵", "🔴", "🟢", "🟡", "▲", "△", "□", "■", "◇", "◆"];

const GEOMETRY = [
  "צורה", "צורות", "משולש", "ריבוע", "מרובע", "מלבן", "עיגול", "מעגל", "מעוין", "מחומש", "משושה", "מצולע",
  "צלע", "צלעות", "פינה", "פינות", "קדקוד", "זווית", "זוויות", "שווה-צלעות", "שווה-שוקיים", "ישר-זווית",
  "חדה", "קהה", "ישרה", "מקבילית", "טרפז", "אלכסון",
  // Solids. A cube is a shape: without these, a real bank row ("יעל בונה
  // מגדל מקוביות...") was rejected from a geometry topic for naming one.
  // Shared with VOLUME on purpose — the word is on-topic in both.
  "קובייה", "קוביות", "תיבה", "תיבות", "כדור", "גליל", "חרוט", "פירמידה", "מנסרה",
];
const LOCATION = ["מפה", "מפות", "כיוון", "כיוונים", "ימינה", "שמאלה", "מיקום", "מתחת", "מעל", "ליד"];
const LENGTH = [
  "אורך", "אורכים", "רוחב", "גובה", "גבוה", "נמוך", "ארוך", "קצר", "עבה", "דק", "מדד", "מדידה", "מדידות",
  "מודד", "אטב", "צעד", "צעדים", "סנטימטר", "מטר", "סרגל", "קו", "קווים", "קוים", "קטע", "קטעים", "מרחק", "רחוק", "קרוב",
  'ס"מ', 'מ"מ', 'ק"מ',
];
const TIME = [
  "שעון", "שעה", "שעות", "דקה", "דקות", "שנייה", "שניות", "זמן", "משך", "יום", "ימים", "שבוע", "שבועות",
  "חודש", "חודשים", "שנה", "לוח", "בוקר", "צהריים", "אחר הצהריים", "ערב", "לילה", "אתמול", "מחר", "עונה",
  "עונות", "חורף", "אביב", "קיץ", "סתיו", "נמשך", "נמשכת", "רבע",
];
const DATA = [
  "דיאגרמה", "דיאגרמת", "דיאגרמות", "עמודה", "עמודות", "נתון", "נתונים", "סקר", "טבלה", "טבלת", "תרשים",
  "גרף", "פיקטוגרמה", "פיקטוגרמות", "סמל", "סמלים", "קנה-מידה", "קנה מידה", "איסוף", "אספנו", "נאספו",
  "ספרנו", "סופרים", "ספירה", "מיון", "מיינו", "מיינ", "הכי הרבה", "הכי פחות",
  // Survey wording the bank's data exercises use for "we counted / here are the results".
  "ספרו", "ספרה", "סופרת", "מנתה", "מנו", "תוצאות", "רשמה", "רשמו", "נספרו",
];
const AREA = [
  "שטח", "שטחים", 'סמ"ר', "רשת", "מלבן", "ריבוע", "ריבועי", "ריצוף", "אריח", "אריחים", "מרצפת", "מרצפות",
  "כיסוי", "מכסה", "סנטימטר רבוע", "מטר רבוע", 'מ"ר',
];
const VOLUME = [
  "קובייה", "קוביות", "תיבה", "תיבות", "שכבה", "שכבות", "מגדל", "מגדלים", "מבנה", "מבנים", "גוף", "גופים",
  "נפח", "פריסה", "ליטר", "ליטרים", 'סמ"ק',
];
const GEMATRIA = ["גימטרי", "גימטריה", "גימטרייה", "אות", "אותיות", "ערכי האות", "ערך האות", "ערך גימטרי"];
const MULT_DIV = [
  "כפל", "חילוק", "חלוקה", "לחלק", "מחלק", "כפולה", "כפולות", "מכפלה", "מכפלות", "מנה", "שארית",
  "גורם", "גורמים", "קבוצות שוות", "פי ", "התחלקות", "מתחלק",
];

/**
 * Per content topic: the vocabulary at least one word of which must appear.
 * Hebrew words are matched as WORD PREFIXES with the one-letter prefixes
 * (ה ו ב ל מ ש כ) tolerated, so "המשולשים" and "בצלעות" match "משולש" and
 * "צלע". Geometry is shared across grades; the grade differences are in
 * difficulty, not vocabulary.
 */
export const TOPIC_ANCHORS: Readonly<Record<string, readonly string[]>> = {
  "math-a-geometry": [...GEOMETRY, ...LOCATION, ...SHAPE_EMOJI],
  "math-b-geometry": [...GEOMETRY, ...SHAPE_EMOJI],
  "math-g-geometry": [...GEOMETRY, ...SHAPE_EMOJI],
  "math-a-length": LENGTH,
  "math-b-length": LENGTH,
  "math-a-time": TIME,
  "math-b-time": TIME,
  "math-g-time": TIME,
  "math-a-data": DATA,
  "math-b-data": DATA,
  "math-g-data": DATA,
  "math-g-area": AREA,
  "math-b-volume": VOLUME,
  "math-g-volume": VOLUME,
  "math-g-gematria": GEMATRIA,
  "math-g-multiplication-division": MULT_DIV,
};

/** Regexes that count as an anchor for a topic, alongside the words. */
const TOPIC_PATTERNS: Readonly<Record<string, readonly RegExp[]>> = {
  "math-a-time": [/\d{1,2}:\d{2}/],
  "math-b-time": [/\d{1,2}:\d{2}/],
  "math-g-time": [/\d{1,2}:\d{2}/],
  // A single Hebrew letter with its value: א' (1), ה' שווה ל-5.
  "math-g-gematria": [/(?:^|[^א-ת])[א-ת]['(]/],
};

const HEBREW = "א-ת";
const PREFIX_LETTERS = "הובלמשכ"; // ה ו ב ל מ ש כ

/**
 * A three-letter anchor is a prefix of a lot of unrelated words: "אות" (letter)
 * begins "אותם" (them), "קו" (line) begins "קודם" (before), "מנה" begins
 * "מנהל". Matched as bare prefixes they would let an off-topic exercise pass
 * on a pronoun. So anchors of up to three letters must END the word, with only
 * a plural allowed after them. Longer anchors are prefix-matched so their
 * inflections ("מדדנו", "המשולשים") still count. Exempt: "מדד" (mostly a verb
 * stem) and "פי " (a phrase that already carries its own boundary).
 */
const SHORT_ANCHOR_MAX = 3;
const SHORT_ANCHOR_EXEMPT: ReadonlySet<string> = new Set(["מדד", "פי "]);
const SHORT_ANCHOR_TAIL = `(?:ים|ות)?(?![${HEBREW}])`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Gershayim/geresh variants folded to plain ASCII quotes so ס״מ == ס"מ. */
function normalizeQuotes(s: string): string {
  return s.replace(/[״“”]/g, '"').replace(/[׳‘’]/g, "'");
}

/** Everything a kid reads or taps in an exercise. */
export function exerciseText(ex: Exercise): string {
  const parts: string[] = [ex.question];
  if (ex.passage) parts.push(ex.passage);
  if (ex.choices) parts.push(...ex.choices);
  if (ex.tiles?.items) parts.push(...ex.tiles.items.map(String));
  if (ex.grouping?.items) parts.push(...ex.grouping.items.map(String));
  return normalizeQuotes(parts.join(" \n "));
}

/** The regex source for a topic's anchors, or null when it has none. Exported
 *  so the offline audit and the SQL used to calibrate against the bank are
 *  generated from this one definition rather than re-typed. */
export function anchorSource(topicId: string): string | null {
  const words = TOPIC_ANCHORS[topicId];
  if (!words) return null;
  const alts = words.map((w) => {
    const body = escapeRegExp(normalizeQuotes(w));
    if (!/[א-ת]/.test(w)) return body; // emoji, symbols: match anywhere
    // Hebrew: a left boundary (start, or a non-Hebrew-letter), optional
    // one-letter prefixes, then either a prefix match or, for short words, a
    // whole-word match.
    const short = w.length <= SHORT_ANCHOR_MAX && !SHORT_ANCHOR_EXEMPT.has(w);
    return `(?:^|[^${HEBREW}])[${PREFIX_LETTERS}]{0,2}${body}${short ? SHORT_ANCHOR_TAIL : ""}`;
  });
  return alts.join("|");
}

/** Compiled once per topic. */
const compiled = new Map<string, RegExp>();
function anchorRegex(topicId: string): RegExp | null {
  const cached = compiled.get(topicId);
  if (cached) return cached;
  const source = anchorSource(topicId);
  if (!source) return null;
  const re = new RegExp(source, "u");
  compiled.set(topicId, re);
  return re;
}

/** Does the computation (if any) use multiplication or division? Operators
 *  are stored as ASCII ("*" and "/"), whatever sign the question displays. */
function usesMulDiv(ex: Exercise): boolean {
  const ops = ex.computation?.operators ?? [];
  return ops.some((o) => o === "*" || o === "/");
}

/**
 * Whether `ex` belongs to `topicId`. `topicId` is passed explicitly rather
 * than read from `ex.topicId` because a freshly generated draft is not yet
 * stamped with one, and because the question being asked is "does this fit
 * the topic it was requested for".
 */
export function topicFit(ex: Exercise, topicId: string | undefined): FitResult {
  if (!topicId) return { ok: true, checked: false };
  if (ARITHMETIC_TOPICS.has(topicId)) return { ok: true, checked: true };

  const re = anchorRegex(topicId);
  if (!re) return { ok: true, checked: false }; // Hebrew topics, unknown ids

  const text = exerciseText(ex);
  if (re.test(text)) return { ok: true, checked: true };
  if ((TOPIC_PATTERNS[topicId] ?? []).some((p) => p.test(text))) return { ok: true, checked: true };

  // Multiplication/division is also on-topic when the exercise actually
  // computes with it, even if the wording is bare ("כמה זה 60 ÷ 10?").
  if (topicId === "math-g-multiplication-division" && (usesMulDiv(ex) || /[×÷*]/.test(text))) {
    return { ok: true, checked: true };
  }
  // ...and so is skip counting, which is how the curriculum reaches
  // multiplication in grade ג: "10, 20, 30, ..." is a run of multiples, and
  // four real bank rows of exactly that shape were being rejected for
  // carrying no multiplication WORD. A pattern_completion here is a number
  // sequence by construction, so accept the subtype rather than trying to
  // re-derive the common difference from the tiles.
  if (topicId === "math-g-multiplication-division" && ex.subtype === "pattern_completion") {
    return { ok: true, checked: true };
  }

  return {
    ok: false,
    checked: true,
    reason: `no ${topicId} content: the exercise never uses this topic's own vocabulary`,
  };
}
