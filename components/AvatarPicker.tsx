"use client";

import { AVATAR_CATEGORY_LABELS, AVATAR_OPTIONS, AvatarOption } from "@/lib/avatars";

/**
 * Static visual picker only — per the locked decision (M-memory/decisions.md,
 * "AI Tutor IL: Character Avatar Locked for MVP", 2026-08-22): no voice/TTS,
 * that's explicitly deferred. Placeholder emoji + gradient art — final
 * production art is a human decision deferred to Asaf, not built here.
 */
export function AvatarBadge({
  avatar,
  size = 40,
}: {
  avatar: AvatarOption;
  size?: number;
}) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        background: `linear-gradient(135deg, ${avatar.colorFrom}, ${avatar.colorTo})`,
      }}
      title={avatar.label}
    >
      {avatar.emoji}
    </div>
  );
}

export default function AvatarPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const categories = Array.from(new Set(AVATAR_OPTIONS.map((a) => a.category)));

  return (
    <div className="flex flex-col gap-5">
      {categories.map((cat) => (
        <div key={cat}>
          <h3 className="text-sm font-semibold text-slate-500 mb-2">
            {AVATAR_CATEGORY_LABELS[cat]}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {AVATAR_OPTIONS.filter((a) => a.category === cat).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a.id)}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition ${
                  selectedId === a.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-transparent bg-white hover:border-slate-200"
                }`}
              >
                <AvatarBadge avatar={a} size={56} />
                <span className="text-sm text-slate-700">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
