import { NextRequest, NextResponse } from "next/server";
import { createKid, listKids } from "@/lib/memory/store";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  return NextResponse.json({ kids: await listKids(supabase) });
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await req.json();
  const { name, avatarId } = body as { name?: string; avatarId?: string | null };
  if (!name || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const kid = await createKid(supabase, user.id, name.trim(), avatarId ?? null);
  return NextResponse.json({ kid });
}
