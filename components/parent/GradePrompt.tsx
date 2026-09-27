"use client";

import { useState } from "react";
import { GRADES } from "@/lib/kids/grade";
import type { Grade } from "@/lib/exercises/types";

/**
 * Inline, in the parent dashboard, for a kid who has no grade yet (QA
 * 2026-09-27: a kid with grade NULL silently gets grade-א topics; kids
 * created before the grade was required still have none). Shown only while
 * the grade is missing — once the parent picks one it is saved and never
 * asked again. It blocks nothing: the kid keeps playing with today's
 * behaviour (grade א) until it is set.
 */
export default function GradePrompt({
  kidId,
  kidName,
  onSaved,
}: {
  kidId: string;
  kidName: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState<Grade | null>(null);
  const [error, setError] = useState(false);

  async function choose(grade: Grade) {
    if (saving) return;
    setSaving(grade);
    setError(false);
    try {
      const res = await fetch("/api/kids", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: kidId, grade }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onSaved();
    } catch {
      setError(true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div role="group" aria-label={`בחירת כיתה ל${kidName}`} className="rounded-2xl bg-[var(--color-teal-soft)] p-3 mb-4">
      <p className="font-semibold text-[var(--color-ink)]">באיזו כיתה {kidName}?</p>
      <p className="text-sm text-[var(--color-ink-soft)] mb-2">
        עוד לא נבחרה כיתה, אז בינתיים התרגילים הם של כיתה א׳. אפשר לבחור עכשיו:
      </p>
      <div className="flex gap-2">
        {GRADES.map((g) => (
          <button
            key={g}
            onClick={() => choose(g)}
            disabled={saving !== null}
            className="min-h-11 min-w-16 rounded-[var(--radius-button)] bg-[var(--color-surface)] text-[var(--color-ink)] font-bold shadow-sm disabled:opacity-50"
          >
            {saving === g ? "שומר..." : `כיתה ${g}׳`}
          </button>
        ))}
      </div>
      {error && <p className="text-[var(--color-warm)] text-xs mt-2">לא הצלחנו לשמור. אפשר לנסות שוב.</p>}
    </div>
  );
}
