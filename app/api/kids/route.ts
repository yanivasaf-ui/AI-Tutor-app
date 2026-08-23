import { NextRequest, NextResponse } from "next/server";
import { createKid, listKids, setKidAvatar } from "@/lib/memory/store";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Merges what used to be /api/kids and /api/kids/[id] into one route —
 * same function-count reasoning as /api/tutor (see that file's comment).
 * PATCH now takes the kid id in the request body instead of the URL.
 */

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

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, avatarId } = body as { id?: string; avatarId?: string };
  if (!id || !avatarId) {
    return NextResponse.json({ error: "id and avatarId are required" }, { status: 400 });
  }
  const supabase = await getSupabaseServerClient();
  const kid = await setKidAvatar(supabase, id, avatarId);
  if (!kid) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ kid });
}
