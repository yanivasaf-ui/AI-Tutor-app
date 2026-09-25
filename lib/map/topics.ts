import type { Grade } from "@/lib/exercises/types";
import type { Subject } from "@/lib/memory/types";

/**
 * Light topic index for the progress map (UI Revamp Brief Section 4.2).
 * Hand-declared rather than importing lib/rag/curriculum-seed.ts directly
 * — that module's CurriculumChunk[] carries a `text` field with the full
 * RAG-grounding passage per topic, and importing it at all pulls that
 * whole (heavy) module into this client bundle regardless of which fields
 * are actually used. This list mirrors curriculum-seed.ts's id/subject/
 * grade/topic exactly — keep the two in sync if the seed changes.
 *
 * Update 2026-09-10: grade-ג Hebrew topics added (6 entries, sourced —
 * see curriculum-seed.ts's header note) — this was the real content gap
 * flagged in the UI revamp build report. getTopics() can still return an
 * empty array for a grade/subject combination that genuinely has no
 * curriculum content yet; ProgressMap's empty-state handling stays as a
 * general safeguard, not specifically for grade-ג Hebrew anymore.
 *
 * Update 2026-09-14: `displayNameKid` added — a SEPARATE field, purely
 * additive. `topic` (the Ministry-of-Education phrasing) is unchanged and
 * stays the one thing everything downstream keys on: findReusableExercise
 * / generateExercise's grounding, RAG retrieval, curriculum-seed.ts
 * matching, and — inside this file — getTopicById(). None of that reads
 * displayNameKid; it exists for exactly one purpose, showing and
 * speaking a topic to the KID (components/practice/FreePractice.tsx,
 * components/map/ProgressMap.tsx, components/map/MapNode.tsx). A grade-1
 * kid, often not yet reading fluently, cannot parse "הכרת יסודות הקריאה
 * והכתיבה: מודעות פונולוגית וידע שמות האותיות" — displayNameKid is the
 * same topic in 2-4 words a 6-7-year-old would actually say: "אותיות
 * וצלילים". No gendered forms (this app's own rule — see lib/guide/
 * lines.ts's header): every verb form here is an infinitive (לקרוא,
 * לכתוב, לחבר, ...), which doesn't inflect for the kid's gender, and
 * every noun is gender-neutral toward the kid (מספרים, צורות, סיפורים,
 * ...) — nothing here addresses the kid directly the way a second-person
 * verb would.
 */
/** The four arithmetic operations, as the product names them. */
export type Operation = "add" | "sub" | "mul" | "div";

export const OPERATION_NAMES_HE: Readonly<Record<Operation, string>> = {
  add: "חיבור",
  sub: "חיסור",
  mul: "כפל",
  div: "חילוק",
};

export interface MapTopic {
  id: string;
  subject: Subject;
  grade: Grade;
  topic: string;
  /** What's shown and spoken to the kid — see the file header. Never used
   *  for matching, generation, or retrieval; `topic` still owns all of
   *  that. */
  displayNameKid: string;
  /**
   * Math only: the operations an exercise filed under this topic may use.
   * THE source of truth for "does division exist here" — the picker, the
   * generator's subtype pool and prompt, and the admission/serving scope
   * check (lib/exercises/operation-scope.ts) all read this, so they can no
   * longer disagree (2026-09-25: the picker found no division for a grade-א
   * kid while the bank held division rows in every grade-א topic).
   *
   * Derived from the Ministry topic names above, not invented: grade א's
   * only operations topic is "(חיבור וחיסור)", so every grade-א topic is
   * add/sub; grade ב's arithmetic topic includes "תחילת כפל וחילוק", so
   * grade ב is all four; grade ג has a כפל וחילוק topic, so all four —
   * except math-g-arithmetic, whose own name is "חיבור, חיסור, אומדן".
   */
  operations?: readonly Operation[];
}

const ADD_SUB: readonly Operation[] = ["add", "sub"];
const ALL_FOUR: readonly Operation[] = ["add", "sub", "mul", "div"];

