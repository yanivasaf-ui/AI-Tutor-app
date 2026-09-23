# Reward audit — 2026-09-23

Every reward-like mechanic in the app, what happened to it, and why.

The direction: **keep station completion, unlocked content and specific
praise; remove or neutralise points, streaks, coins and any guilt or
sad-mascot state.**

## Inventory

| # | Mechanic | Where | Verdict |
|---|---|---|---|
| 1 | `LevelStars` — ★★☆ in the top bar, always visible, `aria-label="רמה 2 מתוך 3"` | `ExerciseScreen.tsx` | **Removed** |
| 2 | `עלינו רמה! ⭐` level-up badge | `ExerciseScreen.tsx` | **Removed** |
| 3 | Station score "ענית נכון על X מתוך N" | `constitution.topicSummary` | **Neutralised** — now says the station was finished and how many problems were worked, with no mark |
| 4 | `levelBump` animation counter | `ExerciseScreen.tsx` | **Removed** (dead once 1 and 2 went) |
| 5 | `streak` / `STREAK_TO_LEVEL_UP = 2` | `lib/practice/state.ts` | **Kept, internal.** Never displayed; it selects the next exercise's difficulty. Removing it would remove adaptivity, not a reward. |
| 6 | 5-segment progress strip (`PROGRESS_SEGMENTS`) | `ExerciseScreen.tsx` | **Kept** — position inside a station, not a score. Fills with distinct problems attempted and is not compared to anything. |
| 7 | Station completion + map unlock (`locked` / `walked` / `ahead`) | `ProgressMap.tsx` | **Kept** — explicitly in the direction |
| 8 | Tier-1 celebration (confetti burst from the bubble) | `useCelebration.ts` | **Kept** |
| 9 | Tier-2 celebration (full-screen, confetti, sound) | `CelebrationOverlay.tsx` | **Kept** — fires on station completion and session close |
| 10 | Specific praise (strategy-named) | `constitution.MODEL_RULES` | **Kept** — explicitly in the direction |
| 11 | Character poses | `lib/characters.ts` | **Nothing to do.** The set is `idle, hello, explaining, thinking, talking-open, talking-closed, correct, encouraging, celebration, goodbye`. There is no sad, disappointed or crying pose; `encouraging` is the wrong-answer pose. |
| 12 | Session close overlay | `ExerciseScreen.tsx` | **Kept**, and as of the session-arc change it narrates what improved rather than a score |

**Not present anywhere:** points, coins, gems, badges, trophies, XP,
leaderboards, daily streaks shown to the child, loss-framed timers. The
reward surface was smaller than expected — it was essentially *the star
level display* plus two score readouts.

## The star group exercise

Flagged in research as possibly evidence-opposed. Audited before changing.

**Finding: the mechanic is sound; the symbol was the problem.**

`GroupingWidget` asks a child to distribute items into equal groups by
tapping — partitive division made concrete. That is an evidence-*aligned*
manipulative, not an evidence-opposed reward, and it is the only place in
the app where division is physical rather than symbolic.

What was wrong is a **symbol collision**. ⭐ was simultaneously:

- the app's reward currency (`LevelStars` ★, `עלינו רמה! ⭐`), and
- the math object being divided ("לאורי יש 12 כוכבים ⭐. חלק אותם ל-4
  קבוצות שוות").

So the app taught "stars are what you earn", then asked the child to sort
earnings into piles. Removing items 1 and 2 above dissolves the collision
**from the app side**: stars are no longer a currency anywhere in the UI,
so a star in a grouping exercise is just a countable object.

**Not changed, and flagged instead:** the bank rows still use ⭐ as the
grouping emoji. Changing them is a write to production exercise content,
which is a separate decision from a UI audit. If the collision is judged
still live, the fix is an emoji swap in those rows (🍎/🌸/🎈 already appear
in other grouping rows and carry no reward meaning) — not a change to the
grouping mechanic, which should stay.

**Also noted, unchanged:** the widget's own header records a 2026-09-12
iPhone QA finding that distributing up to 20 items one tap at a time was a
dead end; it was mitigated with a placement counter and a numeric
shortcut. That mitigation is still in place.

## What guards this

`tests/reward-audit.test.mts` scans the kid-facing source for reward
vocabulary and symbols and fails the build if any reappears in a screen a
child sees. The inventory above is asserted against that scan, so a
mechanic added later either lands in the table or fails the test.
