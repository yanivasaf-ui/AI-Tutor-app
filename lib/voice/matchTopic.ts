import type { MapTopic } from "@/lib/map/topics";
import type { Grade } from "@/lib/exercises/types";
import type { Subject } from "@/lib/memory/types";

/**
 * Spoken topic name → a practice topic, for free practice ("חילוק" →
 * division). Topic names are long curriculum strings ("פעולות חשבון בתחום
 * ה-100: חיבור, חיסור, ותחילת כפל וחילוק"), so this is keyword scoring,
 * not whole-name matching:
 *
 * - filler and anything shorter than 3 letters is dropped ("אני רוצה
 *   לתרגל" says nothing about which topic);
 * - a few everyday words map to the curriculum's word ("שעון" → "זמן",
 *   "לחלק" → "חילוק");
 * - each remaining word scores a topic if it appears in the topic's name —
 *   as said, or with one Hebrew prefix letter stripped ("וחילוק");
 * - highest score wins; a tie goes to the topic whose grade is closest to
 *   the kid's, then to list order.
 *
 * Nothing scored → null, and the character asks again rather than
 * guessing.
 */

const NIQQUD = /[֑-ׇ]/g;

const STOPWORDS = new Set([
  "אני", "רוצה", "רוצים", "רציתי", "לתרגל", "תרגול", "תרגיל", "תרגילים", "משהו", "בבקשה", "אפשר",
  "קצת", "עוד", "נושא", "הנושא", "בנושא", "איזה", "בוא", "בואו", "נתרגל", "היום", "עכשיו", "שלי",
  "אולי", "רק", "כמו", "יותר", "בזה", "הזה", "הזאת", "אותו", "אותה", "אצלי", "לעשות", "נעשה",
]);

/** Subject words pick a subject, never a topic ("חשבון" is also in several
 *  topic names). */
const SUBJECT_WORDS: Record<string, Subject> = {
  חשבון: "math",
  מתמטיקה: "math",
  מתמטיקא: "math",
  עברית: "hebrew",
  לשון: "hebrew",
};

const SYNONYMS: Record<string, string> = {
  לחלק: "חילוק",
  מחולק: "חילוק",
  חלקי: "חילוק",
  חילוקים: "חילוק",
  לכפול: "כפל",
  כפול: "כפל",
  כפולה: "כפל",
  פלוס: "חיבור",
  ועוד: "חיבור",
  להוסיף: "חיבור",
  לחבר: "חיבור",
  חיבורים: "חיבור",
  מינוס: "חיסור",
  פחות: "חיסור",
  להוריד: "חיסור",
  חיסורים: "חיסור",
  שעון: "זמן",
  שעה: "זמן",
  שעות: "זמן",
  צורה: "צורות",
  משולש: "משולשים",
  זווית: "זוויות",
  אות: "אותיות",
  מספר: "מספרים",
  סיפור: "ספרות",
  סיפורים: "ספרות",
  מילה: "מילים",
  לכתוב: "כתיבה",
  לקרוא: "קריאה",
  סרגל: "אורך",
  גרף: "נתונים",
};

const PREFIXES = "והבלמשכ";

function clean(s: string): string {
  return s
    .replace(NIQQUD, "")
    .replace(/[׳״'"]/g, "")
    .replace(/[.,!?;:()[\]{}\-–—־]/g, " ")
    .toLowerCase()
    .trim();
}

function words(s: string): string[] {
  return clean(s).split(/\s+/).filter(Boolean);
}

/** The forms of one spoken word worth looking for in a topic name. */
function candidates(word: string): string[] {
  const out = new Set<string>();
  const add = (w: string) => {
    if (w.length < 3) return;
    out.add(w);
    if (SYNONYMS[w]) out.add(SYNONYMS[w]);
  };
  add(word);
  if (PREFIXES.includes(word[0]) && word.length - 1 >= 3) add(word.slice(1));
  return [...out];
}

function keywords(transcript: string): string[][] {
  return words(transcript)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && SUBJECT_WORDS[w] === undefined)
    .map(candidates)
    .filter((c) => c.length > 0);
}

const GRADE_ORDER: Grade[] = ["א", "ב", "ג"];

export function matchTopic(transcript: string, topics: MapTopic[], kidGrade: Grade): MapTopic | null {
  const kws = keywords(transcript);
  if (kws.length === 0) return null;
  const kidG = GRADE_ORDER.indexOf(kidGrade);

  let best: { topic: MapTopic; score: number; distance: number; index: number } | null = null;
  topics.forEach((topic, index) => {
    const name = clean(topic.topic);
    const score = kws.filter((forms) => forms.some((f) => name.includes(f))).length;
    if (score === 0) return;
    const distance = Math.abs(GRADE_ORDER.indexOf(topic.grade) - kidG);
    if (
      !best ||
      score > best.score ||
      (score === best.score && distance < best.distance) ||
      (score === best.score && distance === best.distance && index < best.index)
    ) {
      best = { topic, score, distance, index };
    }
  });
  return (best as { topic: MapTopic } | null)?.topic ?? null;
}

/** "חשבון" / "עברית" and friends, anywhere in the transcript. */
export function matchSubject(transcript: string): Subject | null {
  for (const w of words(transcript)) {
    const direct = SUBJECT_WORDS[w] ?? (PREFIXES.includes(w[0]) ? SUBJECT_WORDS[w.slice(1)] : undefined);
    if (direct) return direct;
  }
  return null;
}
