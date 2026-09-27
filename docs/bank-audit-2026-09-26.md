# Bank audit against the allowed-format table (read-only)

Bank: 1036 rows. Violating: **688** (66.4%) in 35 of 35 topics.
Of these, 677 fail on format membership (the rows query C lists by id) and 11 are number lines with no operation in an operations topic (G5; query B).

| topic | rows | violating | servable after | by format |
|---|---:|---:|---:|---|
| math-a-numbers-0-100 | 30 | 18 | 12 | pick_operation 6, fill_in_blank 5, equation_balance 4, visual_grouping 3 |
| math-a-addition-subtraction | 30 | 15 | 15 | pattern_completion 6, visual_grouping 5, number line with no operation (G5) 4 |
| math-a-geometry | 30 | 24 | 6 | pick_operation 7, number_line_placement 6, equation_balance 4, pattern_completion 4, visual_grouping 3 |
| math-a-length | 30 | 25 | 5 | pattern_completion 6, pick_operation 6, visual_grouping 5, equation_balance 4, fill_in_blank 4 |
| math-a-time | 30 | 9 | 21 | visual_grouping 6, pattern_completion 2, number_line_placement 1 |
| math-a-data | 30 | 12 | 18 | pattern_completion 5, number_line_placement 4, visual_grouping 3 |
| math-b-numbers-0-1000 | 30 | 22 | 8 | pick_operation 7, equation_balance 6, fill_in_blank 5, visual_grouping 4 |
| math-b-arithmetic | 30 | 11 | 19 | pattern_completion 7, number line with no operation (G5) 4 |
| math-b-geometry | 29 | 25 | 4 | pick_operation 9, pattern_completion 7, number_line_placement 4, visual_grouping 4, equation_balance 1 |
| math-b-length | 30 | 12 | 18 | pattern_completion 6, visual_grouping 6 |
| math-b-volume | 27 | 10 | 17 | pattern_completion 4, number_line_placement 3, visual_grouping 3 |
| math-b-time | 22 | 6 | 16 | visual_grouping 4, number_line_placement 2 |
| math-b-data | 30 | 16 | 14 | pattern_completion 8, number_line_placement 6, visual_grouping 2 |
| math-g-numbers-0-10000 | 30 | 18 | 12 | pick_operation 6, fill_in_blank 5, equation_balance 4, visual_grouping 3 |
| math-g-gematria | 30 | 30 | 0 | pick_operation 8, pattern_completion 6, equation_balance 5, fill_in_blank 5, visual_grouping 4, number_line_placement 2 |
| math-g-arithmetic | 31 | 13 | 18 | pattern_completion 6, visual_grouping 4, number line with no operation (G5) 3 |
| math-g-multiplication-division | 30 | 4 | 26 | pattern_completion 4 |
| math-g-geometry | 30 | 28 | 2 | pick_operation 7, number_line_placement 6, pattern_completion 6, visual_grouping 5, equation_balance 4 |
| math-g-area | 30 | 24 | 6 | equation_balance 5, number_line_placement 5, pattern_completion 5, pick_operation 5, visual_grouping 4 |
| math-g-volume | 30 | 30 | 0 | (unserved topic) pick_operation 7, (unserved topic) number_line_placement 6, (unserved topic) pattern_completion 6, (unserved topic) equation_balance 4, (unserved topic) visual_grouping 4, (unserved topic) fill_in_blank 3 |
| math-g-time | 26 | 11 | 15 | visual_grouping 7, number_line_placement 3, pattern_completion 1 |
| math-g-data | 30 | 17 | 13 | number_line_placement 6, pattern_completion 6, visual_grouping 5 |
| hebrew-a-alphabet-phonology | 30 | 23 | 7 | comprehension 6, spelling_correction_mc 6, root_pattern_mc 5, sentence_order 3, vowel_select_mc 3 |
| hebrew-a-early-reading | 30 | 24 | 6 | root_pattern_mc 6, spelling_correction_mc 6, phonemic_visual_mc 3, sentence_order 3, vowel_select_mc 3, word_build 3 |
| hebrew-a-early-writing | 30 | 23 | 7 | root_pattern_mc 6, spelling_correction_mc 6, comprehension 4, sentence_order 4, phonemic_visual_mc 3 |
| hebrew-a-oral-vocabulary | 30 | 24 | 6 | root_pattern_mc 6, spelling_correction_mc 6, phonemic_visual_mc 3, sentence_order 3, vowel_select_mc 3, word_build 3 |
| hebrew-b-standard-orthography | 30 | 24 | 6 | comprehension 6, root_pattern_mc 6, phonemic_visual_mc 3, sentence_order 3, vowel_select_mc 3, word_build 3 |
| hebrew-b-metalinguistic | 30 | 24 | 6 | comprehension 6, spelling_correction_mc 6, phonemic_visual_mc 3, sentence_order 3, vowel_select_mc 3, word_build 3 |
| hebrew-b-reading-fluency-literature | 31 | 25 | 6 | root_pattern_mc 6, spelling_correction_mc 6, phonemic_visual_mc 4, sentence_order 3, vowel_select_mc 3, word_build 3 |
| hebrew-g-reading-comprehension | 30 | 24 | 6 | root_pattern_mc 6, spelling_correction_mc 6, phonemic_visual_mc 3, sentence_order 3, vowel_select_mc 3, word_build 3 |
| hebrew-g-literary-texts-reading-pleasure | 30 | 24 | 6 | spelling_correction_mc 6, root_pattern_mc 5, word_build 4, phonemic_visual_mc 3, sentence_order 3, vowel_select_mc 3 |
| hebrew-g-vocabulary | 30 | 24 | 6 | root_pattern_mc 6, spelling_correction_mc 6, phonemic_visual_mc 3, sentence_order 3, vowel_select_mc 3, word_build 3 |
| hebrew-g-writing-process | 30 | 21 | 9 | comprehension 6, root_pattern_mc 6, phonemic_visual_mc 3, vowel_select_mc 3, word_build 3 |
| hebrew-g-oral-expression | 30 | 30 | 0 | (unserved topic) comprehension 6, (unserved topic) root_pattern_mc 6, (unserved topic) spelling_correction_mc 6, (unserved topic) phonemic_visual_mc 3, (unserved topic) sentence_order 3, (unserved topic) vowel_select_mc 3, (unserved topic) word_build 3 |
| hebrew-g-metalinguistic | 30 | 18 | 12 | comprehension 6, phonemic_visual_mc 3, sentence_order 3, vowel_select_mc 3, word_build 3 |

