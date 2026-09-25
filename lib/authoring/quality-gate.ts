import type { Exercise } from "@/lib/exercises/types";
import { ruleById, type RuleId } from "./rubric";

/**
 * The question-quality gate: the deterministic half of the authoring rubric
 * (lib/authoring/rubric.ts), checked in code before a math question can
 * reach a child.
 *
 * WHERE IT RUNS (same two places topic-fit.ts runs, for the same reason):
 *  - ADMISSION — lib/exercises/generate.ts, after every existing gate. A
 *    failing draft is thrown as QualityGateError and generateExercise()
 *    asks again with the broken rules named. After the last attempt the
 *    route serves a vetted template instead, or fails; nothing failing
 *    this gate is saved.
 *  - SERVING — lib/exercises/store.ts drops failing bank rows from the
 *    candidate page, so rows already in the table from before this gate
 *    are never handed out either.
 *
 * WHAT IT CATCHES: the shapes code can see reliably — a numeric series
 * with no time/step frame, a series told as a count, division without a
 * sharing or grouping frame, a grouping story whose stated total is not
 * the number of objects drawn, more than one question at once, an answer
 * the question doesn't actually ask for or that isn't uniquely on offer.
 *
 * WHAT IT DOES NOT: whether the Hebrew sounds like a child's, whether the
 * scenario is concrete, most consistency between a story and its numbers.
 * Those are judgment, left to the model review (./quality-review.ts).
 *
 * Math only. Hebrew exercises are returned `checked: false` — the rubric
 * is written for math questions, and saying "ok" there would claim a
 * check that never ran.
 *
 * No runtime imports beyond this directory's rubric data: store.ts reads
 * this, and must not pull the Anthropic SDK in behind it.
 */

export interface QualityViolation {
  rule: RuleId;
  /** What was wrong, specifically, for the log line and the retry hint. */
  detail: string;
}

export interface QualityResult {
  ok: boolean;
  /** False when nothing was checked (non-math). */
  checked: boolean;
  violations: QualityViolation[];
}

/** A draft that fails the gate. Its own type so the retry loop can name the
 *  broken rules in the next request, and the route can tell "the rubric
 *  rejected every draft" from a real fault. */
export class QualityGateError extends Error {
  readonly violations: QualityViolation[];
  constructor(violations: QualityViolation[], question: string) {
    super(`question fails the authoring rubric (${violations.map((v) => v.rule).join(", ")}): "${question}"`);
    this.name = "QualityGateError";
    this.violations = violations;
  }
}

// ---------------------------------------------------------------- Hebrew

const HE = "א-ת";
/** One-letter prefixes a Hebrew word can carry (ה ו ב ל מ ש כ). */
const PFX = "הובלמשכ";
const NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;

/** A regex that matches any of `words` as a whole Hebrew word, with up to
 *  two one-letter prefixes and an optional plural/feminine tail. `\b` does
 *  not work against Hebrew (see lib/feedback/constitution.ts). */
