import type { Subject } from "@/lib/memory/types";

/**
 * Kid-scene reskin (2026-09-15): the one per-subject saturated theme,
 * shared by the topic picker and the exercise screen (reskin brief items
 * 2 and 4) so a kid learns "coral is math, purple is Hebrew" once and it
 * holds everywhere that color shows up. Sourced from app/globals.css's
 * math and hebrew color tokens, not redefined here — this is just the
 * lookup by Subject.
 */
export interface SubjectTheme {
  accent: string;
  deep: string;
  bg: string;
  soft: string;
}

export const SUBJECT_THEME: Record<Subject, SubjectTheme> = {
  math: { accent: "var(--color-math)", deep: "var(--color-math-deep)", bg: "var(--color-math-bg)", soft: "var(--color-math-soft)" },
  hebrew: { accent: "var(--color-hebrew)", deep: "var(--color-hebrew-deep)", bg: "var(--color-hebrew-bg)", soft: "var(--color-hebrew-soft)" },
};
