import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Standard Supabase/Next.js OAuth callback: Google redirects here with a
 *  `code` after the user approves, which gets exchanged for a real session
 *  (sets the auth cookies via the session-bound server client), then we
 *  send the parent on to the app itself. */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await getSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/`);
}
