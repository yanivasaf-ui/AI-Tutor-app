import { NextRequest, NextResponse } from "next/server";
import { createKid, listKids } from "@/lib/memory/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ kids: await listKids() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, avatarId } = body as { name?: string; avatarId?: string | null };
  if (!name || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const kid = await createKid(name.trim(), avatarId ?? null);
  return NextResponse.json({ kid });
}
