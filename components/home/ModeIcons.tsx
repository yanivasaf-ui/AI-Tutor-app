/**
 * Kid-scene reskin (2026-09-15 QA fix round): illustrated icons for
 * ModeChoice's two buttons, replacing the stock 🗺️/🎯 emoji — same
 * stroke-based, currentColor, 24px-grid family as TopicIcon/MapIcons.
 * JourneyIcon echoes the real path screen's own dotted trail + flag
 * stop rather than a generic map; PracticeIcon is a plain target.
 */
export function JourneyIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
      <circle cx="5" cy="20" r="1.4" fill="currentColor" />
      <circle cx="9.5" cy="15.5" r="1.4" fill="currentColor" />
      <circle cx="13.5" cy="11" r="1.4" fill="currentColor" />
      <path d="M18 3v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 3l5 2.6L18 8.2z" fill="currentColor" />
    </svg>
  );
}

export function PracticeIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.7" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </svg>
  );
}
