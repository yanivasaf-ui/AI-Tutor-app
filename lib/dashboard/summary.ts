import type { Grade } from "@/lib/exercises/types";

/**
 * The parent dashboard's per-subject summary, as it may be shown.
 *
 * The summary is model-written and carried forward exchange to exchange
 * (lib/memory/update.ts), so it can name the grade it was written under —
 * "מתאים לכיתה ב" — long after the kid's grade changed (QA 2026-09-27:
 * still "כיתה ב" after ב→ג→NULL). A grade change in the app clears it
 * (app/api/kids), but a grade can also change outside the app (an admin
 * script), and old rows exist. So at display time: a summary that names
 * any grade other than the kid's current one is not shown. One that names
 * no grade is shown as is.
 */
const GRADE_MENTION = /כיתה\s*([אבג])(?=['׳"״]|[^א-ת]|$)/gu;

export function gradesNamed(summary: string): Grade[] {
  return [...summary.matchAll(GRADE_MENTION)].map((m) => m[1] as Grade);
}

export function summaryForDisplay(summary: string | null | undefined, grade: Grade | null): string | null {
  if (!summary?.trim()) return null;
  return gradesNamed(summary).some((g) => g !== grade) ? null : summary;
}
