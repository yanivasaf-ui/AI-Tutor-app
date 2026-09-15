/**
 * Kid-scene reskin (2026-09-15 QA fix round): illustrated icons for the
 * yearly path's non-topic nodes — the lock glyph on an unopened stop and
 * the two Hebrew-calendar milestone badges (חנוכה/פסח) — replacing the
 * stock 🔒/🕎/🫓 emoji. Same stroke-based, currentColor, 24px-grid family
 * as components/practice/TopicIcon.tsx so every icon on the map reads as
 * one set; kept as a sibling file rather than folded into TopicIcon
 * because these aren't keyed by a topic id.
 */
import type { MilestoneId } from "@/lib/practice/journey";

export function LockIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
      <path d="M7 10V8a5 5 0 0110 0v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="5" y="10" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="14" r="1.3" fill="currentColor" />
      <path d="M12 15.3V17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const MENORAH = (
  <>
    <path
      d="M6 20V12.5M9 20V9.5M12 20V6.5M15 20V9.5M18 20V12.5M4 20h16"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="6" cy="11" r="1.1" fill="currentColor" />
    <circle cx="9" cy="8" r="1.1" fill="currentColor" />
    <circle cx="12" cy="5" r="1.3" fill="currentColor" />
    <circle cx="15" cy="8" r="1.1" fill="currentColor" />
    <circle cx="18" cy="11" r="1.1" fill="currentColor" />
  </>
);

const MATZA = (
  <>
    <rect x="4" y="6" width="16" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="8" cy="10" r="0.9" fill="currentColor" />
    <circle cx="12" cy="10" r="0.9" fill="currentColor" />
    <circle cx="16" cy="10" r="0.9" fill="currentColor" />
    <circle cx="8" cy="14" r="0.9" fill="currentColor" />
    <circle cx="12" cy="14" r="0.9" fill="currentColor" />
    <circle cx="16" cy="14" r="0.9" fill="currentColor" />
  </>
);

const MILESTONE_ICON: Record<MilestoneId, React.ReactNode> = {
  hanukkah: MENORAH,
  pesach: MATZA,
};

export function MilestoneIcon({
  id,
  className,
  style,
}: {
  id: MilestoneId;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
      {MILESTONE_ICON[id]}
    </svg>
  );
}