## How this was produced (2026-09-26/27, read-only)

- Queries A and B from `npx tsx scripts/audit-format-fit.ts --sql`, run as plain SELECTs against production (project xlxyfvulqhssxiwctzvy). Bank unchanged since 2026-09-15 (latest `created_at`).
- Cross-check: query C (violating rows by id, generated from the same table) returns **677** rows, per topic identical to the report's membership counts. 677 + 11 G5 number lines = 688.
- Of the 12 number lines under operations topics, 11 are bare placements ("היכן נמצא המספר 45 על הציר?") and fail G5. The 12th (`0189baee`, ×/÷: "כפולות של 10 … איפה נמצא 70") passes: multiples count as an operation.
- Nothing was deleted, updated or reseeded. The cleanup is a separate, reviewed script; query C is its selection.

## What serving looks like once the branch ships

Serving already drops every violating row (findReusableExercise runs formatFit), so these rows stop reaching children without any data change. Topics left with few or no servable bank rows fall back to live generation:
math-g-gematria 0 (explain-only; explain_thinking is not bankable), math-g-volume and hebrew-g-oral-expression 0 (unserved), math-b-geometry 4, math-a-length 5, most Hebrew topics 6.

## The cleanup script (2026-09-27)

`scripts/format-cleanup.ts` holds the 688 ids, materialized from a fresh read-only run of this selection (count 688; md5 of the sorted ids `5150c3b5300b11ae995146ec1890dea6`, matched byte for byte). `--precheck` / `--readback` are read-only SELECTs; `--sql` is one guarded transaction that raises — rolling everything back — unless the fingerprint matches, exactly 688 rows exist and still fail the table, **no `exercise_attempts` row references them**, and the DELETE removes exactly 688.

**Not run.** `exercise_attempts.exercise_id` is `ON DELETE CASCADE`: deleting these rows would erase **55 of the 81 attempt records, for all 3 kids with history**. The script refuses on that guard as written. Keeping or archiving that history is an owner decision. Serving already drops every one of these rows, so nothing reaches a child while it waits.
