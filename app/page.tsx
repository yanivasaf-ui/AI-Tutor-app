"use client";

import { useEffect, useState } from "react";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import HomeScreen from "@/components/home/HomeScreen";
import ExerciseScreen from "@/components/practice/ExerciseScreen";
import MuteToggle from "@/components/character/MuteToggle";
import { CHARACTERS, normalizeCharacterId, type CharacterId, type CharacterPose } from "@/lib/characters";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
import type { Line } from "@/lib/guide/lines";
import { useCelebration } from "@/lib/celebration/useCelebration";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { authErrorMessage } from "@/lib/auth/errors";
import type { ParentFlag, RecentAttempt, SubjectStats } from "@/lib/dashboard/types";
import type { SubjectProfile } from "@/lib/memory/types";
import type { Grade } from "@/lib/exercises/types";

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

const GRADES: Grade[] = ["א", "ב", "ג"];
const GRADE_STORAGE_PREFIX = "ai-tutor-grade-"; // known gap, see Section 4.2 — no kids.grade column yet

function getStoredGrade(kidId: string): Grade {
  if (typeof window === "undefined") return "א";
  const v = window.localStorage.getItem(GRADE_STORAGE_PREFIX + kidId);
  return (v as Grade) ?? "א";
}

function setStoredGrade(kidId: string, grade: Grade) {
  window.localStorage.setItem(GRADE_STORAGE_PREFIX + kidId, grade);
}