function hebrewWords(words: readonly string[], tail = "(?:ים|ות|ה|ת)?"): RegExp {
  const alts = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?:^|[^${HE}])[${PFX}]{0,2}(?:${alts})${tail}(?![${HE}])`, "u");
}

function plain(text: string): string {
  return text.replace(NIQQUD, "").replace(/[״“”]/g, '"').replace(/[׳‘’]/g, "'");
}

// ---------------------------------------------------------------- numbers

interface NumberToken {
  value: number;
  start: number;
  end: number;
}

/** Numbers as a child reads them. "8,400" is one number (a comma followed
 *  by exactly three digits); "3, 6, 9" is three. */
function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  const re = /\d{1,3}(?:,\d{3})+(?!\d)|\d+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ value: Number(m[0].replace(/,/g, "")), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export interface NumberSeries {
  terms: number[];
  /** Common difference, or null when the run is a list, not a progression. */
  step: number | null;
  start: number;
  end: number;
}

/**
 * Runs of three or more numbers separated only by commas — the written
 * shape of a series ("3, 6, 9, 12" or "3,6,9,12, ___"). A run is a
 * progression when it has one nonzero common difference.
 */
export function numberSeries(text: string): NumberSeries[] {
  const toks = numberTokens(text);
  const runs: NumberToken[][] = [];
  let run: NumberToken[] = [];
  for (const tok of toks) {
    const prev = run[run.length - 1];
    if (prev && /^\s*,\s*$/.test(text.slice(prev.end, tok.start))) {
      run.push(tok);
    } else {
      if (run.length >= 3) runs.push(run);
      run = [tok];
    }
  }
  if (run.length >= 3) runs.push(run);
  return runs.map((r) => {
    const terms = r.map((x) => x.value);
    const d = terms[1] - terms[0];
    const progression = d !== 0 && terms.every((v, i) => i === 0 || v - terms[i - 1] === d);
    return { terms, step: progression ? d : null, start: r[0].start, end: r[r.length - 1].end };
  });
}

// ---------------------------------------------------------------- frames

/** A series that unfolds over time or steps: day after day, jump after
 *  jump, floor after floor. */
const TIME_STEP_FRAME = hebrewWords([
  "יום", "ימים", "בוקר", "שבוע", "שבועות", "חודש", "חודשים", "שנה", "שנים", "שעה", "שעות", "דקה", "דקות", "פעם", "פעמים",
  "שלב", "שלבים", "צעד", "צעדים", "קומה", "קומות", "שורה", "שורות", "תחנה", "תחנות", "סיבוב", "סיבובים",
  "קפיצ", "קופצ", "קופץ", "קפץ", "קפצה", "מדלג", "דילג",
  "ראשון", "ראשונה", "שני", "שנייה", "שלישי", "שלישית", "רביעי", "רביעית", "אחרי", "לפני", "בהתחלה",
], "(?:ים|ות|ה|ת|ם|ן)?");
/** A series explicitly presented as a pattern to continue. Enough to frame
 *  a bare series — but not to redeem one told as a count ("יש לה: 3, 6, 9.
 *  מה הבא?" is still a count of things that exist now). */
const PATTERN_FRAME = hebrewWords([
  "רצף", "סדר", "דפוס", "חוקיות", "תבנית", "המשיכו", "המשך", "תמשיכו", "השלימו", "השלם", "השלימי", "הבא",
], "(?:ים|ות|ה|ת|ם|ן)?");

/** A quantity frame right before a series: "יש לה: 3, 6, 9" reads as a
 *  count of things that exist now, which is the bug the rule names. */
const COUNT_FRAME = new RegExp(
  `(?:^|[^${HE}])(?:יש|יהיו|היו|הנה|אלה|אלו|ספר|ספרה|ספרו|אספ|קיבל|קיבלה|קנה|קנתה)(?![${HE}])[^.?!]{0,40}$`,
  "u"
);

/** Equal-sharing words: the partitive frame ("שווה בשווה ל-3 ילדים"),
 *  including the Ministry books' defective spelling ("שוה בשוה"). */
const EQUAL_SHARE = hebrewWords(["שווה", "שוות", "שווים", "בשווה", "שוה", "שוים", "בשוה"], "");
/** "each"-framing: "כמה יקבל כל ילד", "בכל סל". */
const PER_EACH = hebrewWords(["כל"], "");
/** The quotitive frame: groups of a known size — "בקבוצות של 3", or the
 *  Ministry books' terse "10 בקבוצה. כמה קבוצות?". */
const QUOTITIVE = new RegExp(`[${HE}]+\\s+של\\s*-?\\s*\\d+|\\d+\\s+ב[${HE}]{2,}`, "u");
/** Named groups: a count attached to a noun ("ל-3 סלים", "4 קבוצות",
 *  "שלושה ילדים") — what a bare "כמה זה 60 ÷ 10?" never has. Which of the
 *  story's counts is the group count is not parsed; the grouping check
 *  below does that where the payload says it. */
const NAMED_GROUPS = new RegExp(
  `(?:^|[^${HE}])(?:[לב]\\s*-?\\s*)?(?:\\d+|שתי|שני|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה|עשר|עשרה)\\s+[${HE}]{2,}`,
  "u"
);
/** "how many will each receive": יקבל/תקבל/יקבלו/תקבלנה. */
const PER_GROUP_ASK = hebrewWords(["יקבל", "תקבל", "יקבלו", "תקבלנה"], "");
/** Division by name: חילוק, לחלק, חלקו, מחלק/ת/ים, נחלק, ... */
const DIVISION_WORD = hebrewWords(["חילוק", "לחלק", "חלקו", "חלקי", "מחלק", "מחלקת", "מחלקים", "נחלק", "תחלק", "יחלק", "יחולקו", "חולקו"], "");

function usesDivision(ex: Exercise, text: string): boolean {
  if (ex.subtype === "visual_grouping") return true;
  if (ex.computation?.operators.includes("/")) return true;
  if (ex.subtype === "pick_operation" && /חילוק/.test(ex.correctAnswer)) return true;
  return /÷/.test(text) || DIVISION_WORD.test(text);
}

// ---------------------------------------------------------------- checks

function checkSeries(ex: Exercise, q: string, out: QualityViolation[]): void {
  const progressions = numberSeries(q).filter((s) => s.step !== null);
  for (const s of progressions) {
    const before = q.slice(0, s.start).replace(/[:\s]+$/, "");
    if (COUNT_FRAME.test(before)) {
      // Told as a count ("יש לה: 3, 6, 9, 12"). Only a time/step frame in
      // the SAME sentence, before the series ("ביום הראשון, השני והשלישי
      // היו לה: 3, 6, 9"), makes it a series; a later "כמה יהיו בפעם
      // הבאה?" does not undo having shown it as one amount.
      const sentence = before.split(/[.?!]/).pop() ?? "";
      if (!TIME_STEP_FRAME.test(sentence)) {
        out.push({ rule: "no-series-as-count", detail: `the series ${s.terms.join(", ")} is introduced as a count of things that exist now` });
      }
    } else if (!TIME_STEP_FRAME.test(q) && !PATTERN_FRAME.test(q)) {
      out.push({ rule: "sequence-anchored", detail: `the series ${s.terms.join(", ")} has no time/step frame and is not presented as a pattern` });
    }
  }
}

function checkDivision(ex: Exercise, q: string, out: QualityViolation[]): void {
  if (!usesDivision(ex, q)) return;
  const quotitive = QUOTITIVE.test(q);
  const sharing = EQUAL_SHARE.test(q) || PER_EACH.test(q) || quotitive;
  const named = NAMED_GROUPS.test(q) || quotitive;
  if (!sharing || !named) {
    const missing = [!sharing && "no equal-sharing or grouping frame", !named && "no named groups"].filter(Boolean).join(" and ");
    out.push({ rule: "division-sharing-frame", detail: `division with ${missing}` });
  }
}

const HEBREW_NUMBER_WORDS: Record<string, number> = {
  שתי: 2, שני: 2, שניים: 2, שתיים: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5,
  שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10,
};

function statedNumbers(q: string): Set<number> {
  const s = new Set(numberTokens(q).map((t) => t.value));
  for (const w of q.split(/[^א-ת]+/)) {
    const bare = w.replace(new RegExp(`^[${PFX}]`), "");
    const n = HEBREW_NUMBER_WORDS[w] ?? HEBREW_NUMBER_WORDS[bare];
    if (n) s.add(n);
  }
  return s;
}

function checkGrouping(ex: Exercise, q: string, out: QualityViolation[]): void {
  const g = ex.grouping;
  if (ex.subtype !== "visual_grouping" || !g) return;
  const total = g.items.length;
  const perGroup = g.groupCount > 0 ? total / g.groupCount : NaN;
  if (new Set(g.items).size > 1) {
    out.push({ rule: "internal-consistency", detail: `the objects drawn are not all the same (${[...new Set(g.items)].join(" ")})` });
  }
  const stated = statedNumbers(q);
  if (!stated.has(g.groupCount)) {
    out.push({ rule: "division-sharing-frame", detail: `the question never says how many groups (${g.groupCount})` });
  }
  const strays = [...stated].filter((n) => n !== total && n !== g.groupCount && n !== perGroup);
  if (strays.length > 0 && !stated.has(total)) {
    out.push({
      rule: "internal-consistency",
      detail: `the question says ${strays.join(", ")} but ${total} objects are drawn`,
    });
  }
  // The answer is a per-group count, so some sentence has to ASK for one:
  // "כמה" together with "each" or "receive" — a bare "כמה" elsewhere ("רונן
  // מודד כמה דקות עברו") asks nothing.
  const asksPerGroup = q.split(/[.?!]/).some((sentence) => /כמה/.test(sentence) && (PER_EACH.test(sentence) || PER_GROUP_ASK.test(sentence)));
  if (!asksPerGroup) {
    out.push({ rule: "unambiguous-answer", detail: "the question never asks how many go in each group" });
  }
}

function checkOneTask(q: string, out: QualityViolation[]): void {
  const questions = (q.match(/\?/g) ?? []).length;
  if (questions > 1) out.push({ rule: "one-task", detail: `${questions} questions in one` });
}

function checkChoices(ex: Exercise, out: QualityViolation[]): void {
  if (ex.type !== "multiple_choice" || !ex.choices) return;
  const norm = ex.choices.map((c) => c.trim());
  if (new Set(norm).size !== norm.length) {
    out.push({ rule: "unambiguous-answer", detail: "the same choice is offered twice" });
  }
  const hits = norm.filter((c) => c === ex.correctAnswer.trim()).length;
  if (hits !== 1) {
    out.push({ rule: "unambiguous-answer", detail: `the correct answer appears ${hits} times among the choices` });
  }
}

function checkPatternAnswer(ex: Exercise, q: string, out: QualityViolation[]): void {
  if (ex.subtype !== "pattern_completion") return;
  const s = numberSeries(q).filter((x) => x.step !== null).pop();
  if (!s || s.step === null) return;
  const expected = s.terms[s.terms.length - 1] + s.step;
  if (Number(ex.correctAnswer.replace(/,/g, "")) !== expected) {
    out.push({ rule: "unambiguous-answer", detail: `the series continues to ${expected}, not ${ex.correctAnswer}` });
  }
}

/**
 * Checks one exercise against the deterministic rules. Pure and cheap —
 * no model call — so it runs on every draft and every served bank row.
 */
export function checkQuestionQuality(ex: Exercise): QualityResult {
  if (ex.subject !== "math") return { ok: true, checked: false, violations: [] };
  const q = plain(ex.question);
  const violations: QualityViolation[] = [];
  checkSeries(ex, q, violations);
  checkDivision(ex, q, violations);
  checkGrouping(ex, q, violations);
  checkOneTask(q, violations);
  checkChoices(ex, violations);
  checkPatternAnswer(ex, q, violations);
  return { ok: violations.length === 0, checked: true, violations };
}

/**
 * The next request's corrective line after a rejected draft: each broken
 * rule, in the rubric's own Hebrew, with what went wrong. Internal model
 * instruction, never shown to a child.
 */
export function qualityRetryHint(violations: QualityViolation[]): string {
  const rules = [...new Set(violations.map((v) => v.rule))].map((id) => `- ${ruleById(id).he}`);
  return `התרגיל הקודם נדחה כי הפר את כללי כתיבת השאלות:\n${rules.join("\n")}\nכתבו תרגיל חדש שעומד בכללים האלה.`;
}
