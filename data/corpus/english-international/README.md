# english-international/ - INSPIRATION / REFERENCE ONLY

This section is NOT child-facing content. It is a reference corpus of real British, American and Singaporean
primary-math materials, collected to borrow phrasing, scaffolding and pedagogy patterns for AI Tutor IL
(Hebrew tutor, grades 1-4). Do not serve these items to children; adapt patterns into original Hebrew content.

## Contents
- items/ - 3,977 items in the same JSON shape as the Israeli corpus (all-items.json + one file per source)
- digests/ - per-source phrasing/scaffolding digests (uk-sats, white-rose, ny-released-items, singapore-placement, nrich, khan-sequencing)
- digests/not-covered.md - sources that needed credentials or were taken down (Oak National Academy, EngageNY modules)
- sequencing/khan-course-sequencing.json - Khan Academy grade 1-4 unit/skill map (reference only)

## Item shape
id, text, grade (number), grade_band (KS1/KS2/year-N/grade-N), topic, source, type
(multiple-choice | constructed-response | sats-arithmetic | sats-reasoning | assessment-item |
key-question | sentence-stem | open-problem), phrasing_pattern[], language: en,
section: english-international, usage: inspiration/reference.
Optional: marks, options{A-D}, sub_part, figure_dependent, number_gap.

## Source families and counts
- UK SATs (gov.uk released papers 2024+2025, KS1 + KS2): 234 items
- White Rose Maths schemes of learning Y1-Y4 (key questions + sentence stems): 3,068 items
- Singapore Math placement tests 1A-4B: 438 items
- NY State released items grades 3-4 (2024-2026): 141 items
- NRICH primary problems (24 sampled): 96 items
- Khan Academy: sequencing JSON only (no items, by design)

## Known quality caveats
- figure_dependent=true: the stem references a picture the text extraction lost (clocks, shapes, number lines, block pictures). Text is usable for phrasing patterns, not as a standalone item.
- NY 2024/2025 PDFs image-render some operands; affected items are marked number_gap=true and 2025-g3 is partial (6 items).
- White Rose sentence stems lost their blank underscores in extraction (blanks are spacing in the PDF).
- KS2 content is Year 6 (age 11) - above the tutor's grade band; included for reasoning-style patterns.