export const TOPICS: MapTopic[] = [
  { id: "math-a-numbers-0-100", subject: "math", grade: "א", topic: "הכרת המספרים הטבעיים בתחום ה-0 עד ה-100", displayNameKid: "מספרים עד 100", operations: ADD_SUB },
  { id: "math-a-addition-subtraction", subject: "math", grade: "א", topic: "פעולות חשבון בתחום ה-100 (חיבור וחיסור)", displayNameKid: "לחבר ולחסר", operations: ADD_SUB },
  { id: "math-a-geometry", subject: "math", grade: "א", topic: "צורות גאומטריות", displayNameKid: "צורות", operations: ADD_SUB },
  { id: "math-a-length", subject: "math", grade: "א", topic: "מדידות אורך", displayNameKid: "למדוד אורך", operations: ADD_SUB },
  { id: "math-a-time", subject: "math", grade: "א", topic: "מדידת זמן", displayNameKid: "השעון", operations: ADD_SUB },
  { id: "math-a-data", subject: "math", grade: "א", topic: "חקר נתונים", displayNameKid: "לספור ולסדר", operations: ADD_SUB },

  { id: "math-b-numbers-0-1000", subject: "math", grade: "ב", topic: "הכרת המספרים הטבעיים בתחום ה-0 עד ה-1,000", displayNameKid: "מספרים עד 1,000", operations: ALL_FOUR },
  { id: "math-b-arithmetic", subject: "math", grade: "ב", topic: "פעולות חשבון בתחום ה-100: חיבור, חיסור, ותחילת כפל וחילוק", displayNameKid: "לחבר, לחסר, לכפול ולחלק", operations: ALL_FOUR },
  { id: "math-b-geometry", subject: "math", grade: "ב", topic: "צורות גאומטריות", displayNameKid: "צורות", operations: ALL_FOUR },
  { id: "math-b-length", subject: "math", grade: "ב", topic: "מדידות אורך", displayNameKid: "למדוד אורך", operations: ALL_FOUR },
  { id: "math-b-volume", subject: "math", grade: "ב", topic: "גופים ומדידות נפח", displayNameKid: "גופים: קוביות וכדורים", operations: ALL_FOUR },
  { id: "math-b-time", subject: "math", grade: "ב", topic: "מדידת זמן", displayNameKid: "השעון", operations: ALL_FOUR },
  { id: "math-b-data", subject: "math", grade: "ב", topic: "חקר נתונים", displayNameKid: "לספור ולסדר", operations: ALL_FOUR },

  { id: "math-g-numbers-0-10000", subject: "math", grade: "ג", topic: "הכרת המספרים הטבעיים בתחום ה-0 עד ה-10,000 (הרבבה)", displayNameKid: "מספרים גדולים", operations: ALL_FOUR },
  { id: "math-g-gematria", subject: "math", grade: "ג", topic: "גימטרייה", displayNameKid: "גימטרייה", operations: ALL_FOUR },
  { id: "math-g-arithmetic", subject: "math", grade: "ג", topic: "פעולות חשבון בתחום הרבבה: חיבור, חיסור, אומדן", displayNameKid: "לחבר ולחסר מספרים גדולים", operations: ADD_SUB },
  { id: "math-g-multiplication-division", subject: "math", grade: "ג", topic: "כפל וחילוק בתחום הרבבה", displayNameKid: "כפל וחילוק", operations: ALL_FOUR },
  { id: "math-g-geometry", subject: "math", grade: "ג", topic: "צורות גאומטריות: זוויות ומשולשים", displayNameKid: "זוויות ומשולשים", operations: ALL_FOUR },
  { id: "math-g-area", subject: "math", grade: "ג", topic: "מדידת שטח", displayNameKid: "למדוד שטח", operations: ALL_FOUR },
  { id: "math-g-volume", subject: "math", grade: "ג", topic: "גופים ומדידות נפח", displayNameKid: "גופים: קוביות וכדורים", operations: ALL_FOUR },
  { id: "math-g-time", subject: "math", grade: "ג", topic: "מדידת זמן", displayNameKid: "השעון", operations: ALL_FOUR },
  { id: "math-g-data", subject: "math", grade: "ג", topic: "חקר נתונים", displayNameKid: "לספור ולסדר", operations: ALL_FOUR },

  { id: "hebrew-a-alphabet-phonology", subject: "hebrew", grade: "א", topic: "הכרת יסודות הקריאה והכתיבה: מודעות פונולוגית וידע שמות האותיות", displayNameKid: "אותיות וצלילים" },
  { id: "hebrew-a-early-reading", subject: "hebrew", grade: "א", topic: "קידום הבנת הנקרא בתחילת הדרך", displayNameKid: "להתחיל לקרוא" },
  { id: "hebrew-a-early-writing", subject: "hebrew", grade: "א", topic: "תחילת תהליכי הכתיבה: כתיב פונטי", displayNameKid: "להתחיל לכתוב" },
  { id: "hebrew-a-oral-vocabulary", subject: "hebrew", grade: "א", topic: "קידום השיח הדבור והרחבת אוצר מילים", displayNameKid: "מילים חדשות" },

  { id: "hebrew-b-standard-orthography", subject: "hebrew", grade: "ב", topic: "התקדמות לקראת כתיב תקני", displayNameKid: "לכתוב נכון" },
  { id: "hebrew-b-metalinguistic", subject: "hebrew", grade: "ב", topic: "קידום ידע מטה-לשוני", displayNameKid: "משחקים במילים" },
  { id: "hebrew-b-reading-fluency-literature", subject: "hebrew", grade: "ב", topic: "שטף קריאה, קריאה להנאה, והוראת יצירות ספרות", displayNameKid: "לקרוא סיפור קצר" },

  { id: "hebrew-g-reading-comprehension", subject: "hebrew", grade: "ג", topic: "השלמת תהליך רכישת הקריאה והבנת טקסטים עיוניים", displayNameKid: "להבין מה שקוראים" },
  { id: "hebrew-g-literary-texts-reading-pleasure", subject: "hebrew", grade: "ג", topic: "התנסות עם טקסטים ספרותיים וטיפוח קריאה להנאה", displayNameKid: "לקרוא סיפורים" },
  { id: "hebrew-g-vocabulary", subject: "hebrew", grade: "ג", topic: "הרחבת אוצר מילים", displayNameKid: "מילים חכמות" },
  { id: "hebrew-g-writing-process", subject: "hebrew", grade: "ג", topic: "קידום תהליכי כתיבה", displayNameKid: "לכתוב חיבור קצר" },
  { id: "hebrew-g-oral-expression", subject: "hebrew", grade: "ג", topic: "הבעה בעל פה", displayNameKid: "לדבר ולהסביר" },
  { id: "hebrew-g-metalinguistic", subject: "hebrew", grade: "ג", topic: "פיתוח ידע מטה-לשוני", displayNameKid: "לגלות איך מילים עובדות" },
];

