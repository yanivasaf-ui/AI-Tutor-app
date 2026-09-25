# Math corpus: ingest record

`data/corpus/` is the Ministry math question corpus, committed **as delivered**. The corpus's own
[README](corpus/README.md) describes it. This file records how it got here and the rules for using it.

## Source

| | |
|---|---|
| Delivered as | `ai-tutor-math-corpus.zip`, handed over by Asaf 2026-09-25 |
| Zip sha256 | `b3f07698f31658413750380c00bc846300535c64036e308cc29bc1930fe614c9` (1,547,822 bytes) |
| Contents | 83 files, 19 MB unpacked, extracted with no changes |
| Per-file hashes | [`corpus.sha256`](corpus.sha256), checked by `tests/corpus.test.mts` |

No file inside `data/corpus/` has been edited, renamed, normalized or re-encoded. To take a new
corpus version, replace the directory wholesale, regenerate `corpus.sha256`
(`cd data/corpus && find . -type f | LC_ALL=C sort | xargs shasum -a 256 > ../corpus.sha256`) and
update the pinned counts in `tests/corpus.test.mts`. Those tests fail on purpose until you do.

## Layout (the README's recommended ingestion shape, under `data/`)

```
data/corpus/
  README.md, EXEMPLARS.md
  items/all-items.json          12003 items, a single array
  items/grade-<1..5>.json       the same items split by grade (test-verified identical)
  topic-skill-map.json          ministry ציוני דרך: grade → slug → {topic_he, skills[], source_url}
  digests/phrasing-grade-<1..5>.md
  english-international/        REFERENCE ONLY, never child-facing (see below)
data/corpus.sha256              ingest manifest
data/CORPUS-INGEST.md           this file
```

The product↔corpus join is in `lib/authoring/topic-join.ts`, deliberately outside the corpus.

## Fidelity rules (enforced where code can enforce them)

1. **`type: drill` is low fidelity.** Extraction can scramble digit order, so a drill is never
   served verbatim and never used as an exemplar or template. It may inform phrasing only. The
   corpus-derived index (`scripts/build-corpus-index.ts`) drops drills, and a test checks this.
2. **`word_problem` / `direct_question` are high fidelity** and are the only types used as
   exemplars or vetted templates.
3. **Niqqud text** (8,992 items) is suitable for grade א–ב voice scripts. It is carried through
   verbatim wherever an item is used.
4. **`english-international/` is inspiration/reference only.** No runtime code may read it. A test
   checks `app/`, `components/` and `lib/`.
5. **Runtime never reads `data/corpus/`.** At 19 MB it would end up in every serverless bundle.
   Runtime code reads the small derived index in `lib/authoring/`, and a test enforces this.

## Anomalies found at ingest (flagged, not fixed)

Each count is pinned in `tests/corpus.test.mts`.

| Anomaly | Count | Note |
|---|---|---|
| Worksheet items have `source.document` instead of `volume` + `page` | 292 | README documents only `{series, volume, page, publisher, url}`. For these items, provenance is url + document. |
| Texts not in NFC | 83 | README says texts are NFC-normalized |
| `niqqud: false` but marks are present | 1 | |
| Duplicate texts (extra copies) | 112 | |
| URL inside the text (teacher-note leak) | 82 | e.g. an nrich teacher note classified `word_problem / fractions` |
| Latin words in the text | 142 | |
| Niqqud mark detached after a space (glyph-run artifact) | 2159 | e.g. `מַ ּׂשָאִית`, `שֶׁ ּׁשֶטַח` |
| Detached maqaf (`' ־'`) | 443 | e.g. `לִ ־470` |
| Degree sign extracted as a leading zero | 6 | `0360`, `0180`, `090` |
| Numbers ≥1,000 with digits reversed around the comma | 177 | `0001,` for 1,000 and `000,9` for 9,000. **56 are word_problem/direct_question**, the types the README calls high fidelity. Treat any 4+-digit number in the corpus as suspect |
| Teacher notes typed as `word_problem` / `direct_question` | 205 (141 of 756 word_problems) | heuristic: text addresses the teacher (התלמידים, בכיתה, starts מומלץ/ניתן/כדאי…); 156 of them from the monthly worksheets. "High fidelity" describes the extraction, not whether the text is a question |
| Running-header words fused into text | not counted | e.g. `.וחיסור`, `וביחידות`, `מדידות משקל` in digest stems |
| Topic misclassification (keyword-based) | not counted | e.g. time items under `fractions` via "חצי"; angle items under `fractions` |
| Scrambled drill used as a digest stem | grade ב division | the only ב/division stem is a scrambled drill |
| Exemplar pattern labels over-applied | EXEMPLARS.md | many exemplars are labeled "named-child story + כמה question" when they aren't |
| topic-skill-map has no multiplication or division cell | all grades | both live in `Peulot`. README's "spans multiplication+division slugs" refers to item topics |
| No `Netunim` (data) cell for grade א; no gematria at grade ג | | see `topic-join.ts` GAP rows |
| Volumes ג2, ד2, ה1 missing | | per README. Grade ג coverage has a mid-year gap |
