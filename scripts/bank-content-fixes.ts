/**
 * Bank content-quality fixes, 2026-09-27 — a REVIEWED script, not run.
 * Nothing here touches the database by itself.
 *
 *   npx tsx scripts/bank-content-fixes.ts --sql   prints one guarded transaction
 *
 * Every UPDATE matches the row's id AND its current text, so a row changed
 * since this audit is left alone (the statement updates 0 rows) instead of
 * being overwritten. All the new Hebrew is UDI REVIEW.
 *
 * Only rows that are STILL SERVED on this branch are here. The defective
 * rows already out of serving need no content fix: the allowed-format
 * table or an unserved topic refuses them (the format cleanup,
 * scripts/audit-format-fit.ts query C, removes them), or the topic-fit
 * check does (5e3330c2), or the quality gate now does. See
 * docs/bank-content-audit-2026-09-27.md.
 */

export interface ContentFix {
  id: string;
  /** The QA class: a answer-in-stem, b impossible, c two-valid, d gender, e typo/copy, f circular. */
  class: "a" | "b" | "c" | "d" | "e" | "f";
  what: string;
  before: { question: string; choices?: string[] };
  after: { question: string; choices?: string[] };
}

export const CONTENT_FIXES: ContentFix[] = [
  {
    id: "719065d0-f5da-476e-80be-de83ead3542e",
    class: "e",
    what: "typo: 'עניבים' (neckties) for 'ענבים' (grapes) in a fruit list",
    before: {
      question: "בכיתה ספרו כמה ילדים אוהבים כל פרי:\n🍎 תפוחים: 5 ילדים\n🍌 בננות: 8 ילדים\n🍊 תפוזים: 3 ילדים\n🍇 עניבים: 6 ילדים\n\nכמה ילדים יותר אוהבים בננות מאשר תפוזים?\n8 - 3 = ___",
    },
    after: {
      question: "בכיתה ספרו כמה ילדים אוהבים כל פרי:\n🍎 תפוחים: 5 ילדים\n🍌 בננות: 8 ילדים\n🍊 תפוזים: 3 ילדים\n🍇 ענבים: 6 ילדים\n\nכמה ילדים יותר אוהבים בננות מאשר תפוזים?\n8 - 3 = ___",
    },
  },
  {
    id: "d69ffd9f-d389-48c6-99d0-695d3e9c6027",
    class: "d",
    what: "gender: 'לרון … היא רוצה' — רון is a boy",
    before: { question: "לרון יש 35 מדבקות. היא רוצה לחלק אותן שווה בשווה ל-5 חברות. כמה מדבקות תקבל כל חברה? 35 ÷ 5 = ___" },
    after: { question: "לרון יש 35 מדבקות. הוא רוצה לחלק אותן שווה בשווה ל-5 חברות. כמה מדבקות תקבל כל חברה? 35 ÷ 5 = ___" },
  },
  {
    id: "489e88bf-02e6-4afa-90dd-047fc51fbe3f",
    class: "d",
    what: "gender: 'לאורי … היא רוצה' — אורי is a boy",
    before: { question: "לאורי יש 24 מדבקות. היא רוצה לחלק אותן שווה ל-6 חברות. כמה מדבקות תקבל כל חברה? 24 ÷ 6 = ___" },
    after: { question: "לאורי יש 24 מדבקות. הוא רוצה לחלק אותן שווה ל-6 חברות. כמה מדבקות תקבל כל חברה? 24 ÷ 6 = ___" },
  },
];

/** A Postgres escape-string literal, one line: E'…\n…'. */
const lit = (s: string) => `E'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
const arr = (xs: string[]) => `ARRAY[${xs.map(lit).join(", ")}]::text[]`;

export function fixesSql(fixes: ContentFix[] = CONTENT_FIXES): string {
  const lines = [
    "-- Bank content-quality fixes, 2026-09-27. Reviewed script; run by hand.",
    "-- Each UPDATE only matches a row whose current text is exactly the audited 'before'.",
    "begin;",
  ];
  for (const f of fixes) {
    const sets = [`question = ${lit(f.after.question)}`];
    const where = [`id = ${lit(f.id)}`, `question = ${lit(f.before.question)}`];
    if (f.after.choices) sets.push(`choices = ${arr(f.after.choices)}`);
    if (f.before.choices) where.push(`choices = ${arr(f.before.choices)}`);
    lines.push(`-- (${f.class}) ${f.what}`, `update exercises set ${sets.join(", ")} where ${where.join(" and ")};`);
  }
  lines.push("-- Expect exactly " + fixes.length + " rows updated in total; if not, roll back and re-audit.", "commit;");
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("bank-content-fixes.ts") && process.argv[2] === "--sql") {
  console.log(fixesSql());
}
