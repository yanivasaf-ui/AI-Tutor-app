"use client";

import { useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const GRADES = ["א", "ב", "ג"] as const;
const SUBJECTS = [
  { value: "math", label: "חשבון" },
  { value: "hebrew", label: "עברית" },
] as const;

export default function Home() {
  const [grade, setGrade] = useState<(typeof GRADES)[number]>("א");
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]["value"]>("math");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!input.trim() || loading) return;
    const userMessage: Message = { role: "user", content: input };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          subject,
          grade,
          history: messages,
        }),
      });
      const data = await res.json();
      setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages([
        ...nextMessages,
        { role: "assistant", content: "משהו השתבש, נסה/י שוב." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex flex-col items-center p-6 font-sans">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">המורה הפרטי שלי</h1>
        <p className="text-sm text-slate-500 mb-4">אב טיפוס פנימי — לא לשימוש חיצוני</p>

        <div className="flex gap-3 mb-4">
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value as (typeof GRADES)[number])}
            className="border rounded px-3 py-2 bg-white"
          >
            {GRADES.map((g) => (
              <option key={g} value={g}>
                כיתה {g}
              </option>
            ))}
          </select>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value as typeof subject)}
            className="border rounded px-3 py-2 bg-white"
          >
            {SUBJECTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-lg shadow-sm border h-96 overflow-y-auto p-4 mb-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-slate-400 text-sm">שאל/י אותי משהו על {subject === "math" ? "חשבון" : "עברית"}...</p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 max-w-[85%] ${
                m.role === "user"
                  ? "bg-blue-100 self-end"
                  : "bg-slate-100 self-start"
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && <div className="text-slate-400 text-sm">חושב/ת...</div>}
        </div>

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="כתוב/י כאן..."
            className="flex-1 border rounded px-3 py-2"
          />
          <button
            onClick={send}
            disabled={loading}
            className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
          >
            שלח
          </button>
        </div>
      </div>
    </div>
  );
}
