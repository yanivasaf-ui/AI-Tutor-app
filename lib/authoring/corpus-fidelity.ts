/**
 * Corpus text that must never become an example or a template, however
 * clean the rest of it looks (data/CORPUS-INGEST.md). One definition, used
 * by the builder that fills the rubric slots (scripts/build-corpus-index.ts)
 * and by the tests that pin the anomaly counts and check every exemplar and
 * template against it.
 */

/** Numbers of 1,000 and more extracted digit-reversed around the comma
 *  ("0001," for 1,000; "000,9" for 9,000) — 177 corpus items, 56 of them in
 *  the types the corpus README calls high fidelity. */
export const REVERSED_THOUSANDS = /(?<!\d)0\d{2,},|(?<!\d)0{2,3},\d/;

/** A teacher note typed as a question: it talks about the pupils or the
 *  class ("התלמידים", "בכיתה") or opens with advice to the teacher
 *  ("מומלץ", "ניתן", "כדאי"...) — 205 corpus items, 141 of the 756 word
 *  problems. A heuristic; match it on the letters (see isTeacherNote). */
export const TEACHER_NOTE = /(?<![א-ת])(?:ה|ל|מה|ש)?תלמידים(?![א-ת])|(?<![א-ת])בכיתה(?![א-ת])|^(?:מומלץ|ניתן|כדאי|חשוב|רצוי|להעמקה|מטרת)/;

const POINTS = /[֑-ׇֽֿׁׂׅׄ]/g;

export function isTeacherNote(text: string): boolean {
  return TEACHER_NOTE.test(text.replace(POINTS, ""));
}

export function hasReversedThousands(text: string): boolean {
  return REVERSED_THOUSANDS.test(text);
}
