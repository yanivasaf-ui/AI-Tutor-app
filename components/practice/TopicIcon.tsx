/**
 * Kid-scene reskin (2026-09-15): one coherent illustrated icon set for
 * the topic picker, replacing stock emoji — stroke-based SVG, 24px grid,
 * currentColor so each subject's own accent tints it (item 2 of the
 * reskin brief). Categorized by what a topic id's own name segment
 * means rather than one bespoke icon per id — the 35 real topics
 * (lib/map/topics.ts) group into a small, recognizable set.
 */
const CATEGORY_BY_TOPIC: Record<string, string> = {
  "math-a-numbers-0-100": "numbers",
  "math-b-numbers-0-1000": "numbers",
  "math-g-numbers-0-10000": "numbers",
  "math-a-addition-subtraction": "operations",
  "math-b-arithmetic": "operations",
  "math-g-arithmetic": "operations",
  "math-g-multiplication-division": "multiply",
  "math-a-geometry": "shapes",
  "math-b-geometry": "shapes",
  "math-g-geometry": "shapes",
  "math-a-length": "ruler",
  "math-b-length": "ruler",
  "math-g-area": "area",
  "math-a-time": "clock",
  "math-b-time": "clock",
  "math-g-time": "clock",
  "math-a-data": "sort",
  "math-b-data": "sort",
  "math-g-data": "sort",
  "math-b-volume": "volume",
  "math-g-volume": "volume",
  "math-g-gematria": "numbers",
  "hebrew-a-alphabet-phonology": "letters",
  "hebrew-a-early-reading": "book",
  "hebrew-g-reading-comprehension": "book",
  "hebrew-b-reading-fluency-literature": "book",
  "hebrew-g-literary-texts-reading-pleasure": "book",
  "hebrew-a-early-writing": "pencil",
  "hebrew-g-writing-process": "pencil",
  "hebrew-b-standard-orthography": "pencil",
  "hebrew-a-oral-vocabulary": "speech",
  "hebrew-g-vocabulary": "speech",
  "hebrew-g-oral-expression": "speech",
  "hebrew-b-metalinguistic": "puzzle",
  "hebrew-g-metalinguistic": "puzzle",
};

const PATHS: Record<string, string> = {
  numbers: "M4 18V6M8 18v-8M12 18V9M16 18v-4M20 18V7",
  operations: "M6 12h12M12 6v12",
  multiply: "M7 7l10 10M17 7L7 17",
  shapes: "M12 3l8 6-3 9H7l-3-9z",
  ruler: "M4 17l16-10M4 17l3 .6M4 17l1.2-2.8M9 13.5l1.5.9M12.5 11.3l1.5.9M16 9.2l1.5.9",
  area: "M4 4h16v16H4z M4 9h16 M4 14h16 M9 4v16 M14 4v16",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3.5 2",
  sort: "M5 6h5M5 12h8M5 18h4 M18 6l0 0 M16 12l0 0 M12 18l0 0",
  volume: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 3v18 M4 7.5l8 4.5 8-4.5",
  letters: "M6 20V6a2 2 0 012-2h2a2 2 0 012 2v14 M6 13h4 M15 8c-2 0-3 1.5-3 4s1 4 3 4 3-1.5 3-4-1-4-3-4z",
  book: "M12 6c-2-2.5-6-3-9-2v22c3-1 7-.5 9 2 2-2.5 6-3 9-2V4c-3-1-7-.5-9 2z M12 6v18",
  pencil: "M4 20l1-5L16 4l4 4L9 19l-5 1z M14 6l4 4",
  speech: "M4 5h16v11H9l-5 4V5z",
  puzzle: "M9 4h4v3a2 2 0 104 0V4h4v4h-3a2 2 0 100 4h3v4h-4v-3a2 2 0 10-4 0v3H9v-4h3a2 2 0 100-4H9V4z",
};

export function topicIconCategory(topicId: string): string {
  return CATEGORY_BY_TOPIC[topicId] ?? "numbers";
}

export default function TopicIcon({
  topicId,
  className,
  style,
}: {
  topicId: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const category = topicIconCategory(topicId);
  const d = PATHS[category] ?? PATHS.numbers;
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
