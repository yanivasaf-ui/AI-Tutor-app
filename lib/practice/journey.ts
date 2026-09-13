import type { MapTopic } from "@/lib/map/topics";

/**
 * The school year as the map frames it: every topic gets a rough month,
 * and two holiday milestones sit on the path. Display framing only — a
 * month never gates a stop and a milestone is never a requirement; the
 * map's done/current/locked logic ignores both.
 */

/** September → June, the Israeli school year. */
export const SCHOOL_MONTHS = [
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
] as const;

export type MilestoneId = "hanukkah" | "pesach";

export interface Milestone {
  id: MilestoneId;
  label: string;
  emoji: string;
  /** Index into SCHOOL_MONTHS the holiday falls in (roughly). */
  monthIndex: number;
}

export const MILESTONES: Milestone[] = [
  { id: "hanukkah", label: "חנוכה", emoji: "🕎", monthIndex: 3 },
  { id: "pesach", label: "פסח", emoji: "🫓", monthIndex: 7 },
];

/** Topic i of n, spread evenly across the year by list order. */
export function monthIndexFor(i: number, n: number): number {
  if (n <= 1) return 0;
  return Math.min(SCHOOL_MONTHS.length - 1, Math.floor((i * SCHOOL_MONTHS.length) / n));
}

export type JourneyStop =
  | { kind: "topic"; topic: MapTopic; topicIndex: number; month: string }
  | { kind: "milestone"; milestone: Milestone };

/**
 * The path, in order: topics with their month, and each milestone placed
 * just before the first topic whose month falls after the holiday.
 * Milestones later than every topic go at the end. No topics, no path.
 */
export function buildJourney(topics: MapTopic[]): JourneyStop[] {
  if (topics.length === 0) return [];
  const stops: JourneyStop[] = [];
  const pending = [...MILESTONES];
  topics.forEach((topic, i) => {
    const m = monthIndexFor(i, topics.length);
    while (pending.length > 0 && m > pending[0].monthIndex) {
      stops.push({ kind: "milestone", milestone: pending.shift()! });
    }
    stops.push({ kind: "topic", topic, topicIndex: i, month: SCHOOL_MONTHS[m] });
  });
  for (const milestone of pending) stops.push({ kind: "milestone", milestone });
  return stops;
}
