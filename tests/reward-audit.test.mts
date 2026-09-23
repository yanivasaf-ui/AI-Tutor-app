/**
 * The reward audit, enforced.
 *
 * Direction: keep station completion, unlocked content and specific
 * praise; remove or neutralise points, streaks, coins and any guilt or
 * sad-mascot state. See docs/investigations/reward-audit.md for the full
 * inventory and the star-group finding.
 *
 * A reward mechanic is easy to add back — a star here, a "3 מתוך 4" there
 * — and each one looks harmless on its own. So this test scans the
 * kid-facing source rather than trusting the inventory to stay true, and
 * fails the build when reward vocabulary reappears in a screen a child
 * sees.
 *
 * Run: npx tsx tests/reward-audit.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { POSES } from "../lib/characters";
import { topicSummary } from "../lib/feedback/constitution";
import { STREAK_TO_LEVEL_UP } from "../lib/practice/state";

let passed = 0;
const failures: string[] = [];
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}

/** Screens a child looks at. The parent dashboard is deliberately not
 *  here: a score is the right thing to show a parent. */
const KID_FACING = [
  "components/practice/ExerciseScreen.tsx",
  "components/practice/FreePractice.tsx",
  "components/map/ProgressMap.tsx",
  "components/celebration/CelebrationOverlay.tsx",
  "components/exercises/GroupingWidget.tsx",
  "components/exercises/NumberLineWidget.tsx",
  "components/exercises/TileOrderWidget.tsx",
  "lib/feedback/constitution.ts",
  "lib/guide/lines.ts",
  "lib/session/arc.ts",
];

/** String literals only: a comment explaining why a mechanic was removed
 *  must be allowed to name it. Same scanner shape as the constitution's. */
function stringLiteralsIn(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let buf = "";
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") { buf += src[i + 1] ?? ""; i += 2; continue; }
        buf += src[i];
        i++;
      }
      i++;
      out.push(buf);
    } else i++;
  }
  return out;
}

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

console.log("no reward currency in anything a child sees");

/** Each pattern is a mechanic the audit removed or ruled out. */
const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "a star as a UI token (★ / ☆)", re: /[★☆]/ },
  { name: "a score out of N (\"3 מתוך 4\")", re: /\d+\s*מתוך\s*\d+/ },
  { name: "points", re: /נקוד(ות|ה)|points?\b/i },
  { name: "coins / gems", re: /מטבע|coins?\b|gems?\b/i },
  { name: "a streak shown to the child", re: /רצף\s*של|streak/i },
  { name: "badges / trophies / XP", re: /badge|trophy|\bXP\b|גביע|מדליה/i },
  { name: "a level announced as an achievement", re: /עלינו רמה/ },
  { name: "leaderboards", re: /leaderboard|טבלת\s*מובילים/i },
];

for (const rel of KID_FACING) {
  t(`${rel} carries no reward currency`, () => {
    for (const literal of stringLiteralsIn(read(rel))) {
      for (const { name, re } of FORBIDDEN) {
        assert.ok(!re.test(literal), `${rel} contains ${name}: ${JSON.stringify(literal.slice(0, 60))}`);
      }
    }
  });
}

t("the scanner would actually catch one (it reads literals, not comments)", () => {
  const planted = 'const banner = "עלינו רמה! ⭐";';
  const hit = stringLiteralsIn(planted).some((l) => FORBIDDEN.some(({ re }) => re.test(l)));
  assert.ok(hit, "a planted reward badge must be caught");
  assert.equal(stringLiteralsIn("// ★★☆ was removed here").length, 0, "a comment may name what was removed");
});

console.log("\nwhat was removed stays removed");

t("LevelStars (★★☆) is gone from the exercise screen", () => {
  const src = read("components/practice/ExerciseScreen.tsx");
  assert.ok(!/function LevelStars/.test(src), "the component must not come back");
  assert.ok(!/<LevelStars/.test(src), "...nor be rendered");
  assert.ok(!/levelBump/.test(src), "and its animation counter is dead state once it goes");
});

t("the station summary states no mark", () => {
  const said = topicSummary({ attempted: 4, correct: 1, topicLabel: '"השעון"' });
  assert.ok(!/\d+\s*מתוך\s*\d+/.test(said), `a score survived: ${said}`);
  assert.match(said, /סיימנו את התחנה/, "what is kept is that the station was finished");
  // The worst case is the one that matters: 1 of 4 must read the same as 4 of 4.
  const bad = topicSummary({ attempted: 4, correct: 1 });
  const good = topicSummary({ attempted: 4, correct: 4 });
  assert.equal(bad, good, "a child who found it hard must not be handed a worse sentence");
});

console.log("\nwhat was kept, stays kept");

t("station completion and the map's locked/unlocked states are untouched", () => {
  const map = read("components/map/ProgressMap.tsx");
  // The literal itself, not merely the word: "locked" also appears in the
  // type union and in handler names, so a mutation that stopped EMITTING
  // the state would still leave the word all over the file.
  assert.match(map, /return "locked";/, "the map must still be able to lock a stop");
  assert.match(map, /onLockedTap/, "and still answer a tap on one");
  const screen = read("components/practice/ExerciseScreen.tsx");
  assert.match(screen, /topicCelebration/, "station completion still celebrates");
});

t("the progress strip stays — position in a station is not a score", () => {
  const src = read("components/practice/ExerciseScreen.tsx");
  assert.match(src, /PROGRESS_SEGMENTS/);
});

t("specific praise stays", () => {
  assert.match(read("lib/feedback/constitution.ts"), /STRATEGY_PRAISE_EXAMPLE/);
});

t("the adaptive level itself is untouched — it is difficulty, not a score", () => {
  // Imported, not grepped: a rename would grep clean and break the import.
  assert.equal(typeof STREAK_TO_LEVEL_UP, "number", "the streak still selects difficulty");
  assert.ok(STREAK_TO_LEVEL_UP >= 1);
  // ...but it must not be rendered to the child anywhere.
  for (const rel of KID_FACING) {
    assert.ok(!/practice\?\.level &&/.test(read(rel)), `${rel} renders the level to the child`);
  }
});

console.log("\nno guilt, and no sad mascot to show");

t("the pose set contains no sad, disappointed or crying state", () => {
  for (const pose of POSES) {
    assert.ok(!/sad|disappoint|upset|cry|angry/.test(pose), `a guilt pose exists: ${pose}`);
  }
  assert.ok(POSES.includes("encouraging"), "the wrong-answer pose is encouraging");
});

t("no kid-facing copy uses loss or guilt framing", () => {
  const GUILT = /לא יישמר|תוותר|הפסדת|חבל ש|למה לא|אכזבת/;
  for (const rel of KID_FACING) {
    for (const literal of stringLiteralsIn(read(rel))) {
      assert.ok(!GUILT.test(literal), `${rel}: ${JSON.stringify(literal.slice(0, 60))}`);
    }
  }
});

console.log("\nthe inventory is complete");

t("every mechanic the scan can find is written down in the audit doc", () => {
  const doc = read("docs/investigations/reward-audit.md");
  for (const name of [
    "LevelStars", "עלינו רמה", "topicSummary", "levelBump", "STREAK_TO_LEVEL_UP",
    "PROGRESS_SEGMENTS", "ProgressMap", "useCelebration", "CelebrationOverlay",
    "MODEL_RULES", "characters.ts",
  ]) {
    assert.ok(doc.includes(name), `the inventory does not account for ${name}`);
  }
  assert.match(doc, /star group exercise/i, "the star-group finding must be recorded");
  assert.match(doc, /symbol collision/i, "...including WHY it was the symbol and not the mechanic");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
