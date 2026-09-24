/**
 * Star -> apple, for the group-division bank rows.
 *
 * WHY THIS EXISTS. The reward audit (docs/investigations/reward-audit.md)
 * found ⭐ doing two jobs: the app's old reward currency, and the object a
 * child divides into piles in grouping exercises. The reward displays are
 * gone; the bank rows still say "stars". This rewrites them to apples.
 *
 * It is a WORD swap as well as an emoji swap, deliberately. Every affected
 * row pairs the emoji in `grouping.items` with the Hebrew word "כוכבים" in
 * the question, and for grades א-ב that question is read aloud. Swapping
 * only the emoji would tell a child to divide "stars" while showing apples.
 *
 * GRAMMAR. כוכב and תפוח are both masculine, so the plural, the definite
 * form (הכוכבים -> התפוחים) and any agreeing adjective need no change beyond
 * the noun. The one exception is an adjective that only makes sense for a
 * star ("נוצצים" - sparkling), which a mechanical swap would leave attached
 * to an apple. Such a row FAILS CLOSED and needs an explicit override
 * rather than shipping nonsense.
 *
 * NOTHING HERE TOUCHES A DATABASE. It maps a row to a row. The script that
 * wraps it emits SQL for a person to review and run.
 */

export const STAR_EMOJI = "⭐";
export const APPLE_EMOJI = "🍎";
export const STAR_WORD = "כוכבים";
export const APPLE_WORD = "תפוחים";

export interface GroupingData {
  items: string[];
  groupCount: number;
}

export interface BankRow {
  id: string;
  topic_id: string | null;
  question: string;
  grouping: GroupingData;
}

/**
 * Rows a mechanical swap cannot do correctly, keyed by id. The full new
 * question, written by hand.
 *
 * a8246147: "בחנות צעצועים יש 18 כוכבים נוצצים" - sparkling stars in a toy
 * shop. Apples are not sparkling and a toy shop does not stock them, so the
 * setting moves with the noun. It is the only row that needs this, and it
 * is called out in the script's report so a person sees it.
 */
export const OVERRIDES: Readonly<Record<string, string>> = {
  "a8246147-8c61-44bc-9766-8c1b307464bc":
    "בחנות פירות יש 18 תפוחים אדומים. המוכרת צריכה לחלק אותם באופן שווה ל-6 קופסאות מתנה. כמה תפוחים יהיו בכל קופסה?",
};

/** Adjectives that describe a star and would be wrong on an apple. */
const STAR_ONLY_WORDS = ["נוצצ", "זוהר", "מנצנצ", "בוהק"];

export interface SwapResult {
  row: BankRow;
  /** True when the question came from OVERRIDES rather than the mechanical rule. */
  overridden: boolean;
}

export class SwapError extends Error {}

/**
 * The swapped row, or null if it has nothing to swap. Throws SwapError
 * rather than returning a row that still mentions stars.
 */
export function swapRow(row: BankRow): SwapResult | null {
  const hasStar =
    row.grouping.items.includes(STAR_EMOJI) || row.question.includes(STAR_WORD) || row.question.includes(STAR_EMOJI);
  if (!hasStar) return null;

  // Only ever ⭐ items. A grouping row that mixes objects is not one this
  // migration understands, and guessing which to swap is how a wrong row
  // gets written.
  const foreign = row.grouping.items.filter((i) => i !== STAR_EMOJI);
  if (foreign.length > 0) {
    throw new SwapError(`${row.id}: items mix ⭐ with ${JSON.stringify([...new Set(foreign)])}; refusing to guess`);
  }

  const override = OVERRIDES[row.id];
  const question = override ?? row.question.split(STAR_WORD).join(APPLE_WORD).split(STAR_EMOJI).join(APPLE_EMOJI);

  const unfit = STAR_ONLY_WORDS.find((w) => question.includes(w));
  if (unfit) {
    throw new SwapError(`${row.id}: "${unfit}…" describes a star, not an apple; add an explicit override`);
  }

  const next: BankRow = {
    ...row,
    question,
    grouping: { ...row.grouping, items: row.grouping.items.map(() => APPLE_EMOJI) },
  };

  // Fail closed: nothing star-shaped may survive, in the text or the items.
  if (/כוכב/.test(next.question) || next.question.includes(STAR_EMOJI) || next.grouping.items.includes(STAR_EMOJI)) {
    throw new SwapError(`${row.id}: a star survived the swap: ${next.question}`);
  }
  // No shape check here: `items` is rebuilt with map(), which preserves the
  // count by construction, and `groupCount` is spread through untouched, so
  // the per-group answer (items / groupCount) cannot move. A guard comparing
  // them would be unreachable; the tests assert the mechanic is untouched.
  return { row: next, overridden: override !== undefined };
}

// ------------------------------------------------------------------ SQL

/** A dollar-quote tag that does not occur in the text, so no escaping is needed. */
function dollar(text: string): string {
  let tag = "q";
  while (text.includes(`$${tag}$`)) tag += "q";
  return `$${tag}$${text}$${tag}$`;
}

const json = (g: GroupingData) => dollar(JSON.stringify(g)) + "::jsonb";

/**
 * One UPDATE, guarded on the OLD question text. If anyone has edited the
 * row since it was dumped the guard matches nothing and the update is a
 * no-op — a stale migration cannot clobber a newer edit.
 */
export function updateSql(before: BankRow, after: BankRow): string {
  return (
    `update public.exercises set question = ${dollar(after.question)}, grouping = ${json(after.grouping)} ` +
    `where id = '${before.id}' and question = ${dollar(before.question)};`
  );
}

/** The exact inverse: put the original text and items back. */
export function rollbackSql(before: BankRow, after: BankRow): string {
  return updateSql(after, before);
}
