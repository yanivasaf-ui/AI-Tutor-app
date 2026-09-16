"use client";

import { useEffect, useRef, useState } from "react";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import * as lines from "@/lib/guide/lines";
import { useGuide } from "@/lib/guide/useGuide";
import { MAX_CHAT_EXCHANGES, type ChatMode } from "@/lib/memory/kidMemory";
import type { CharacterId } from "@/lib/characters";

const OWNER = "chat";

interface Turn {
  role: "kid" | "character";
  content: string;
}

/**
 * feat: scoped kid chat — the ONLY chat surface in the app, and it is
 * mounted in exactly two places: the last step of onboarding, and the daily
 * check-in reached from ModeChoice. There is no general chat entry point,
 * by design; the server would refuse any other mode anyway.
 *
 * The character's opening line is templated (lib/guide/lines.ts's
 * chatOpening), not generated — a fixed question costs no model call and
 * lets the kid see something the instant the screen opens.
 *
 * Text input only. Voice is deliberately out of scope here: the mic stack
 * is built around short answer-matching utterances (lib/voice/matchAnswer),
 * not free sentences, and wiring STT into a conversation is its own piece
 * of work.
 */
export default function ScopedChat({
  mode,
  kidId,
  kidName,
  character,
  sessionId,
  onDone,
  doneLabel = "יאללה, מתחילים!",
}: {
  mode: ChatMode;
  kidId: string;
  kidName: string;
  character: CharacterId;
  sessionId?: string;
  onDone: () => void;
  doneLabel?: string;
}) {
  const opening = lines.chatOpening(mode, kidName);
  const [turns, setTurns] = useState<Turn[]>([{ role: "character", content: opening.text }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const last = turns[turns.length - 1];
  const characterLine =
    last?.role === "character" ? { name: kidName, text: last.content } : { name: kidName, text: "" };
  const guide = useGuide({
    owner: OWNER,
    character,
    pose: done ? "celebration" : busy ? "thinking" : "explaining",
    line: characterLine.text ? characterLine : null,
    cue: String(turns.length),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy || done) return;
    setInput("");
    setFailed(false);
    const history = turns;
    setTurns((t) => [...t, { role: "kid", content: text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scoped_chat", mode, kidId, message: text, character, history, sessionId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { reply: string; done?: boolean };
      setTurns((t) => [...t, { role: "character", content: data.reply }]);
      if (data.done) setDone(true);
    } catch {
      // A chat that breaks must never trap a kid on this screen — the way
      // forward stays open and the session continues without it.
      setFailed(true);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  const kidTurns = turns.filter((t) => t.role === "kid").length;

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-3">
      <button type="button" onClick={() => guide.say(characterLine)} aria-label="להקשיב שוב" className="mt-1">
        <Character character={character} pose={guide.pose} size={168} />
      </button>

      <div
        ref={scrollRef}
        className="w-full max-h-64 overflow-y-auto flex flex-col gap-2 px-1"
        aria-live="polite"
      >
        {turns.map((t, i) =>
          t.role === "character" ? (
            <SpeechBubble
              key={i}
              text={t.content}
              owner={OWNER}
              character={character}
              className="w-full"
            />
          ) : (
            <p
              key={i}
              className="self-start max-w-[80%] rounded-[var(--radius-bubble)] bg-[var(--color-teal)] text-white px-4 py-2 text-lg"
            >
              {t.content}
            </p>
          )
        )}
        {busy && <p className="text-sm text-[var(--color-ink-soft)] px-2">רגע...</p>}
      </div>

      {failed && (
        <p className="text-sm text-[var(--color-ink-soft)]">משהו השתבש בשיחה, אבל אפשר להמשיך.</p>
      )}

      {done ? (
        <button
          onClick={onDone}
          className="min-h-16 px-10 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium"
        >
          {doneLabel}
        </button>
      ) : (
        <div className="w-full flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="מה שבא לכם לספר..."
            aria-label="ההודעה שלי"
            disabled={busy}
            maxLength={300}
            className="flex-1 min-h-14 rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/30 bg-[var(--color-surface)] px-4 text-lg"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="min-h-14 px-5 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-lg font-medium disabled:opacity-50"
          >
            שלח
          </button>
        </div>
      )}

      {/* The kid can always leave. A conversation that can only be finished
          is a trap, and this one is optional by design. */}
      {!done && (
        <button onClick={onDone} className="min-h-11 px-4 text-sm text-[var(--color-ink-soft)] underline">
          דלג
        </button>
      )}

      <p className="text-xs text-[var(--color-ink-soft)]">
        {kidTurns}/{MAX_CHAT_EXCHANGES}
      </p>
    </div>
  );
}
