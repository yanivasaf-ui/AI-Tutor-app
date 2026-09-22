"use client";

import { useState } from "react";
import { parseHomeworkProblem, type ParsedProblem } from "@/lib/homework/parseProblem";
import { startSession, submitStep, type SessionState } from "@/lib/homework/socratic";
import * as copy from "@/lib/homework/lines";

/**
 * The homework prototype's whole surface.
 *
 * Everything runs in the browser: the parser and the walkthrough are pure
 * functions over lib/exercises/arithmetic.ts, so there is no API route, no
 * model call and no network at all. That is not an optimisation — it is
 * what makes "nothing persists beyond the session" true by construction
 * rather than by policy, and what lets the walkthrough's one invariant
 * (never the answer first) be a tested property instead of a prompt.
 */
export default function HomeworkHelp() {
  const [problem, setProblem] = useState("");
  const [parsed, setParsed] = useState<ParsedProblem | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");

  function start() {
    const result = parseHomeworkProblem(problem);
    setParsed(result);
    setAnswer("");
    if (result.kind !== "arithmetic") {
      setSession(null);
      setTranscript([]);
      return;
    }
    const turn = startSession(result.computation);
    setSession(turn.state);
    setTranscript(turn.lines);
  }

  function check() {
    if (!session) return;
    const turn = submitStep(session, answer);
    setSession(turn.state);
    setTranscript((prev) => [...prev, `· ${answer}`, ...turn.lines]);
    setAnswer("");
  }

  function reset() {
    setProblem("");
    setParsed(null);
    setSession(null);
    setTranscript([]);
    setAnswer("");
  }

  const decline =
    parsed?.kind === "asking-for-answer"
      ? copy.DECLINE_ASKING_FOR_ANSWER
      : parsed?.kind === "not-math"
        ? parsed.reason === "unsupported-result"
          ? copy.DECLINE_UNSUPPORTED
          : copy.DECLINE_NOT_MATH
        : null;

  return (
    <main dir="rtl" className="flex flex-col gap-5 max-w-xl mx-auto px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[var(--color-ink)]">{copy.HOMEWORK_TITLE}</h1>
        <p className="text-[var(--color-ink-soft)]">{copy.HOMEWORK_SUBTITLE}</p>
      </header>

      {!session && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="font-bold">{copy.INPUT_LABEL}</span>
            <input
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start()}
              placeholder={copy.INPUT_PLACEHOLDER}
              className="h-14 px-4 text-xl rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/40 bg-[var(--color-surface)]"
            />
          </label>
          <button
            onClick={start}
            disabled={!problem.trim()}
            className="self-start min-h-14 px-8 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-lg font-bold disabled:opacity-40"
          >
            {copy.START}
          </button>
          {decline && (
            <p role="status" className="rounded-[var(--radius-card)] border-2 border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)]/30 px-4 py-3 text-lg">
              {decline}
            </p>
          )}
        </div>
      )}

      {session && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {transcript.map((line, i) => (
              <p
                key={i}
                className={
                  line.startsWith("· ")
                    ? "self-start rounded-[var(--radius-card)] bg-[var(--color-surface)] border-2 border-[var(--color-teal)]/20 px-3 py-1 text-lg"
                    : "text-lg text-[var(--color-ink)]"
                }
              >
                {line.startsWith("· ") ? line.slice(2) : line}
              </p>
            ))}
          </div>

          {session.phase === "asking" && (
            <div className="flex gap-2">
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && check()}
                inputMode="numeric"
                dir="ltr"
                aria-label={copy.ANSWER_LABEL}
                className="h-14 w-32 text-center text-xl rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/40 bg-[var(--color-surface)]"
              />
              <button
                onClick={check}
                disabled={!answer.trim()}
                className="min-h-14 px-6 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-lg font-bold disabled:opacity-40"
              >
                {copy.CHECK}
              </button>
            </div>
          )}

          <button onClick={reset} className="self-start min-h-12 px-6 rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/50 text-lg font-bold">
            {copy.RESTART}
          </button>
        </div>
      )}
    </main>
  );
}
