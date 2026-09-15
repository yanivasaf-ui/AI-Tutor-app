import type { Grade } from "@/lib/exercises/types";

export const GRADES: Grade[] = ["א", "ב", "ג"];

/** Where the grade lived before kids.grade existed. Read only, to backfill
 *  the server column for kids created back then; never written anymore. */
const LEGACY_GRADE_STORAGE_PREFIX = "ai-tutor-grade-";

export function isGrade(v: unknown): v is Grade {
  return v === "א" || v === "ב" || v === "ג";
}

export function readLegacyStoredGrade(kidId: string): Grade | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LEGACY_GRADE_STORAGE_PREFIX + kidId);
    return isGrade(v) ? v : null;
  } catch {
    return null;
  }
}

/** The server's grade, else this device's legacy copy, else grade א. */
export function resolveGrade(kid: { id: string; grade: Grade | null }): Grade {
  return kid.grade ?? readLegacyStoredGrade(kid.id) ?? "א";
}
