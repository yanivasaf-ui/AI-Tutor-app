import type { Grade } from "@/lib/exercises/types";
import type { KidGender } from "@/lib/memory/types";
import { isGrade } from "./grade";

/**
 * The input a new kid is created from, validated. A kid is never created
 * without a grade (QA 2026-09-27: a kid with grade NULL silently gets
 * grade-א topics) — the grade is one of the product's grades (א, ב, ג:
 * the kids.grade CHECK constraint, the topic map and the bank agree).
 */
export interface NewKid {
  name: string;
  avatarId: string | null;
  grade: Grade;
  gender: KidGender | null;
}

export type NewKidResult = { ok: true; kid: NewKid } | { ok: false; error: string };

const isGender = (v: unknown): v is KidGender => v === "boy" || v === "girl";

export function validateNewKid(body: unknown): NewKidResult {
  const b = (body ?? {}) as { name?: unknown; avatarId?: unknown; grade?: unknown; gender?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };
  if (!isGrade(b.grade)) return { ok: false, error: "grade is required: א, ב or ג" };
  if (b.gender != null && !isGender(b.gender)) return { ok: false, error: "gender must be boy or girl" };
  return {
    ok: true,
    kid: { name, avatarId: typeof b.avatarId === "string" ? b.avatarId : null, grade: b.grade, gender: isGender(b.gender) ? b.gender : null },
  };
}
