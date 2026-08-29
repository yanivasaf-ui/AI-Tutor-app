"use client";

import { useEffect, useState } from "react";
import AvatarPicker, { AvatarBadge } from "@/components/AvatarPicker";
import PracticeMode from "@/components/PracticeMode";
import { getAvatarById } from "@/lib/avatars";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import type { ParentFlag, RecentAttempt, SubjectStats } from "@/lib/dashboard/types";
import type { SubjectProfile } from "@/lib/memory/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Kid {
  id: string;
  name: string;
  avatarId: string | null;
}

interface KidDashboard {
  kidId: string;
  flags: ParentFlag[];
  recentAttempts: RecentAttempt[];
  subjectStats: SubjectStats[];
  practicedToday: boolean;
}

const GRADES = ["א", "ב", "ג"] as const;
const SUBJECTS = [
  { value: "math", label: "חשבון" },
  { value: "hebrew", label: "עברית" },
] as const;

/** Real parent accounts gate this app (Supabase Auth). The login screen
 *  used to be its own page (/login) — folded in here as a third render
 *  branch instead, to cut Vercel's per-deployment serverless function
 *  count (each Next.js route/page compiles to its own function on the
 *  Hobby plan's 12-function cap; this app was structurally over it with
 *  6 API routes + 2 pages before any consolidation). Multi-kid account
 *  switching is still a real open item (brief Section 2c/2d) — this picks
 *  the first kid on the account rather than building a switcher UI here. */
export default function Home() {
  const [user, setUser] = useState<{ id: string } | null | undefined>(undefined);
  const [kid, setKid] = useState<Kid | null>(null);
  const [loadingKid, setLoadingKid] = useState(false);
  const [view, setView] = useState<"kid" | "dashboard">("kid");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ? { id: user.id } : null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoadingKid(true);
    fetch("/api/kids")
      .then((res) => (res.ok ? res.json() : { kids: [] }))
      .then(({ kids }: { kids: Kid[] }) => {
        if (kids.length > 0) setKid(kids[0]);
      })
      .finally(() => setLoadingKid(false));
  }, [user]);

  async function logout() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setKid(null);
  }

  if (user === undefined) return null;

  if (!user) {
    return <LoginScreen />;
  }

  if (loadingKid) return null;

  if (!kid) {
    return <KidSetup onDone={setKid} onLogout={logout} />;
  }

  if (view === "dashboard") {
    return <ParentDashboard onBack={() => setView("kid")} onLogout={logout} />;
  }

  return <TutorChat kid={kid} onLogout={logout} onOpenDashboard={() => setView("dashboard")} />;
}

function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    setConfirmMessage(null);

    const supabase = getSupabaseBrowserClient();

    if (mode === "signup") {
      const { error: signUpError, data } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      setLoading(false);
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (!data.session) {
        setConfirmMessage("נשלח מייל אישור — יש לאשר לפני התחברות.");
        return;
      }
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) setError(signInError.message);
  }

  async function signInWithGoogle() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 font-sans">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm border p-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">המורה הפרטי שלי</h1>
        <p className="text-sm text-slate-500 mb-6">
          {mode === "login" ? "התחברות להורים" : "יצירת חשבון הורה חדש"}
        </p>

        <label className="block text-sm font-semibold text-slate-600 mb-1">אימייל</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full border rounded px-3 py-2 bg-white mb-4"
          dir="ltr"
        />

        <label className="block text-sm font-semibold text-slate-600 mb-1">סיסמה</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full border rounded px-3 py-2 bg-white mb-4"
          dir="ltr"
        />

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        {confirmMessage && <p className="text-green-600 text-sm mb-4">{confirmMessage}</p>}

        <button
          onClick={submit}
          disabled={loading || !email.trim() || !password}
          className="w-full bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50 mb-3"
        >
          {loading ? "רגע..." : mode === "login" ? "התחברות" : "יצירת חשבון"}
        </button>

        <button
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
            setConfirmMessage(null);
          }}
          className="w-full text-sm text-blue-600 hover:underline mb-4"
        >
          {mode === "login" ? "אין לך חשבון? צור/י אחד" : "כבר יש לך חשבון? התחבר/י"}
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs text-slate-400">או</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <button
          onClick={signInWithGoogle}
          className="w-full border rounded px-4 py-2 flex items-center justify-center gap-2 hover:bg-slate-50"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.61z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.19l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.95 10.69A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.69V4.98H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.02z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.98l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
          </svg>
          <span className="text-sm text-slate-700">התחברות עם Google</span>
        </button>
      </div>
    </div>
  );
}

/** Picked-once setup screen: name + avatar choice, per the locked
 *  "character avatar picked once" decision. Persists the kid via
 *  /api/kids so the choice ties into the same per-kid data model used
 *  for the memory layer. */
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

