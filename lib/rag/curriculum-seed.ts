/**
 * PLACEHOLDER SEED DATA — NOT sourced from the Ministry of Education.
 *
 * This is illustrative starter content only, written to prove out the RAG
 * pipeline end-to-end (chunk -> embed -> retrieve -> generate). It must be
 * replaced by real ingestion from ecat.education.gov.il / pop.education.gov.il
 * (both confirmed reachable) before this ships to a single real parent.
 *
 * Real ingestion is a separate, larger task: it needs someone to go through
 * the Ministry catalog/curriculum-standard documents grade by grade and pull
 * the actual approved topic sequence and terminology — not something to
 * fabricate here.
 */
import { CurriculumChunk } from "./types";

export const curriculumSeed: CurriculumChunk[] = [
  {
    id: "math-a-counting",
    subject: "math",
    grade: "א",
    topic: "מספרים עד 20",
    text: "בכיתה א' התלמידים לומדים לספור, לקרוא ולכתוב מספרים עד 20, להשוות בין מספרים (גדול/קטן/שווה), ולהבין מושג הכמות באמצעות עצמים וציורים.",
    source: "PLACEHOLDER — replace with ecat.education.gov.il sourced content",
  },
  {
    id: "math-a-addition-subtraction",
    subject: "math",
    grade: "א",
    topic: "חיבור וחיסור עד 20",
    text: "פעולות חיבור וחיסור במספרים עד 20, תוך שימוש באמצעים חזותיים (אצבעות, קוביות, קו מספרים) לפני מעבר לחישוב מופשט.",
    source: "PLACEHOLDER — replace with ecat.education.gov.il sourced content",
  },
  {
    id: "math-b-place-value",
    subject: "math",
    grade: "ב",
    topic: "ערך מקומי עד 100",
    text: "בכיתה ב' מתרחב הטווח המספרי עד 100, עם דגש על ערך מקומי (עשרות ואחדות) וחיבור/חיסור עם ובלי פריטה.",
    source: "PLACEHOLDER — replace with ecat.education.gov.il sourced content",
  },
  {
    id: "math-g-multiplication",
    subject: "math",
    grade: "ג",
    topic: "כפל וחילוק בסיסי",
    text: "בכיתה ג' מוצג מושג הכפל כחיבור חוזר, לוח הכפל עד 10, והתחלת החילוק כפעולה הופכית לכפל.",
    source: "PLACEHOLDER — replace with ecat.education.gov.il sourced content",
  },
  {
    id: "hebrew-a-letters",
    subject: "hebrew",
    grade: "א",
    topic: "זיהוי אותיות וניקוד",
    text: "בכיתה א' מתמקדים בזיהוי כל אותיות האלף-בית, הבנת הניקוד הבסיסי (קמץ, פתח, חיריק, חולם, שורוק), וקריאת מילים פשוטות בהברה פתוחה.",
    source: "PLACEHOLDER — replace with ecat.education.gov.il sourced content",
  },
  {
    id: "hebrew-b-reading-fluency",
    subject: "hebrew",
    grade: "ב",
    topic: "שטף קריאה והבנת הנקרא",
    text: "בכיתה ב' הדגש עובר משיטת פענוח לקריאה שוטפת, עם תרגול הבנת הנקרא בטקסטים קצרים ושאלות הבנה בסיסיות (מי, מה, איפה, מתי).",
    source: "PLACEHOLDER — replace with ecat.education.gov.il sourced content",
  },
  {
    id: "hebrew-g-spelling",
    subject: "hebrew",
    grade: "ג",
    topic: "כללי כתיב וניתוח מילים",
    text: "בכיתה ג' מוצגים כללי כתיב מלא, שורש ומשקל בצורה בסיסית, וכתיבת טקסטים קצרים ועצמאיים.",
    source: "PLACEHOLDER — replace with ecat.education.gov.il sourced content",
  },
];