/** Real parent accounts gate this app (Supabase Auth). Single-page render
 *  branches, deliberately — see the "hard constraints" note in the UI
 *  Revamp Brief Section 0: every route/page is its own serverless
 *  function on the Vercel Hobby plan's 12-function cap; this app was
 *  structurally over it before consolidating into one page. */
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
  if (!user) return <LoginScreen />;
  if (loadingKid) return null;

  const characterId = kid ? normalizeCharacterId(kid.avatarId) : null;

  // No kid yet → full onboarding. Kid exists but avatarId is from the old
  // 8-option pack and doesn't normalize → character-repick only (brief
  // Section 4.3: "route them through the character-pick step once, step 2
  // only"), skipping the name/grade step since those already exist.
  if (!kid) {
    return <Onboarding mode="full" onDone={setKid} onLogout={logout} />;
  }
  if (!characterId) {
    return (
      <Onboarding
        mode="repick"
        existingKid={kid}
        onDone={(updated) => setKid(updated)}
        onLogout={logout}
      />
    );
  }

  if (view === "dashboard") {
    return <ParentDashboard onBack={() => setView("kid")} onLogout={logout} />;
  }

  return <KidHome kid={kid} character={characterId} onOpenDashboard={() => setView("dashboard")} onLogout={logout} />;
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

    // Network-level failures (offline, Supabase down) come back as raw
    // browser strings like "Failed to fetch" — authErrorMessage turns
    // those into one clear Hebrew line (lib/auth/errors.ts). The try/catch
    // covers the same failures if they're thrown instead of returned.
    try {
      const supabase = getSupabaseBrowserClient();

      if (mode === "signup") {
        const { error: signUpError, data } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) {
          setError(authErrorMessage(signUpError));
          return;
        }
        if (!data.session) {
          setConfirmMessage("נשלח מייל אישור — יש לאשר לפני התחברות.");
        }
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) setError(authErrorMessage(signInError));
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (oauthError) setError(authErrorMessage(oauthError));
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-[var(--radius-bubble)] shadow-sm p-6">
        <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-1">המורה הפרטי שלי</h1>
        <p className="text-sm text-[var(--color-ink-soft)] mb-6">
          {mode === "login" ? "התחברות להורים" : "יצירת חשבון הורה חדש"}
        </p>

        <label className="block text-sm font-semibold text-[var(--color-ink-soft)] mb-1">אימייל</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full border rounded-[var(--radius-button)] px-4 py-3 bg-white mb-4"
          dir="ltr"
        />

        <label className="block text-sm font-semibold text-[var(--color-ink-soft)] mb-1">סיסמה</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full border rounded-[var(--radius-button)] px-4 py-3 bg-white mb-4"
          dir="ltr"
        />

        {error && <p className="text-[var(--color-warm)] text-sm mb-4">{error}</p>}
        {confirmMessage && <p className="text-[var(--color-success)] text-sm mb-4">{confirmMessage}</p>}

        <button
          onClick={submit}
          disabled={loading || !email.trim() || !password}
          className="w-full bg-[var(--color-teal)] text-white rounded-[var(--radius-button)] px-4 py-3 disabled:opacity-50 mb-3"
        >
          {loading ? "רגע..." : mode === "login" ? "התחברות" : "יצירת חשבון"}
        </button>

        <button
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
            setConfirmMessage(null);
          }}
          className="w-full text-sm text-[var(--color-teal)] hover:underline mb-4"
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
          className="w-full border rounded-[var(--radius-button)] px-4 py-3 flex items-center justify-center gap-2 hover:bg-slate-50"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.61z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.19l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.95 10.69A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.69V4.98H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.02z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.98l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
          </svg>
          <span className="text-sm text-[var(--color-ink)]">התחברות עם Google</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Character-led onboarding (UI Revamp Brief Section 4.3; character-led
 * redesign, Task 5 items 1 + 5).
 *
 * Order changed from "name + grade, then pick a character" to "pick a
 * character, then IT gets to know you": the companion the kid chooses is
 * the one who asks their name and their grade. Before, a hard-coded boy
 * character asked every kid's name — including the kids about to pick
 * the girl — and the pick came last, as a form field. Now three short
 * steps, one question each, each asked out loud:
 *   pick  — both characters on offer, idle; the tapped one celebrates
 *   name  — the chosen character waves (hello) and asks the name
 *   grade — it explains (explaining) and asks the grade, by name
 * The two lines said before the kid has told us their name can't include
 * it; every line after does.
 *
 * `mode="repick"` runs the pick step only, for a kid whose avatarId is
 * from the pre-collapse 8-option pack and doesn't normalize to boy/girl
 * (lib/characters.ts's normalizeCharacterId) — name and grade already
 * exist for that kid, so the character addresses them by name from its
 * first line.
 */
function Onboarding({
  mode,
  existingKid,
  onDone,
  onLogout,
}: {
  mode: "full" | "repick";
  existingKid?: Kid;
  onDone: (kid: Kid) => void;
  onLogout: () => void;
}) {
  const [step, setStep] = useState<"pick" | "name" | "grade">("pick");
  const [name, setName] = useState(existingKid?.name ?? "");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [picked, setPicked] = useState<CharacterId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { celebrate } = useCelebration();

  const knownName = mode === "repick" ? existingKid?.name : undefined;
  const trimmed = name.trim();

  const line: Line =
    step === "pick"
      ? picked
        ? lines.picked(picked, knownName)
        : lines.pickPrompt(knownName)
      : step === "name"
        ? lines.askName()
        : lines.askGrade(trimmed);
  const guidePose: CharacterPose = step === "pick" ? "celebration" : step === "name" ? "hello" : "explaining";
  // Each step's question is said on arrival. The pick reaction is said
  // directly inside the tap handler instead (iOS gesture rule), so the cue
  // is the step alone.
  // Before a pick there's no character to speak as, so the prompt uses the
  // browser voice; from the pick on, the chosen character's own voice.
  const guide = useGuide({ owner: "onboarding", character: picked, pose: guidePose, line, cue: step });

  function pick(id: CharacterId, el: HTMLElement) {
    setPicked(id);
    setError(null);
    celebrate(1, el);
    // `as: id` — `picked` state hasn't updated inside this handler yet, and
    // tapping a character should let the kid hear *its* voice right away.
    guide.say(lines.picked(id, knownName), id);
  }

  async function save() {
    if (!picked || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "repick" && existingKid) {
        const res = await fetch("/api/kids", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: existingKid.id, avatarId: picked }),
        });
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        onDone(data.kid);
      } else {
        const res = await fetch("/api/kids", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, avatarId: picked }),
        });
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        setStoredGrade(data.kid.id, grade ?? "א");
        onDone(data.kid);
      }
    } catch {
      setError("משהו השתבש בשמירה. אפשר לנסות שוב.");
    } finally {
      setSaving(false);
    }
  }

  const primaryButton =
    "min-h-16 px-10 rounded-[var(--radius-button)] bg-[var(--color-teal)] text-white text-xl font-medium disabled:opacity-50";

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] flex flex-col items-center p-6">
      <div className="w-full max-w-md flex items-center justify-between mb-2">
        <div>
          {step !== "pick" && (
            <button
              onClick={() => setStep(step === "grade" ? "name" : "pick")}
              className="min-h-11 px-1 text-sm text-[var(--color-ink-soft)]"
            >
              חזרה
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MuteToggle />
          <button onClick={onLogout} className="min-h-11 px-2 text-sm text-[var(--color-ink-soft)]">
            התנתקות
          </button>
        </div>
      </div>

      {step === "pick" && (
        <div className="w-full max-w-md flex flex-col items-center gap-6 mt-4">
          <SpeechBubble
            key={lines.spoken(line)}
            text={line.text}
            lead={line.name}
            tail="bottom"
            tailAlign={picked === "boy" ? "start" : picked === "girl" ? "end" : "center"}
            owner="onboarding" character={picked}
            className="w-full"
          />
          <div className="flex gap-6 justify-center">
            {(Object.keys(CHARACTERS) as CharacterId[]).map((id) => {
              const isPicked = picked === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={(e) => pick(id, e.currentTarget)}
                  aria-pressed={isPicked}
                  aria-label={CHARACTERS[id].label}
                  className={`flex flex-col items-center gap-2 rounded-[var(--radius-bubble)] p-2 transition-opacity ${
                    picked && !isPicked ? "opacity-50" : ""
                  } ${isPicked ? "bg-[var(--color-surface)] shadow-sm" : ""}`}
                >
                  <Character character={id} pose={isPicked ? guide.pose : "idle"} size={190} />
                  <span className="text-lg text-[var(--color-ink)] font-medium">{CHARACTERS[id].label}</span>
                </button>
              );
            })}
          </div>

          {error && <p className="text-[var(--color-warm)] text-sm">{error}</p>}

          {picked && (
            <button
              onClick={() => (mode === "repick" ? save() : setStep("name"))}
              disabled={saving}
              className={primaryButton}
            >
              {mode === "repick" ? (saving ? "רגע..." : "בואו נתחיל!") : "הבא ←"}
            </button>
          )}
        </div>
      )}

      {step === "name" && picked && (
        <div className="w-full max-w-md flex flex-col items-center gap-4 mt-4">
          <Character character={picked} pose={guide.pose} size={220} />
          <SpeechBubble
            key={lines.spoken(line)}
            text={line.text}
            lead={line.name}
            tail="top"
            tailAlign="center"
            owner="onboarding" character={picked}
            className="w-full"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && trimmed && setStep("grade")}
            placeholder="לדוגמה: נועה"
            aria-label="השם"
            className="w-full min-h-16 rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/30 bg-[var(--color-surface)] px-5 text-2xl text-center"
            autoFocus
          />
          {trimmed && (
            <button onClick={() => setStep("grade")} className={primaryButton}>
              הבא ←
            </button>
          )}
        </div>
      )}

      {step === "grade" && picked && (
        <div className="w-full max-w-md flex flex-col items-center gap-4 mt-4">
          <Character character={picked} pose={guide.pose} size={220} />
          <SpeechBubble
            key={lines.spoken(line)}
            text={line.text}
            lead={line.name}
            tail="top"
            tailAlign="center"
            owner="onboarding" character={picked}
            className="w-full"
          />
          <div className="flex gap-4 mt-1">
            {GRADES.map((g) => (
              <button
                key={g}
                onClick={() => setGrade(g)}
                aria-pressed={grade === g}
                className={`w-20 h-20 rounded-full text-3xl font-bold shadow-sm ${
                  grade === g ? "bg-[var(--color-teal)] text-white" : "bg-[var(--color-surface)] text-[var(--color-ink)]"
                }`}
              >
                {g}׳
              </button>
            ))}
          </div>

          {error && <p className="text-[var(--color-warm)] text-sm">{error}</p>}

          {grade && (
            <button onClick={save} disabled={saving} className={primaryButton}>
              {saving ? "רגע..." : "יאללה, מתחילים!"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Kid-facing shell: the map is the default view (brief Section 4.2); a
 * topic tap opens ExerciseScreen scoped to that topic (generate_exercise
 * takes a topic id since f119e01). The character carries across screens:
 * the kid's name and whether the tapped stop was already done both flow
 * into the exercise screen — the name for how the character addresses
 * the kid, the done-flag so a first completion gets its full-screen
 * celebration.
 */
function KidHome({
  kid,
  character,
  onOpenDashboard,
  onLogout,
}: {
  kid: Kid;
  character: CharacterId;
  onOpenDashboard: () => void;
  onLogout: () => void;
}) {
  const [activeSubject, setActiveSubject] = useState<"math" | "hebrew" | null>(null);
  // feat: topic-scoped exercise generation — the map already emits the
  // tapped node's topic id (ProgressMap.tsx's onPickTopic), this was the
  // one place along the chain that was discarding it. Cleared together
  // with activeSubject on both pick and back-to-map, same lifecycle.
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(undefined);
  const [activeTopicWasDone, setActiveTopicWasDone] = useState(false);
  const [sessionStartedAt] = useState(() => Date.now());
  const [sessionCloseShown, setSessionCloseShown] = useState(false);
  const grade = getStoredGrade(kid.id);

  if (activeSubject) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--color-canvas)]">
        <ExerciseScreen
          subject={activeSubject}
          grade={grade}
          topicId={activeTopicId}
          topicWasDone={activeTopicWasDone}
          kidId={kid.id}
          kidName={kid.name}
          character={character}
          sessionStartedAt={sessionStartedAt}
          sessionCloseShown={sessionCloseShown}
          onSessionClose={() => setSessionCloseShown(true)}
          onBackToMap={() => {
            setActiveSubject(null);
            setActiveTopicId(undefined);
          }}
        />
      </div>
    );
  }

  return (
    <HomeScreen
      kid={kid}
      character={character}
      grade={grade}
      onPickTopic={(subject, topicId, wasDone) => {
        setActiveSubject(subject);
        setActiveTopicId(topicId);
        setActiveTopicWasDone(wasDone);
      }}
      onOpenDashboard={onOpenDashboard}
    />
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
 * Real parent-facing view of what's already being tracked per kid.
 * Content/logic unchanged from the original — restyled to the token
 * system (UI Revamp Brief Section 4.4): white cards, radius-bubble,
 * AvatarBadge swapped for a Character thumbnail. Reached only through
 * HomeScreen's parent gate now, not a bare link.
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
    <div className="min-h-screen bg-[var(--color-canvas)] flex flex-col items-center p-6">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-[var(--color-ink)]">לוח בקרה להורים</h1>
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-sm text-[var(--color-teal)] hover:underline">
              חזרה למפה
            </button>
            <button onClick={onLogout} className="text-sm text-[var(--color-ink-soft)]">
              התנתקות
            </button>
          </div>
        </div>
        <p className="text-sm text-[var(--color-ink-soft)] mb-6">אב טיפוס פנימי — לא לשימוש חיצוני</p>

        {loading && <p className="text-[var(--color-ink-soft)] text-sm">טוען...</p>}
        {!loading && kids.length === 0 && <p className="text-[var(--color-ink-soft)] text-sm">אין עדיין ילדים רשומים.</p>}

        <div className="flex flex-col gap-6">
          {kids.map((kid) => {
            const character = normalizeCharacterId(kid.avatarId);
            const d = dashboards[kid.id];
            return (
              <div key={kid.id} className="bg-[var(--color-surface)] rounded-[var(--radius-bubble)] shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    {character && <Character character={character} pose="idle" size={40} />}
                    <h2 className="text-lg font-bold text-[var(--color-ink)]">{kid.name}</h2>
                  </div>
                  {d && (
                    <span
                      className={`text-xs font-medium rounded-[var(--radius-button)] px-3 py-1 ${
                        d.practicedToday ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-slate-100 text-slate-500"
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
                      <div key={subject} className="border rounded-2xl p-3">
                        <h3 className="font-semibold text-[var(--color-ink)] mb-1">{SUBJECT_LABELS[subject]}</h3>
                        {stats && stats.totalAttempts > 0 ? (
                          <p className="text-sm text-[var(--color-ink-soft)] mb-1">
                            {stats.correctAttempts}/{stats.totalAttempts} תרגילים נכונים (
                            {Math.round((stats.correctAttempts / stats.totalAttempts) * 100)}%)
                          </p>
                        ) : (
                          <p className="text-sm text-slate-400 mb-1">אין עדיין תרגילים</p>
                        )}
                        {profile?.recentSummary && <p className="text-sm text-[var(--color-ink-soft)]">{profile.recentSummary}</p>}
                        {profile?.topicsCovered && profile.topicsCovered.length > 0 && (
                          <p className="text-xs text-slate-400 mt-1">נושאים: {profile.topicsCovered.join(", ")}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {d && d.flags.length > 0 && (
                  <div className="mb-4">
                    <h3 className="font-semibold text-[var(--color-warm)] mb-2 text-sm">רגעים לתשומת לב</h3>
                    <div className="flex flex-col gap-2">
                      {d.flags.map((flag) => (
                        <div key={flag.id} className="bg-[var(--color-warm-soft)] rounded-2xl px-3 py-2 text-sm text-[var(--color-ink)]">
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
                    <h3 className="font-semibold text-[var(--color-ink)] mb-2 text-sm">פעילות אחרונה</h3>
                    <div className="flex flex-col gap-2">
                      {d.recentAttempts.map((a) => (
                        <div key={a.id} className="flex items-start gap-2 text-sm">
                          <span className={a.correct ? "text-[var(--color-success)]" : "text-[var(--color-warm)]"}>
                            {a.correct ? "✓" : "✗"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[var(--color-ink-soft)] truncate">{a.question}</p>
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
