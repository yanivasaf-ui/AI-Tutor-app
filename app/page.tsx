"use client";

import { useEffect, useState } from "react";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import KidHome, { type KidSummary } from "@/components/home/KidHome";
import ScopedChat from "@/components/chat/ScopedChat";
import SuggestPractice from "@/components/parent/SuggestPractice";
import MuteToggle from "@/components/character/MuteToggle";
import { CHARACTERS, normalizeCharacterId, type CharacterId, type CharacterPose } from "@/lib/characters";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
import type { Line } from "@/lib/guide/lines";
import { useCelebration } from "@/lib/celebration/useCelebration";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { authErrorMessage } from "@/lib/auth/errors";
import type { ParentFlag, RecentAttempt, SubjectStats } from "@/lib/dashboard/types";
import type { KidGender, SubjectProfile } from "@/lib/memory/types";
import type { Grade } from "@/lib/exercises/types";
import { GRADES } from "@/lib/kids/grade";
import { activeSuggestion } from "@/lib/practice/state";
import { releaseSharedMicStream } from "@/lib/stt/provider";

type Kid = KidSummary;

interface KidDashboard {
  kidId: string;
  flags: ParentFlag[];
  recentAttempts: RecentAttempt[];
  subjectStats: SubjectStats[];
  practicedToday: boolean;
}

/** Whether the kid profile fetch has ever completed for the CURRENT
 *  signed-in user. "pending" gates every render decision that looks at
 *  `kid` — see the 2026-09-14 fix note below for why a plain boolean
 *  (defaulting to false) wasn't enough. */
type KidLoadState = "pending" | "loaded";

const KIDS_FETCH_RETRY_DELAY_MS = 400;

/** GET /api/kids, tolerating the same fresh-sign-in cookie-propagation
 *  race already found and fixed for /api/stt (lib/stt/provider.ts,
 *  AUTH_RACE_RETRY_DELAY_MS): the server re-reads the session fresh on
 *  every request, and right after a sign-in that read can lose the race
 *  against the just-set auth cookie, returning 401 for a genuinely
 *  signed-in parent. Retried once after a short pause; any other
 *  failure (offline, 5xx) is treated as "no kids found for now" the same
 *  as before — the retry is specifically for the race, not a general
 *  network-resilience layer. */
async function fetchKids(): Promise<Kid[]> {
  let res = await fetch("/api/kids?view=kid").catch(() => null);
  if (res?.status === 401) {
    await new Promise((resolve) => setTimeout(resolve, KIDS_FETCH_RETRY_DELAY_MS));
    res = await fetch("/api/kids?view=kid").catch(() => null);
  }
  if (!res?.ok) return [];
  const { kids } = (await res.json()) as { kids: Kid[] };
  return kids;
}

/** Real parent accounts gate this app (Supabase Auth). Single-page render
 *  branches, deliberately — see the "hard constraints" note in the UI
 *  Revamp Brief Section 0: every route/page is its own serverless
 *  function on the Vercel Hobby plan's 12-function cap; this app was
 *  structurally over it before consolidating into one page.
 *
 * 2026-09-14 fix: the character-select/onboarding screen was flashing for
 * a few real seconds after a fresh Google sign-in, for a RETURNING parent
 * with an existing profile, before the app corrected itself to the real
 * destination. Root cause: `kidLoadState` (previously a plain `loadingKid`
 * boolean) DEFAULTED to "not loading" — so the one render where `user` had
 * just resolved but the kid-fetch effect hadn't yet run (a guaranteed gap:
 * effects run after commit/paint, not before) treated `kid === null` as
 * "confirmed no kid," and rendered full onboarding. Made worse by two real
 * waits stacking in front of that render: this file's own initial auth
 * check used auth.getUser() (network round trip to Supabase, needed for a
 * SERVER-side trust decision, not for gating a CLIENT render) instead of
 * the local, non-network getSession(); and GET /api/kids itself had an
 * N+1 query waterfall for multi-kid parents (lib/memory/store.ts's
 * listKids(), fixed alongside this). Fixed here by never treating `kid`
 * as meaningful until `kidLoadState` has genuinely settled to "loaded" —
 * closes the race regardless of how long the wait in front of it turns
 * out to be — plus the getSession() swap and a real loading screen
 * instead of blank `null` while it settles. */
