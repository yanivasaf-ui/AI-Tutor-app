"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export default function LoginPage() {
  const router = useRouter();
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
        // Email confirmation required — Supabase default project setting.
        setConfirmMessage("נשלח מייל אישור — יש לאשר לפני התחברות.");
        return;
      }
      router.push("/");
      router.refresh();
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push("/");
    router.refresh();
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
          className="w-full text-sm text-blue-600 hover:underline"
        >
          {mode === "login" ? "אין לך חשבון? צור/י אחד" : "כבר יש לך חשבון? התחבר/י"}
        </button>
      </div>
    </div>
  );
}
