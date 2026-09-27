/**
 * The app's "something is on its way" signal: three dots bouncing in turn.
 * Shared by the first app load and the exercise load (QA 2026-09-27: a
 * journey station showed only "רגע, אני מכינה לנו תרגיל..." for 8–10s with
 * nothing moving, which reads as frozen). Still under reduced motion (the
 * dots stay, the bounce stops — see globals.css).
 */
export default function LoadingDots({ tone = "teal", label = "טוען..." }: { tone?: "teal" | "light"; label?: string }) {
  const dot = tone === "light" ? "bg-white/90" : "bg-[var(--color-teal)]";
  return (
    <div className="flex gap-2" role="status" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`w-3 h-3 rounded-full ${dot} animate-bounce`} style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}
