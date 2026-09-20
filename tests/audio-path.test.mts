/**
 * Production hotfix (2026-09-20): iPhone Safari went completely silent for
 * exercise questions after the MediaSource streaming path shipped.
 *
 * Two pure pieces, tested with no DOM and no real clock:
 *
 *  1. The platform gate — iOS/iPadOS (every browser there is WebKit) must
 *     get the blob path; desktop Chrome must keep streaming.
 *  2. The stall watchdog — must fire when nothing plays by the deadline,
 *     and must stay SILENT when playback is healthy. A watchdog that fires
 *     on a healthy line would replay it over itself, so the negative cases
 *     matter as much as the positive one.
 *
 * Run: npx tsx tests/audio-path.test.mts
 */
import assert from "node:assert/strict";
import {
  STALL_TIMEOUT_MS,
  isIOSWebKit,
  mseStreamingAllowed,
  pickAudioPath,
  startStallWatchdog,
  type AudioEnv,
} from "../lib/speech/audioPath";

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

// Real-world UA strings, so this fails on the devices it is about rather
// than on a tidied-up imitation of them.
const UA = {
  iPhoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iPhoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  iPhoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iPadSafariMobile:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ default: identifies as a Mac, tells the truth only in touch points.
  iPadSafariDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  desktopChromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  desktopChromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  desktopChromeLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
};
const env = (userAgent: string, maxTouchPoints = 0): AudioEnv => ({ userAgent, maxTouchPoints });

console.log("the iOS gate: blob-only on WebKit-on-iOS, MSE kept everywhere else");

t("iPhone Safari is gated to blob-only", () => {
  assert.equal(isIOSWebKit(env(UA.iPhoneSafari, 5)), true);
  assert.equal(mseStreamingAllowed(env(UA.iPhoneSafari, 5)), false);
});

t("iPhone Chrome and Firefox are gated too — Apple makes them WebKit on iOS", () => {
  assert.equal(mseStreamingAllowed(env(UA.iPhoneChrome, 5)), false);
  assert.equal(mseStreamingAllowed(env(UA.iPhoneFirefox, 5)), false);
});

t("iPad, in both its mobile and its default desktop-mode UA, is gated", () => {
  assert.equal(mseStreamingAllowed(env(UA.iPadSafariMobile, 5)), false);
  // The trap: this UA says Macintosh. Touch points are the only tell.
  assert.equal(mseStreamingAllowed(env(UA.iPadSafariDesktopMode, 5)), false);
});

t("desktop Chrome keeps MSE streaming on Mac, Windows and Linux", () => {
  for (const ua of [UA.desktopChromeMac, UA.desktopChromeWin, UA.desktopChromeLinux]) {
    assert.equal(mseStreamingAllowed(env(ua, 0)), true, ua);
  }
});

t("a real Mac (0 touch points) is not mistaken for an iPad", () => {
  assert.equal(isIOSWebKit(env(UA.iPadSafariDesktopMode, 0)), false);
});

t("Android Chrome keeps MSE streaming", () => {
  assert.equal(mseStreamingAllowed(env(UA.androidChrome, 5)), true);
});

t("the gate is decided before any MediaSource API is consulted", () => {
  let consulted = false;
  const choice = pickAudioPath(env(UA.iPhoneSafari, 5), () => ((consulted = true), true), false);
  assert.deepEqual(choice, { path: "blob", reason: "ios-webkit-gate" });
  assert.equal(consulted, false, "on iOS not even isTypeSupported may run — that is the whole point of gating");
});

t("desktop Chrome with MediaSource gets the streaming path", () => {
  assert.deepEqual(pickAudioPath(env(UA.desktopChromeMac), () => true, false), { path: "mse", reason: "streaming" });
});

t("no MediaSource, or MSE already disabled this session, means blob", () => {
  assert.equal(pickAudioPath(env(UA.desktopChromeMac), () => false, false).path, "blob");
  assert.deepEqual(pickAudioPath(env(UA.desktopChromeMac), () => true, true), {
    path: "blob",
    reason: "mse-disabled-after-stall",
  });
});

console.log("\nthe stall watchdog");

/** A clock the test drives by hand. */
function fakeClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      now += ms;
      for (const [id, tm] of [...timers]) {
        if (tm.at <= now) {
          timers.delete(id);
          tm.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

t("the deadline is 2.5s, as specified", () => {
  assert.equal(STALL_TIMEOUT_MS, 2500);
});

t("FIRES on a simulated stall: nothing playing at 2.5s", () => {
  const clock = fakeClock();
  let stalls = 0;
  startStallWatchdog({ isPlaying: () => false, onStall: () => stalls++, ...clock });
  clock.advance(2499);
  assert.equal(stalls, 0, "must not fire before the deadline");
  clock.advance(1);
  assert.equal(stalls, 1, "must fire exactly at the deadline");
  clock.advance(60_000);
  assert.equal(stalls, 1, "must fire once, never repeatedly");
});

t("does NOT fire on normal playback: a 'playing' event was seen by the deadline", () => {
  const clock = fakeClock();
  let stalls = 0;
  let playing = false;
  startStallWatchdog({ isPlaying: () => playing, onStall: () => stalls++, ...clock });
  clock.advance(400);
  playing = true; // the element's onplaying fired
  clock.advance(5000);
  assert.equal(stalls, 0);
});

t("does NOT fire when currentTime advanced even if no 'playing' event arrived", () => {
  const clock = fakeClock();
  let stalls = 0;
  let currentTime = 0;
  startStallWatchdog({ isPlaying: () => currentTime > 0, onStall: () => stalls++, ...clock });
  clock.advance(1000);
  currentTime = 0.8;
  clock.advance(5000);
  assert.equal(stalls, 0);
});

t("cancel() before the deadline means it never fires (line ended or was superseded)", () => {
  const clock = fakeClock();
  let stalls = 0;
  const wd = startStallWatchdog({ isPlaying: () => false, onStall: () => stalls++, ...clock });
  clock.advance(1000);
  wd.cancel();
  assert.equal(clock.pending(), 0, "the timer itself must be cleared, not just ignored");
  clock.advance(10_000);
  assert.equal(stalls, 0);
});

t("cancel() after it already fired is harmless", () => {
  const clock = fakeClock();
  let stalls = 0;
  const wd = startStallWatchdog({ isPlaying: () => false, onStall: () => stalls++, ...clock });
  clock.advance(2500);
  wd.cancel();
  assert.equal(stalls, 1);
});

t("a custom timeout is honoured", () => {
  const clock = fakeClock();
  let stalls = 0;
  startStallWatchdog({ isPlaying: () => false, onStall: () => stalls++, timeoutMs: 100, ...clock });
  clock.advance(99);
  assert.equal(stalls, 0);
  clock.advance(1);
  assert.equal(stalls, 1);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
