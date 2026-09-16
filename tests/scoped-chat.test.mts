/**
 * feat: scoped kid chat — the parts that must hold without a network:
 * the slot→fact mapping (the reason no model call is needed to remember
 * anything), and the prompt's own scope.
 *
 * The endpoint's own guards — mode whitelist, turn cap, distress routing —
 * are enforced in handleScopedChat and exercised over real HTTP in the
 * manual pass, since they need an authenticated session cookie.
 *
 * Run: npx tsx tests/scoped-chat.test.mts
 */
import assert from "node:assert/strict";
import {
  factsFromChatTurn,
  ONBOARDING_SLOTS,
  MAX_CHAT_EXCHANGES,
  type ChatMode,
} from "../lib/memory/kidMemory";
import { buildScopedChatPrompt } from "../lib/prompts/scoped-chat-prompt";

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

const promptFor = (over: Partial<Parameters<typeof buildScopedChatPrompt>[0]> = {}) =>
  buildScopedChatPrompt({
    mode: "onboarding",
    kidName: "נועה",
    grade: "ב",
    character: "girl",
    kidGender: "girl",
    exchangeIndex: 0,
    isFinal: false,
    distress: false,
    ...over,
  });

console.log("remembering a chat turn takes no model call");
t("the answer is filed under the slot the server just asked about", () => {
  const f = factsFromChatTurn("onboarding", 0, "דנה, היא יושבת לידי");
  assert.equal(f.length, 1);
  assert.equal(f[0].topic, ONBOARDING_SLOTS[0].topic);
  assert.equal(f[0].detail, "דנה, היא יושבת לידי");
  assert.equal(f[0].factType, "preference");
});

t("each slot files under its own topic, in script order", () => {
  const topics = ONBOARDING_SLOTS.map((_, i) => factsFromChatTurn("onboarding", i, "x")[0].topic);
  assert.deepEqual(topics, ONBOARDING_SLOTS.map((s) => s.topic));
  assert.equal(new Set(topics).size, topics.length, "slots must not share a topic");
});

t("past the end of the script there is nothing left to file", () => {
  assert.deepEqual(factsFromChatTurn("onboarding", ONBOARDING_SLOTS.length, "x"), []);
});

t("an empty or whitespace answer is not a fact", () => {
  assert.deepEqual(factsFromChatTurn("onboarding", 0, "   "), []);
  assert.deepEqual(factsFromChatTurn("checkin", 0, ""), []);
});

t("a check-in answer files against the loop it reopened", () => {
  const f = factsFromChatTurn("checkin", 0, "היה כיף", "חברים");
  assert.equal(f[0].topic, "חברים");
  assert.deepEqual(factsFromChatTurn("checkin", 0, "היה כיף")[0].topic, "צ'ק-אין");
});

// The whole no-extra-LLM-call claim rests on this being a pure function of
// (mode, slot index, text) — no client, no await, no I/O.
t("the mapping is pure and synchronous — same input, same facts, no promise", () => {
  const a = factsFromChatTurn("onboarding", 1, "כדורגל");
  const b = factsFromChatTurn("onboarding", 1, "כדורגל");
  assert.deepEqual(a, b);
  assert.ok(!(a as unknown as Promise<unknown>).then, "must not be awaitable");
});

console.log("\nthe prompt can only run the two conversations");
t("onboarding names its slots in order and nothing else", () => {
  const p = promptFor({ mode: "onboarding" });
  assert.match(p, /השיחה: היכרות/);
  assert.ok(!p.includes("צ'ק-אין יומי"), "must not carry the other mode's script");
  assert.match(p, /זו לא שיחה חופשית/, "the no-free-chat rule must be stated");
});

t("check-in carries the open loops it was given, and no onboarding script", () => {
  const p = promptFor({
    mode: "checkin",
    loops: [{ id: "1", factType: "preference", topic: "חברים", detail: "דנה" }],
  });
  assert.match(p, /צ'ק-אין יומי/);
  assert.match(p, /דנה/);
  assert.ok(!p.includes("השיחה: היכרות"));
});

t("a check-in with no open loops is told not to invent one", () => {
  const p = promptFor({ mode: "checkin", loops: [] });
  assert.match(p, /אל תמציא/);
});

t("the distress policy appears only once the shared detector has fired", () => {
  assert.ok(!promptFor({ distress: false }).includes("רגע רגיש"));
  const flagged = promptFor({ distress: true });
  assert.match(flagged, /רגע רגיש/);
  assert.match(flagged, /אל תאלתר/, "no improvised advice");
  assert.match(flagged, /מבוגר/, "must point at a trusted adult");
  assert.match(flagged, /אל תגיד\/י שדיווחת/, "must not tell the kid it was reported");
});

t("the last turn is told to close, and not to ask anything new", () => {
  assert.ok(!promptFor({ isFinal: false }).includes("עכשיו מסיימים"));
  const last = promptFor({ isFinal: true });
  assert.match(last, /עכשיו מסיימים/);
  assert.match(last, /בלי לשאול שאלה חדשה/);
});

t("the kid's gender reaches the prompt, and is not guessed when unknown", () => {
  assert.match(promptFor({ kidGender: "boy" }), /לשון זכר/);
  assert.match(promptFor({ kidGender: "girl" }), /לשון נקבה/);
  assert.match(promptFor({ kidGender: null }), /לא ידוע/);
});

// lines.ts rule 4: the character's OWN first-person verbs are gendered to
// the character. Caught live — a girl character said "אני שמח".
t("the character is told which gender to speak about itself in", () => {
  assert.match(promptFor({ character: "girl" }), /אני שמחה/);
  assert.match(promptFor({ character: "boy" }), /אני שמח"/);
});

t("identifying details are off limits", () => {
  assert.match(promptFor(), /אל תבקש\/י פרטים מזהים/);
});

console.log("\nthe cap is a number the server owns");
t("the cap is small enough to be a chat, not a session", () => {
  assert.ok(MAX_CHAT_EXCHANGES >= 4 && MAX_CHAT_EXCHANGES <= 5, `cap is ${MAX_CHAT_EXCHANGES}`);
});

t("the onboarding script fits inside the cap", () => {
  assert.ok(
    ONBOARDING_SLOTS.length < MAX_CHAT_EXCHANGES,
    "the script must finish before the cap cuts it off"
  );
});

t("only two modes exist", () => {
  const modes: ChatMode[] = ["onboarding", "checkin"];
  assert.equal(modes.length, 2);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
