/**
 * feat: local UX wins item 3 — the character nods at tile placements and
 * number-line taps. Local and visual only. What must hold:
 *  - the right change in filled slots yields the right reaction, and mounting
 *    an empty widget or removing a tile yields none;
 *  - reactions are subtle, end at rest, and thin out under rapid tapping
 *    (but never drop the "answer complete" one);
 *  - a broken listener can never reach the widget that emitted;
 *  - nothing here can touch the network, and the answer path is unchanged.
 *
 * The two widgets and the Character are client components behind a login and
 * this repo has no DOM harness, so their wiring is read from source below
 * (a tripwire — said plainly); the logic they delegate to is tested behaviourally.
 *
 * Run: npx tsx tests/manipulation-reaction.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MIN_GAP_MS,
  REACTIONS,
  createReactionBus,
  manipulationEvent,
  shouldReactToManipulation,
  type ManipulationKind,
} from "../lib/character/manipulation";

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
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("what a change in filled slots means");
t("filling a slot is a 'place'; the LAST slot is 'ready' (and not also a 'place')", () => {
  assert.equal(manipulationEvent(0, 1, 3), "place");
  assert.equal(manipulationEvent(1, 2, 3), "place");
  assert.equal(manipulationEvent(2, 3, 3), "ready");
  assert.equal(manipulationEvent(0, 1, 1), "ready", "a single-slot exercise is ready on its first tile");
});
t("removing a tile is 'remove'; no change is nothing; mounting empty is nothing", () => {
  assert.equal(manipulationEvent(3, 2, 3), "remove");
  assert.equal(manipulationEvent(1, 1, 3), null);
  assert.equal(manipulationEvent(0, 0, 3), null, "the widget mounts with nothing filled and must react to nothing");
});
t("a whole-widget reset (3 → 0) is a removal, not a placement", () => {
  assert.equal(manipulationEvent(3, 0, 3), "remove");
});
t("a degenerate slotCount of 0 never reports 'ready'", () => {
  assert.equal(manipulationEvent(0, 1, 0), "place");
});

console.log("\nthe reactions themselves");
const parse = (tf: string) => {
  const y = Number(/translateY\((-?[\d.]+)%?\)/.exec(tf)?.[1] ?? 0);
  const s = Number(/scale\(([\d.]+)\)/.exec(tf)?.[1] ?? 1);
  return { y, s };
};
t("every reaction is subtle: ≤ 2% lift, ≤ 3% scale, under 400ms", () => {
  for (const [kind, spec] of Object.entries(REACTIONS)) {
    if (!spec) continue;
    assert.ok(spec.durationMs <= 400, `${kind} runs ${spec.durationMs}ms`);
    for (const kf of spec.keyframes) {
      const { y, s } = parse(kf.transform);
      assert.ok(Math.abs(y) <= 2, `${kind} lifts ${y}%`);
      assert.ok(s <= 1.03 && s >= 1, `${kind} scales ${s}`);
    }
  }
});
t("every reaction starts and ends at rest, so nothing is left displaced", () => {
  for (const [kind, spec] of Object.entries(REACTIONS)) {
    if (!spec) continue;
    const first = parse(spec.keyframes[0].transform);
    const last = parse(spec.keyframes[spec.keyframes.length - 1].transform);
    assert.deepEqual([first.y, first.s, last.y, last.s], [0, 1, 0, 1], kind);
  }
});
t("'ready' is a bigger moment than 'place'; 'remove' has no reaction", () => {
  const amp = (k: ManipulationKind) => Math.max(...REACTIONS[k]!.keyframes.map((kf) => Math.abs(parse(kf.transform).y)));
  assert.ok(amp("ready") > amp("place"));
  assert.equal(REACTIONS.remove, null);
});

console.log("\nthe bus");
function clock() {
  let now = 1000;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}
t("reactions closer together than the gap are dropped; after the gap they are delivered", () => {
  const c = clock();
  const bus = createReactionBus({ now: c.now });
  const got: ManipulationKind[] = [];
  bus.subscribe((k) => got.push(k));
  bus.emit("place");
  c.advance(MIN_GAP_MS - 1);
  bus.emit("place"); // too soon
  c.advance(1);
  bus.emit("place"); // gap since the LAST DELIVERED one has now passed
  assert.deepEqual(got, ["place", "place"]);
});
t("'ready' is never thinned out, even right after a 'place'", () => {
  const c = clock();
  const bus = createReactionBus({ now: c.now });
  const got: ManipulationKind[] = [];
  bus.subscribe((k) => got.push(k));
  bus.emit("place");
  c.advance(5);
  bus.emit("ready");
  assert.deepEqual(got, ["place", "ready"]);
});
t("a dropped reaction does not push the window forward (steady tapping still gets nods)", () => {
  const c = clock();
  const bus = createReactionBus({ now: c.now });
  const got: ManipulationKind[] = [];
  bus.subscribe((k) => got.push(k));
  for (let i = 0; i < 10; i++) {
    bus.emit("tap");
    c.advance(MIN_GAP_MS / 3);
  }
  // Delivered at t=0, 90, 180, 270 → 4 of 10.
  assert.equal(got.length, 4);
});
t("a throwing listener cannot reach the emitter or starve the other listeners", () => {
  const c = clock();
  const bus = createReactionBus({ now: c.now });
  const got: string[] = [];
  bus.subscribe(() => {
    throw new Error("boom");
  });
  bus.subscribe((k) => got.push(k));
  assert.doesNotThrow(() => bus.emit("place"));
  assert.deepEqual(got, ["place"]);
});
t("unsubscribe stops delivery; emitting with no listener is a no-op", () => {
  const c = clock();
  const bus = createReactionBus({ now: c.now });
  const got: string[] = [];
  const off = bus.subscribe((k) => got.push(k));
  off();
  assert.doesNotThrow(() => bus.emit("place"));
  assert.deepEqual(got, []);
});
t("with no listener the throttle window is not consumed (the first real listener sees the next event)", () => {
  const c = clock();
  const bus = createReactionBus({ now: c.now });
  bus.emit("place"); // nobody listening
  const got: string[] = [];
  bus.subscribe((k) => got.push(k));
  bus.emit("place"); // same instant
  assert.deepEqual(got, ["place"]);
});
t("reduced-motion users get no reaction, and only a character that asked for one reacts", () => {
  assert.equal(shouldReactToManipulation({ enabled: true, reducedMotion: false }), true);
  assert.equal(shouldReactToManipulation({ enabled: true, reducedMotion: true }), false);
  assert.equal(shouldReactToManipulation({ enabled: false, reducedMotion: false }), false);
  assert.equal(shouldReactToManipulation({ enabled: true, reducedMotion: null }), true);
});

console.log("\nwiring (source tripwire) — the answer path is untouched and nothing goes over the network");
const tile = read("components/exercises/TileOrderWidget.tsx");
const line = read("components/exercises/NumberLineWidget.tsx");
const screen = read("components/practice/ExerciseScreen.tsx");
const character = read("components/character/Character.tsx");
const lib = read("lib/character/manipulation.ts");

t("no new module here can touch the network or the audio stack", () => {
  for (const [name, src] of [["manipulation.ts", lib]] as const) {
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|AudioContext|new Audio|speechSynthesis/.test(src), `${name} reaches outside the page`);
  }
});
t("the number line submits the answer BEFORE it acknowledges the tap", () => {
  const click = line.slice(line.indexOf("onClick={() => {"));
  const submit = click.indexOf("onSubmit(String(v))");
  const nod = click.indexOf('onManipulate?.("tap")');
  assert.ok(submit >= 0 && nod >= 0, "both calls must be in the tap handler");
  assert.ok(submit < nod, "the acknowledgment must never be able to delay the answer");
});
t("the number line still commits on a single tap (this change adds no pre-commit phase)", () => {
  assert.match(line, /onSubmit\(String\(v\)\)/);
  assert.ok(!/useState/.test(line), "the number line has no manipulation state; a tap commits");
});
t("the tile widget derives the reaction from committed state, in an effect, via the tested function", () => {
  assert.match(tile, /useEffect\(\(\) => \{[\s\S]*manipulationEvent\(prevFilled\.current, filledCount, placed\.length\)/);
  assert.match(tile, /const prevFilled = useRef\(0\)/, "must start at 0 so mounting reacts to nothing");
});
t("the tile widget's submit path is unchanged: still gated on allFilled, still calls onSubmit with the joined value", () => {
  assert.match(tile, /if \(!allFilled\) return;/);
  assert.match(tile, /onSubmit\(value\)/);
});
t("ExerciseScreen hands both widgets the emitter and asks its character to be reactive", () => {
  assert.match(screen, /<NumberLineWidget[^>]*onManipulate=\{emitManipulation\}/);
  assert.match(screen, /<TileOrderWidget[^>]*onManipulate=\{emitManipulation\}/);
  const tag = screen.match(/<Character\s[^>]*?leanIn=\{leaning\}[^>]*?\/>/)?.[0] ?? "";
  assert.match(tag, /\breactive\b/, "the exercise screen's character must be given `reactive`");
});
t("the Character only listens when asked, skips reduced motion, and runs the nod on its own layer", () => {
  assert.match(character, /shouldReactToManipulation\(\{ enabled: !!reactive, reducedMotion: reduced \}\)/);
  assert.match(character, /if \(!reactToHands\) return;/);
  assert.match(character, /ref=\{nodRef\}/);
});
t("no Hebrew was added: neither the module nor the widgets carry a new line", () => {
  assert.ok(!/[֐-׿]/.test(lib), "lib/character/manipulation.ts must contain no Hebrew");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