export default function Home() {
  const [user, setUser] = useState<{ id: string } | null | undefined>(undefined);
  const [kid, setKid] = useState<Kid | null>(null);
  const [kidLoadState, setKidLoadState] = useState<KidLoadState>("pending");
  const [view, setView] = useState<"kid" | "dashboard">("kid");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    // getSession() reads the already-persisted local session (cookies, via
    // @supabase/ssr) with no network round trip — the right call for "is
    // there a signed-in user, for deciding what to render." getUser()
    // (server-verified, needs the network) stays reserved for the actual
    // security check, which every API route already does for itself via
    // getSupabaseServerClient(); duplicating that trust check here just to
    // gate a render was the redundant network call in the sign-in wait.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setKidLoadState("pending");
    fetchKids()
      .then((kids) => {
        // Always reflect the fetch, not just the found-a-kid case — a kid
        // from a PREVIOUS signed-in user (Supabase can hand this effect a
        // new userId without an intervening logout()) must not linger as
        // stale state once this user's own fetch comes back with none.
        if (!cancelled) setKid(kids.length > 0 ? kids[0] : null);
      })
      .finally(() => {
        if (!cancelled) setKidLoadState("loaded");
      });
    return () => {
      cancelled = true;
    };
    // userId (a stable string), not `user` (a fresh object literal on
    // every onAuthStateChange firing) — otherwise this effect, and the
    // "pending" flip it opens with, re-runs on every such event even when
    // the signed-in user hasn't actually changed.
  }, [userId]);

  async function logout() {
    // Signing out doesn't unload the page (this is a single-page app —
    // see the file header) — pagehide never fires, so the shared mic
    // stream (lib/stt/provider.ts) would otherwise sit open, permission
    // granted and indicator lit, through the whole logged-out state.
    releaseSharedMicStream();
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setKid(null);
    setKidLoadState("pending");
  }

  if (user === undefined) return null;
  if (!user) return <LoginScreen />;
  // Never look at `kid` until its fetch has genuinely settled for THIS
  // user — this is the actual fix; see the file-level note above.
  if (kidLoadState === "pending") return <AppLoadingScreen />;

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

  return <KidHome kid={kid} character={characterId} onOpenDashboard={() => setView("dashboard")} />;
}

/** Shown for the one real wait this app can't hide: signed in, but the kid
 *  fetch hasn't resolved yet — so nothing is known about whether onboarding,
 *  a character repick, or the kid's own home screen is next. No character
 *  here (avatarId, if any, is exactly the thing not yet known) — a plain,
 *  brand-toned pulse, matching the "thinking" treatment other loading
 *  moments in this app already use. */
function AppLoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-canvas)]">
      <div className="flex gap-2" role="status" aria-label="טוען...">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-3 h-3 rounded-full bg-[var(--color-teal)] animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
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
  const [step, setStep] = useState<"pick" | "name" | "gender" | "grade" | "chat">("pick");
  /** feat: scoped kid chat — set once the kid row exists, which is what the
   *  chat step needs to write its facts against. */
  const [createdKid, setCreatedKid] = useState<Kid | null>(null);
  const [name, setName] = useState(existingKid?.name ?? "");
  const [gender, setGender] = useState<KidGender | null>(null);
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
        : step === "gender"
          ? lines.askGender(trimmed)
          : lines.askGrade(trimmed);
  const guidePose: CharacterPose =
    step === "pick" ? "celebration" : step === "name" || step === "gender" ? "hello" : "explaining";
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
          body: JSON.stringify({ name: trimmed, avatarId: picked, grade: grade ?? "א", gender }),
        });
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        // feat: scoped kid chat — the identity form is done and the kid row
        // exists; the character now gets to know them. Leaving onboarding
        // happens on the other side of that conversation.
        setCreatedKid(data.kid);
        setStep("chat");
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
          {step !== "pick" && step !== "chat" && (
            <button
              onClick={() => setStep(step === "grade" ? "gender" : step === "gender" ? "name" : "pick")}
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
            onKeyDown={(e) => e.key === "Enter" && trimmed && setStep("gender")}
            placeholder="לדוגמה: נועה"
            aria-label="השם"
            className="w-full min-h-16 rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/30 bg-[var(--color-surface)] px-5 text-2xl text-center"
            autoFocus
          />
          {trimmed && (
            <button onClick={() => setStep("gender")} className={primaryButton}>
              הבא ←
            </button>
          )}
        </div>
      )}

      {step === "gender" && picked && (
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
            {([
              { value: "boy", label: "בן" },
              { value: "girl", label: "בת" },
            ] as const).map((g) => (
              <button
                key={g.value}
                onClick={() => setGender(g.value)}
                aria-pressed={gender === g.value}
                className={`min-h-16 px-10 rounded-[var(--radius-button)] text-xl font-medium shadow-sm ${
                  gender === g.value ? "bg-[var(--color-teal)] text-white" : "bg-[var(--color-surface)] text-[var(--color-ink)]"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          {gender && (
            <button onClick={() => setStep("grade")} className={primaryButton}>
              הבא ←
            </button>
          )}
        </div>
      )}

      {step === "chat" && picked && createdKid && (
        <div className="w-full max-w-md flex flex-col items-center gap-4 mt-4">
          <ScopedChat
            mode="onboarding"
            kidId={createdKid.id}
            kidName={createdKid.name}
            character={picked}
            onDone={() => onDone(createdKid)}
          />
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

  function load() {
    return fetch("/api/kids")
      .then((res) => (res.ok ? res.json() : { kids: [], dashboard: [] }))
      .then(({ kids, dashboard }: { kids: DashboardKid[]; dashboard: KidDashboard[] }) => {
        setKids(kids);
        const map: typeof dashboards = {};
        for (const d of dashboard) map[d.kidId] = d;
        setDashboards(map);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] flex flex-col items-center p-6">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-[var(--color-ink)]">לוח בקרה להורים</h1>
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-sm text-[var(--color-teal)] hover:underline">
              חזרה
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

                <SuggestPractice
                  kidId={kid.id}
                  kidName={kid.name}
                  currentTopicId={
                    activeSuggestion({ math: kid.subjects?.math?.practice, hebrew: kid.subjects?.hebrew?.practice })?.topicId
                  }
                  onChanged={load}
                />

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
