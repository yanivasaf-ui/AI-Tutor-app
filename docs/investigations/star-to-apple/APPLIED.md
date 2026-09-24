# Star → apple: APPLIED 2026-09-24

The migration scripted in `ccefad8` was **applied to production on
2026-09-24**. That commit's message says "not yet applied", which was true
when it was written and is not true now; commit messages are immutable once
pushed, so this file is the correction.

| | |
|---|---|
| Applied | 2026-09-24 |
| Rows changed | **19** (of 19 in the dump) |
| Table | `public.exercises`, columns `question` and `grouping` only |
| Script | `scripts/swap-star-to-apple.ts` @ `ccefad8` |
| Undo | `rollback.sql` in this directory |

## What ran
`apply.sql` — 19 `UPDATE`s in a single call, each guarded on the row's
old question text. Star ⭐ → apple 🍎 in `grouping.items`, and
"כוכבים" → "תפוחים" in the question. One row (`a8246147`) needed a
hand-written override, because "נוצצים" (sparkling) and a toy shop do not
describe apples; it now reads "בחנות פירות יש 18 תפוחים אדומים…".

## How it was verified
A fresh read of the 19 rows immediately before the apply, then a read-back
after, compared against baselines taken before:

- **Before:** all 19 rows matched the dump (question hash, item count,
  groupCount, every item a star); exactly 19 star-grouping rows existed.
- **After, per row:** question equals the intended new text; every item is
  🍎 with the same count and groupCount; no "כוכב" or ⭐ anywhere in the
  row; every column other than `question` and `grouping` hashes identically
  to before.
- **Whole table:** 1,036 rows before and after. The other 1,017 rows hash
  to `f714a09aa04593f197bfa0e19655774b` before and after, so no other row
  moved. Star-grouping rows went 19 → 0.

## How to undo
Run `rollback.sql` against `public.exercises`. Each statement is guarded on
the *apple* text, so it only fires on a row that is currently swapped and is
a no-op on any row edited since. `rows-before.json` is the input the undo
cannot be rebuilt without: the query that produced it selects rows
containing a star, and there are none left.

A test (`tests/star-swap.test.mts`) regenerates both SQL files from
`rows-before.json` on every run and fails if either committed file differs,
so this undo path cannot drift silently.

## Not done, and not part of this
The bank rows were the only thing changed. The prompt example in
`lib/exercises/generate.ts` that still offers the model "🍎 או ⭐" for
future grouping exercises was left alone, so newly generated rows can
still come back with a star.