function TutorChat({
  kid,
  onLogout,
  onOpenDashboard,
}: {
  kid: Kid;
  onLogout: () => void;
  onOpenDashboard: () => void;
}) {
  const [grade, setGrade] = useState<(typeof GRADES)[number]>("א");
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]["value"]>("math");
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("practice");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Session-length decision (project-brief.md Section 2d-2): ~15 min/day,
  // soft target, not a hard timer. Started once per visit here (not in
  // PracticeMode, which remounts on every grade/subject change) so
  // switching subjects mid-session doesn't reset the clock — it's one
  // daily session regardless of what the kid practices within it.
  const [sessionStartedAt] = useState(() => Date.now());
  const [sessionCloseShown, setSessionCloseShown] = useState(false);

  const avatar = getAvatarById(kid.avatarId);

  async function send() {
    if (!input.trim() || loading) return;
    const userMessage: Message = { role: "user", content: input };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
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
          <div className="flex items-center gap-4">
            <button onClick={onOpenDashboard} className="text-sm text-blue-600 hover:underline">
              לוח בקרה להורים
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
              title="התנתקות"
            >
              {avatar && <AvatarBadge avatar={avatar} size={32} />}
              <span>{kid.name}</span>
            </button>
          </div>
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
          <PracticeMode
            subject={subject}
            grade={grade}
            kidId={kid.id}
            avatar={avatar}
            sessionStartedAt={sessionStartedAt}
            sessionCloseShown={sessionCloseShown}
            onSessionClose={() => setSessionCloseShown(true)}
          />
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

const SUBJECT_LABELS: Record<string, string> = { math: "חשבון", hebrew: "עברית" };

interface DashboardKid {
  id: string;
  name: string;
  avatarId: string | null;
  subjects: Partial<Record<"math" | "hebrew", SubjectProfile>>;
}

/**
 * Real parent-facing view of what's already being tracked per kid — the
 * "what does the parent see" question the brief explicitly left
 * undesigned (Section 2c) plus the "flag to parent" half of the locked
 * off-curriculum/emotional decision, which existed only as a console.log
 * until this session. Reads /api/kids's dashboard payload (folded into
 * the existing route rather than a new one, per the Vercel function-count
 * constraint already hit twice on this app).
 *
 * No weekly-report delivery (email/SMS) here — that's still blocked on
 * Twilio/email setup Asaf hasn't done yet (M-memory/decisions.md,
 * "Twilio Chosen... Not Built Yet"). This is the in-app view, buildable
 * now with what's already connected.
 */
function ParentDashboard({ onBack, onLogout }: { onBack: () => void; onLogout: () => void }) {
  const [kids, setKids] = useState<DashboardKid[]>([]);
  const [dashboards, setDashboards] = useState<Record<string, KidDashboard>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/kids")
      .then((res) => (res.ok ? res.json() : { kids: [], dashboard: [] }))
      .then(({ kids, dashboard }: { kids: DashboardKid[]; dashboard: KidDashboard[] }) => {
        setKids(kids);
        const map: typeof dashboards = {};
        for (const d of dashboard) map[d.kidId] = d;
        setDashboards(map);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex flex-col items-center p-6 font-sans">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-slate-800">לוח בקרה להורים</h1>
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
              חזרה לתרגול
            </button>
            <button onClick={onLogout} className="text-sm text-slate-500 hover:text-slate-700">
              התנתקות
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-500 mb-6">אב טיפוס פנימי — לא לשימוש חיצוני</p>

        {loading && <p className="text-slate-400 text-sm">טוען...</p>}
        {!loading && kids.length === 0 && <p className="text-slate-400 text-sm">אין עדיין ילדים רשומים.</p>}

        <div className="flex flex-col gap-6">
          {kids.map((kid) => {
            const avatar = getAvatarById(kid.avatarId);
            const d = dashboards[kid.id];
            return (
              <div key={kid.id} className="bg-white rounded-lg shadow-sm border p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    {avatar && <AvatarBadge avatar={avatar} size={36} />}
                    <h2 className="text-lg font-bold text-slate-800">{kid.name}</h2>
                  </div>
                  {d && (
                    <span
                      className={`text-xs font-medium rounded-full px-3 py-1 ${
                        d.practicedToday ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {d.practicedToday ? "תרגל/ה היום ✓" : "עדיין לא תרגל/ה היום"}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  {(["math", "hebrew"] as const).map((subject) => {
                    const profile = kid.subjects?.[subject];
                    const stats = d?.subjectStats.find((s) => s.subject === subject);
                    return (
                      <div key={subject} className="border rounded-lg p-3">
                        <h3 className="font-semibold text-slate-700 mb-1">{SUBJECT_LABELS[subject]}</h3>
                        {stats && stats.totalAttempts > 0 ? (
                          <p className="text-sm text-slate-600 mb-1">
                            {stats.correctAttempts}/{stats.totalAttempts} תרגילים נכונים (
                            {Math.round((stats.correctAttempts / stats.totalAttempts) * 100)}%)
                          </p>
                        ) : (
                          <p className="text-sm text-slate-400 mb-1">אין עדיין תרגילים</p>
                        )}
                        {profile?.recentSummary && <p className="text-sm text-slate-600">{profile.recentSummary}</p>}
                        {profile?.topicsCovered && profile.topicsCovered.length > 0 && (
                          <p className="text-xs text-slate-400 mt-1">נושאים: {profile.topicsCovered.join(", ")}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {d && d.flags.length > 0 && (
                  <div className="mb-4">
                    <h3 className="font-semibold text-amber-700 mb-2 text-sm">רגעים לתשומת לב</h3>
                    <div className="flex flex-col gap-2">
                      {d.flags.map((flag) => (
                        <div
                          key={flag.id}
                          className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-slate-700"
                        >
                          <span className="text-xs text-slate-400 block mb-1">
                            {new Date(flag.createdAt).toLocaleDateString("he-IL")}
                          </span>
                          &quot;{flag.message}&quot;
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {d && d.recentAttempts.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-slate-700 mb-2 text-sm">פעילות אחרונה</h3>
                    <div className="flex flex-col gap-2">
                      {d.recentAttempts.map((a) => (
                        <div key={a.id} className="flex items-start gap-2 text-sm">
                          <span className={a.correct ? "text-green-600" : "text-amber-600"}>
                            {a.correct ? "✓" : "✗"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-slate-600 truncate">{a.question}</p>
                            <p className="text-xs text-slate-400">
                              ענה/תה: <span className="font-medium text-slate-500">{a.kidAnswer}</span>
                              {!a.correct && a.correctAnswer && (
                                <>
                                  {" "}
                                  · תשובה נכונה: <span className="font-medium text-slate-500">{a.correctAnswer}</span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