export function getTopics(subject: Subject, grade: Grade): MapTopic[] {
  return TOPICS.filter((t) => t.subject === subject && t.grade === grade);
}

/**
 * Resolves a map node's topic id back to its full MapTopic — used to scope
 * exercise generation/reuse to one specific curriculum chunk (see
 * lib/exercises/generate.ts, lib/exercises/store.ts). Ids here are
 * deliberately identical to lib/rag/curriculum-seed.ts's CurriculumChunk
 * ids (kept in sync by convention, not by import — see the file header),
 * so this same id is what a caller passes as the RAG chunk filter too.
 */
export function getTopicById(id: string): MapTopic | undefined {
  return TOPICS.find((t) => t.id === id);
}

/** Every operation any math topic in this grade allows — what a request
 *  with no topic may use. */
export function gradeOperations(grade: Grade): Operation[] {
  const ops = new Set<Operation>();
  for (const t of TOPICS) if (t.subject === "math" && t.grade === grade) for (const o of t.operations ?? []) ops.add(o);
  return (Object.keys(OPERATION_NAMES_HE) as Operation[]).filter((o) => ops.has(o));
}

/** The operations an exercise for this topic (or, with no usable topic,
 *  this grade) may use. The one lookup every consumer goes through. */
export function allowedOperations(topicId: string | undefined, grade: Grade): Operation[] {
  const t = topicId ? getTopicById(topicId) : undefined;
  if (t && t.subject === "math" && t.grade === grade && t.operations) return [...t.operations];
  return gradeOperations(grade);
}
