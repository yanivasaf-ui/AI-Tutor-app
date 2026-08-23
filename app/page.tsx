"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AvatarPicker, { AvatarBadge } from "@/components/AvatarPicker";
import PracticeMode from "@/components/PracticeMode";
import { getAvatarById } from "@/lib/avatars";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Kid {
  id: string;
  name: string;
  avatarId: string | null;
}

const GRADES = ["א", "ב", "ג"] as const;
const SUBJECTS = [
  { value: "math", label: "חשבון" },
  { value: "hebrew", label: "עברית" },
] as const;

/** Real parent accounts now gate this app (Supabase Auth) — replaces the
 *  earlier anonymous "pick a name, stored in localStorage" flow. Kids are
 *  scoped to the logged-in parent server-side (kids table RLS), not just a
 *  browser's local storage. Multi-kid account switching is still a real
 *  open item (per the brief's Section 2c/2d) — this picks the first kid on
 *  the account for now rather than building a switcher UI in this pass. */
export default function Home() {
  const router = useRouter();
  const [kid, setKid] = useState<Kid | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const res = await fetch("/api/kids");
      if (res.ok) {
        const { kids } = (await res.json()) as { kids: Kid[] };
        if (kids.length > 0) setKid(kids[0]);
      }
      setCheckingAuth(false);
    });
  }, [router]);

  async function logout() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (checkingAuth) return null;

  if (!kid) {
    return <KidSetup onDone={setKid} onLogout={logout} />;
  }

  return <TutorChat kid={kid} onLogout={logout} />;
}

/** Picked-once setup screen: name + avatar choice, per the locked
 *  "character avatar picked once" decision. Persists the kid via the
 *  Task 1 profile store (/api/kids) so the choice ties into the same
 *  per-kid data model used for the memory layer. */
function KidSetup({ onDone, onLogout }: { onDone: (kid: Kid) => void; onLogout: () => void }) {
  const [name, setName] = useState("");
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !avatarId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/kids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), avatarId }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      onDone(data.kid);
    } catch {
      setError("משהו השתבש בשמירה, נסה/י שוב.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex flex-col items-center p-6 font-sans">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-slate-800">בואו נכיר!</h1>
          <button onClick={onLogout} className="text-sm text-slate-500 hover:text-slate-700">
            התנתקות
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          איך קוראים לך, ואיזו דמות תרצה/י שתלווה אותך בלימודים? אפשר לבחור פעם אחת.
        </p>

        <label className="block text-sm font-semibold text-slate-600 mb-1">השם שלי</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="לדוגמה: נועה"
          className="w-full border rounded px-3 py-2 bg-white mb-6"
        />

        <label className="block text-sm font-semibold text-slate-600 mb-2">
          הדמות שלי
        </label>
        <AvatarPicker selectedId={avatarId} onSelect={setAvatarId} />

        {error && <p className="text-red-500 text-sm mt-4">{error}</p>}

        <button
          onClick={submit}
          disabled={!name.trim() || !avatarId || saving}
          className="mt-6 bg-blue-600 text-white rounded px-5 py-2 disabled:opacity-40"
        >
          {saving ? "שומר/ת..." : "בואו נתחיל!"}
        </button>
      </div>
    </div>
  );
}

const MODES = [
  { value: "practice", label: "תרגול" },
  { value: "chat", label: "שיחה חופשית" },
] as const;

function TutorChat({ kid, onLogout }: { kid: Kid; onLogout: () => void }) {
  const [grade, setGrade] = useState<(typeof GRADES)[number]>("א");
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]["value"]>("math");
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("practice");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const avatar = getAvatarById(kid.avatarId);

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
          kidId: kid.id,
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
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-slate-800">המורה הפרטי שלי</h1>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
            title="התנתקות"
          >
            {avatar && <AvatarBadge avatar={avatar} size={32} />}
            <span>{kid.name}</span>
          </button>
        </div>
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

        <div className="flex gap-1 mb-4 border-b">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                mode === m.value
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "practice" && (
          <PracticeMode subject={subject} grade={grade} kidId={kid.id} avatar={avatar} />
        )}

        {mode === "chat" && (
          <>
            <div className="bg-white rounded-lg shadow-sm border h-96 overflow-y-auto p-4 mb-4 flex flex-col gap-3">
              {messages.length === 0 && (
                <p className="text-slate-400 text-sm">שאל/י אותי משהו על {subject === "math" ? "חשבון" : "עברית"}...</p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex items-end gap-2 ${m.role === "user" ? "self-end flex-row-reverse" : "self-start"}`}
                >
                  {m.role === "assistant" && avatar && <AvatarBadge avatar={avatar} size={28} />}
                  <div
                    className={`rounded-lg px-3 py-2 max-w-[85%] ${
                      m.role === "user" ? "bg-blue-100" : "bg-slate-100"
                    }`}
                  >
                    {m.content}
                  </div>
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
          </>
        )}
      </div>
    </div>
  );
}
