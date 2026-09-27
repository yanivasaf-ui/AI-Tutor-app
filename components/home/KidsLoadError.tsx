"use client";

/**
 * Shown when the signed-in parent's kids could not be loaded (offline, a
 * server error). NOT onboarding: an empty result caused by an error must
 * never look like "no kids yet", because finishing onboarding creates a kid
 * (lib/kids/load.ts). Retry re-runs the load; the parent can also sign out.
 */
export default function KidsLoadError({ onRetry, onLogout }: { onRetry: () => void; onLogout: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--color-canvas)] p-6 text-center">
      <p role="alert" className="text-lg text-[var(--color-ink)]">
        לא הצלחנו לטעון את הפרופיל. בדקו את החיבור ונסו שוב.
      </p>
      <button
        onClick={onRetry}
        className="rounded-[var(--radius-button)] bg-[var(--color-teal)] px-6 py-3 text-base font-semibold text-white"
      >
        לנסות שוב
      </button>
      <button onClick={onLogout} className="text-sm text-[var(--color-ink-soft)]">
        התנתקות
      </button>
    </div>
  );
}
