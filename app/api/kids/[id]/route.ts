import { NextRequest, NextResponse } from "next/server";
import { getKid, setKidAvatar } from "@/lib/memory/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const kid = getKid(id);
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
  const kid = setKidAvatar(id, avatarId);
  if (!kid) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ kid });
}
