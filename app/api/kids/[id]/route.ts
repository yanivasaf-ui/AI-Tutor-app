import { NextRequest, NextResponse } from "next/server";
import { getKid, setKidAvatar } from "@/lib/memory/store";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  const kid = await getKid(supabase, id);
  if (!kid) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ kid });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { avatarId } = body as { avatarId?: string };
  if (!avatarId) {
    return NextResponse.json({ error: "avatarId is required" }, { status: 400 });
  }
  const supabase = await getSupabaseServerClient();
  const kid = await setKidAvatar(supabase, id, avatarId);
  if (!kid) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ kid });
}
