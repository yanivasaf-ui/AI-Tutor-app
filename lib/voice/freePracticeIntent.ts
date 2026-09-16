import { TOPICS, type MapTopic } from "@/lib/map/topics";
import { matchSubject, matchTopic } from "./matchTopic";
import type { Grade } from "@/lib/exercises/types";
import type { Subject } from "@/lib/memory/types";

/**
 * What a spoken utterance in free practice resolves to (components/practice/
 * FreePractice.tsx). Extracted as pure, DOM-free logic so it's unit-testable
 * without a browser, and — the actual point — so voice has exactly ONE
 * decision function to go through, with no second copy of this logic to
 * drift out of sync with what a tap does.
 *
 * 2026-09-14 bug: a kid who spoke the subject they were ALREADY in ("אני
 * רוצה ללמוד חשבון" while already on the math topic list) fell through to
 * "topicNotFound" — matchTopic correctly found nothing (the pool is
 * scoped to the current subject, so its own name isn't a topic in it) and
 * the old code only handled matchSubject returning a DIFFERENT subject
 * from the current one, silently doing nothing — no chooseSubject call,
 * no acknowledgement — for the equal case. `same-subject` is that missing
 * branch: a real utterance a tap can never produce (tapping an already-
 * picked subject isn't a button that exists — picking one immediately
 * swaps the subject grid for the topic list), so it has no tap equivalent
 * to fall back on; it must be handled here explicitly.
 */
export type FreePracticeIntent =
  | { kind: "topic"; topic: MapTopic }
  | { kind: "subject"; subject: Subject }
  | { kind: "same-subject"; subject: Subject }
  | { kind: "not-found" };

export function resolveFreePracticeIntent(
  transcript: string,
  currentSubject: Subject | null,
  kidGrade: Grade
): FreePracticeIntent {
  // Voice-experience fix item 2(b): topics are scoped to the kid's own
  // grade everywhere, matching what's read and listed on screen — a topic
  // from another grade is no longer a valid voice match either.
  const pool = TOPICS.filter((t) => t.grade === kidGrade && (!currentSubject || t.subject === currentSubject));
  const topic = matchTopic(transcript, pool, kidGrade);
  if (topic) return { kind: "topic", topic };

  const spokenSubject = matchSubject(transcript);
  if (spokenSubject) {
    return spokenSubject === currentSubject
      ? { kind: "same-subject", subject: spokenSubject }
      : { kind: "subject", subject: spokenSubject };
  }

  return { kind: "not-found" };
}
