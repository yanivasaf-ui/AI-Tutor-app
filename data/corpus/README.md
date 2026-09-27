# Math Question Corpus — AI Tutor IL (authentic Israeli textbook sources)

Built 2026-09-25 from ministry-hosted sources. All question text is verbatim, extracted from official PDFs/DOCX; niqqud preserved where the source has it.

## Contents

- `items/grade-<1..5>.json`, `items/all-items.json` — 12003 extracted items.
  Item shape:
  ```
  {
    "id": "psahot-ב1-p45-123",
    "source": {"series","volume","page","publisher","url"},
    "grade": "ב", "grade_num": 2,
    "topic": "addition_subtraction",   // one of: numbers_place_value, addition_subtraction, multiplication, division, fractions, geometry, measurement, patterns_sequences, general
    "type": "word_problem",            // word_problem | direct_question | completion | completion_question | drill | instruction_or_task
    "text": "…",                        // verbatim, NFC-normalized, niqqud preserved
    "niqqud": true,
    "phrasing_patterns": ["named-child story + כמה question", ...]
  }
  ```
- `topic-skill-map.json` — ministry milestone docs (ציוני דרך), grades א-ד, 25 grade×topic cells, 507 skill statements. THIS is the curriculum topic→skill mapping source. Keys: grade letter → topic slug → {topic_he, skills[], source_url}. Needs a join table to the product's 22 topic IDs (the slugs here are ministry taxonomy).
- `digests/phrasing-grade-<1..5>.md` — per grade×topic: item counts by type, phrasing-pattern frequencies, 3 verbatim example stems each.
- `EXEMPLARS.md` — 22 hand-filtered verbatim exemplars across grades/topics for eyeballing.

## Counts

Per grade: {'א': 1628, 'ב': 2547, 'ג': 2107, 'ד': 3024, 'ה': 2697}
Per grade×topic: {'א/addition_subtraction': 173, 'א/division': 6, 'א/fractions': 13, 'א/general': 1031, 'א/geometry': 78, 'א/measurement': 142, 'א/multiplication': 9, 'א/numbers_place_value': 175, 'א/patterns_sequences': 1, 'ב/addition_subtraction': 99, 'ב/division': 12, 'ב/fractions': 32, 'ב/general': 1830, 'ב/geometry': 26, 'ב/measurement': 200, 'ב/multiplication': 47, 'ב/numbers_place_value': 289, 'ב/patterns_sequences': 12, 'ג/addition_subtraction': 67, 'ג/division': 21, 'ג/fractions': 72, 'ג/general': 1421, 'ג/geometry': 74, 'ג/measurement': 118, 'ג/multiplication': 84, 'ג/numbers_place_value': 240, 'ג/patterns_sequences': 10, 'ד/addition_subtraction': 39, 'ד/division': 31, 'ד/fractions': 115, 'ד/general': 2063, 'ד/geometry': 208, 'ד/measurement': 201, 'ד/multiplication': 28, 'ד/numbers_place_value': 319, 'ד/patterns_sequences': 20, 'ה/addition_subtraction': 95, 'ה/division': 28, 'ה/fractions': 262, 'ה/general': 1127, 'ה/geometry': 448, 'ה/measurement': 285, 'ה/multiplication': 77, 'ה/numbers_place_value': 355, 'ה/patterns_sequences': 20}
Types: {'instruction_or_task': 7923, 'direct_question': 2369, 'word_problem': 756, 'drill': 835, 'completion': 117, 'completion_question': 3}
Niqqud present: 8992 of 12003

## Sources (all verified live 2026-09-25)

1. פשוט חשבון (כנרת זמורה-ביתן דביר), full textbook PDFs hosted FREE by the Ministry:
   https://meyda.education.gov.il/files/free%20books/פשוט חשבון <א-ו><1-3>.pdf
2. דפים חודשיים (ministry math supervision monthly worksheets), grades א-ד:
   https://pop.education.gov.il/tchumey_daat/matmatika/yesodi/oraat-math/dapim-hodshiim/
3. ציוני דרך milestone docs: https://meyda.education.gov.il/files/Tochniyot_Limudim/Math/Yesodi/Mevoeret/<A-D>.<topic>.pdf
4. New curriculum per grade: https://meyda.education.gov.il/files/Mazkirut_Pedagogit/math/primary-school/math2023/Newprogramgrade<1-4>.pdf (not itemized here; use for scope decisions)

## Known extraction limitations (fidelity)

- Hebrew PDF extraction was rebuilt per-glyph-run (visual→logical reversal). Prose/word problems are high fidelity. Drill/equation lines (= 13+5) and table layouts sometimes scramble number order — treat `drill` items as low fidelity; regenerate drills instead of trusting them.
- ~5-10% of blocks are instruction fragments, not questions (`instruction_or_task`).
- פשוט חשבון volumes ג2 and ד2 (grade ג vol 2, grade ד vol 2) are NOT on the ministry free-books server (404 on every filename variant tried) — grade ג/ד coverage has a gap for the middle third of the year. Grade ה1 also missing. Get via Kotar subscription or scan.
- Monthly worksheet items sometimes include the start of the teacher note (spot-cleaned by filters but some leak).
- topic field is keyword-classified per item, not from book TOC — 'general' means no confident topic signal.

## Recommended repo ingestion shape (for Loki)

```
corpus/
  items/all-items.json          # single array; filter by grade_num/topic/type
  items/grade-<n>.json          # per-grade views (same items)
  topic-skill-map.json          # ministry taxonomy: grade -> topic -> skills[]
  digests/phrasing-grade-<n>.md # human-readable rubric reference
```
- Quality gate usage: compare generated exercise text against `phrasing_patterns` + digest stems for the target grade/topic; require niqqud for grades א-ב voice scripts (corpus `text` fields already carry it).
- Regression bank: pick N items per (grade, topic, type) as fixtures; `source.url` + page gives provenance for spot-checks.
- Join product topics to ministry slugs explicitly (do NOT auto-map): product topic "כפל וחילוק" (grade ג) spans multiplication+division slugs.
