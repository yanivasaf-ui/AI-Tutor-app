"use client";

import { useState } from "react";
import { TOPICS, getTopicById } from "@/lib/map/topics";

const SUBJECT_LABELS = { math: "חשבון", hebrew: "עברית" } as const;

/**
 * The parent dashboard's "הצע תרגול": pick one topic (any subject, any
 * grade) and it shows first in the kid's free-practice list, tagged
 * "אמא/אבא הציעו". One suggestion at a time; it stays until the parent
 * changes or withdraws it. Stored in the kid's practice state
 * (PATCH /api/kids { suggestion }) — it never touches the journey.
 */
export default function SuggestPractice({
  kidId,
  kidName,
  currentTopicId,
  onChanged,
}: {
  kidId: string;
  kidName: string;
  currentTopicId?: string;
  onChanged: () => void;
}) {
  const [choice, setChoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const current = currentTopicId ? getTopicById(currentTopicId) : undefined;

  async function save(topicId: string | null) {
    setSaving(true);
    setError(false);
    try {
      const res = await fetch("/api/kids", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: kidId, suggestion: topicId ? { topicId } : null }),
      });
      if (!res.ok) throw new Error("failed");
      setChoice("");
      onChanged();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-2xl p-3 mb-4">
      <h3 className="font-semibold text-[var(--color-ink)] mb-1 text-sm">הצע תרגול</h3>
      <p className="text-xs text-[var(--color-ink-soft)] mb-2">
        הנושא יופיע ראשון בתרגול החופשי של {kidName}, עם התגית ״אמא/אבא הציעו״.
      </p>
      {current && (
        <div className="flex items-center justify-between gap-2 bg-[var(--color-teal-soft)] rounded-xl px-3 py-2 mb-2 text-sm">
          <span className="min-w-0">
            הוצע עכשיו:{" "}
            <b>
              {SUBJECT_LABELS[current.subject]} · כיתה {current.grade}׳ · {current.topic}
            </b>
          </span>
          <button
            onClick={() => save(null)}
            disabled={saving}
            className="shrink-0 min-h-11 px-2 text-[var(--color-ink-soft)] underline disabled:opacity-50"
          >
            ביטול
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="נושא להצעה"
          className="flex-1 min-w-0 min-h-11 border rounded-[var(--radius-button)] px-3 bg-white text-sm"
        >
          <option value="">בחירת נושא…</option>
          {(["math", "hebrew"] as const).map((s) => (
            <optgroup key={s} label={SUBJECT_LABELS[s]}>
              {TOPICS.filter((t) => t.subject === s).map((t) => (
                <option key={t.id} value={t.id}>
                  {`כיתה ${t.grade}׳ · ${t.topic}`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          onClick={() => choice && save(choice)}
          disabled={!choice || saving}
          className="min-h-11 px-4 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-sm font-medium disabled:opacity-50"
        >
          {saving ? "רגע..." : "הצע"}
        </button>
      </div>
      {error && <p className="text-[var(--color-warm)] text-xs mt-1">משהו השתבש בשמירה. אפשר לנסות שוב.</p>}
    </div>
  );
}
