# Bank content-quality audit — 2026-09-27 (read-only)

Six defect classes the QA sweeps found, checked across the whole bank (1,036 rows) with read-only SQL, candidate rows reviewed by hand. **No row was changed.** The rows still served get a reviewed fix script (`npx tsx scripts/bank-content-fixes.ts --sql`, one guarded transaction; each UPDATE matches the row's id *and* its audited text; a read-only count confirmed all 3 guards match today). Every other defective row is already out of serving on this branch.

All new Hebrew below is **UDI REVIEW**.

## Fixes for rows still served (script, not run)

| Row | Class | Before | After |
|---|---|---|---|
| `719065d0` math-b-data | (e) typo | `🍇 עניבים: 6 ילדים` | `🍇 ענבים: 6 ילדים` |
| `d69ffd9f` math-g-×÷ | (d) gender | `לרון יש 35 מדבקות. היא רוצה לחלק…` | `לרון יש 35 מדבקות. הוא רוצה לחלק…` |
| `489e88bf` math-g-×÷ | (d) gender | `לאורי יש 24 מדבקות. היא רוצה לחלק…` | `לאורי יש 24 מדבקות. הוא רוצה לחלק…` |

Each "after" passes every serving check (format table, operation scope, topic fit, quality gate); each "before" is served today (tests/bank-content.test.mts).

## Defective rows already out of serving (no content fix; the format cleanup removes them)

| Row | Topic / format | Class | Defect | Refused by |
|---|---|---|---|---|
| `cb7afb8d` | זוויות ג / number line | (a) | "למשולש יש 3 זוויות. היכן נמצא המספר 3" | format table |
| `1263f8cf` | זוויות ג / number line | (a) | "3 זוויות היו חדות … כמה זוויות חדות" | format table |
| `d47d1a63` | גופים ג / pick-operation | (a) | "לשש מלבנים … כמה מלבנים" — graded `6 × 1` | unserved topic |
| `1405203b` | שטח ג / sequence | (b) | squares of 14, 19 סמ"ר (answer 24) | format table + new gate rule |
| `9a3529d5` | צורות ב / pick-operation | (c) | toothpicks: `3 + 3` and `3 × 2` both offered | format table + new gate rule |
| `5e3330c2` | נתונים א / pick-operation | (c) | `3 + 5` and `5 + 3` both offered (also "בשני העונות") | topic fit + new gate rule |
| `0eaad9a4` | משחקים במילים ב / comprehension | (c) | ילדים and משחקים both carry plural ים- | format table (G6) |
| `66a11e66` | משחקים במילים ב / comprehension | (c) | asks for a noun; all four options are adjectives | format table (G6) |
| `740bf828`, `dd676976`, `44977a5e` | גופים ג / sequence | (d) | "מיכל … יש לו" | unserved topic |
| `7ce2de2e` | גופים ג / equation | (d) | "מיכל כבר צייר … הוא צריך" | unserved topic |
| `78c0e1d1` | מטא-לשוני ג / comprehension | (e) | "'ציור', 'ציור'" twice in the word list | format table (G6) + new gate rule |
| `a2b1e746` | כתיב תקני ב / comprehension | (e) | hint "חפשו אות שצריכה להיות אחרת", answer "כל המילים נכתבו נכון" | format table (G6) + new gate rule |
| `8e543fef` | גימטרייה ג / grouping | (f) | division as counting 18 letters | format table (explain only) |
| `804ae2af` | לספור ולסדר ג / grouping | (f) | pictogram: "divide the apples into 3 groups to organize the data" | format table |

## New gate rules (generation retries, serving drops)

- (b) a square's stated area is a whole number squared (only when the areas are said to be squares' and no other shape is in the question);
- (c) two options that are the same computation (`3 + 5`/`5 + 3`, `3 + 3`/`3 × 2`); different computations with the same value (`8 − 5`/`6 − 3`) are not flagged;
- (e) the same word twice in a comma-separated quoted list — every subject;
- (e) a hint that there is an error to find when the answer is "all correct" — every subject.

## Gaps (not improvised)

1. **(a) number lines in the length topics.** "The tree is 45 cm. Where is 45 on the line?" names its own answer. Everywhere else such rows are refused (numbers topics: placing a named number *is* the skill; operations topics: G5; other topics: no number-line format). In math-a-length (5 rows) and math-b-length (1 row) the table allows the number line, and G2 made a-length "measurement only (ruler / number line)". Refusing them would leave a-length with no bank rows. Owner decision needed.
2. **(a) "N things … how many things?"** has no general code rule: the pattern also matches honest comparisons whose answer happens to equal a story number (e.g. `1de8ced9`, 18 − 9 = 9). All instances found are already out of serving.
3. **(d) gender** has no code rule: name-and-pronoun matching gave 13 false positives out of 19 (pronouns referring to objects). The audit was that match plus a manual review.
4. **(e) typos** have no general detector (no Hebrew spell-checker in the stack). `עניבים` was found by searching fruit contexts.
5. **(b) impossible content** beyond non-square areas is judgment; the model review (off) is the only other check.
