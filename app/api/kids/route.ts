import { NextRequest, NextResponse } from "next/server";
import { createKid, getKid, listKids, setKidAvatar, setKidGender, setKidGrade } from "@/lib/memory/store";
import { pickOpenerFact, recentKidFacts } from "@/lib/memory/kidMemory";
import { getParentFlags, getRecentAttempts, getSubjectStats } from "@/lib/dashboard/store";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { updatePracticeState } from "@/lib/practice/store";
import { getTopicById } from "@/lib/map/topics";
import { isGrade } from "@/lib/kids/grade";
import type { KidGender, Subject } from "@/lib/memory/types";

function isGender(v: unknown): v is KidGender {
  return v === "boy" || v === "girl";
}

export const runtime = "nodejs";

/**
 * Merges what used to be /api/kids and /api/kids/[id] into one route —
 * same function-count reasoning as /api/tutor (see that file's comment).
 * PATCH now takes the kid id in the request body instead of the URL.
 *
 * GET also carries the parent dashboard's data (flags, recent attempts,
 * subject accuracy) — deliberately folded into this same route rather
 * than a new one, same Hobby-plan function-count constraint. This app's
 * per-parent kid/attempt volume is small enough that the extra payload
 * on every kid-list fetch is a non-issue; a real dashboard-specific
 * endpoint would only be worth the extra function once that stops
 * being true. `?view=kid` skips the dashboard half — the kid's screens
 * only need the kids themselves (grade, practice state per subject) and
 * refetch after every exercise.
 */

const SUBJECTS: Subject[] = ["math", "hebrew"];

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const kids = await listKids(supabase);
  if (req.nextUrl.searchParams.get("view") === "kid") {
    // feat: continuity greeting — one fact per kid, resolved server-side so
    // the payload carries a single small object instead of a history, and
    // the client never sees another kid's rows. Rides the fetch the kid
    // screens already make on mount; parallel per kid, same reasoning as
    // listKids' own N+1 fix.
    const openers = await Promise.all(
      kids.map(async (kid) => [kid.id, pickOpenerFact(await recentKidFacts(supabase, kid.id))] as const)
    );
    const openerByKid = Object.fromEntries(openers);
    return NextResponse.json({ kids: kids.map((k) => ({ ...k, openerFact: openerByKid[k.id] ?? null })) });
  }

  const today = new Date().toISOString().slice(0, 10);
  const dashboard = await Promise.all(
    kids.map(async (kid) => {
      const recentAttempts = await getRecentAttempts(supabase, kid.id);
      return {
        kidId: kid.id,
        flags: await getParentFlags(supabase, kid.id),
        recentAttempts,
        subjectStats: await getSubjectStats(supabase, kid.id),
        // Ties the locked ~15-min/day session target back to the
        // dashboard, per project-brief.md Section 2d-2's own flagged
        // open question ("how/whether the parent-facing side reflects
        // this daily target"). Derived from the already-fetched recent
        // attempts rather than a separate query — good enough for "did
        // something happen today," not a precise clock.
        practicedToday: recentAttempts.some((a) => a.createdAt.slice(0, 10) === today),
      };
    })
  );

  return NextResponse.json({ kids, dashboard });
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await req.json();
  const { name, avatarId, grade, gender } = body as {
    name?: string;
    avatarId?: string | null;
    grade?: string | null;
    gender?: string | null;
  };
  if (!name || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (grade != null && !isGrade(grade)) {
    return NextResponse.json({ error: "grade must be א, ב or ג" }, { status: 400 });
  }
  if (gender != null && !isGender(gender)) {
    return NextResponse.json({ error: "gender must be boy or girl" }, { status: 400 });
  }
  const kid = await createKid(
    supabase,
    user.id,
    name.trim(),
    avatarId ?? null,
    isGrade(grade) ? grade : null,
    isGender(gender) ? gender : null
  );
  return NextResponse.json({ kid });
}

interface PatchBody {
  id?: string;
  avatarId?: string;
  grade?: string;
  gender?: string;
  /** The parent dashboard's "הצע תרגול": a topic id, or null to withdraw
   *  the current suggestion. */
  suggestion?: { topicId?: string } | null;
  /** The map's one-time intro line was shown for this subject. */
  journeyIntroSeen?: string;
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as PatchBody;
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (
    body.avatarId === undefined &&
    body.grade === undefined &&
    body.gender === undefined &&
    body.suggestion === undefined &&
    body.journeyIntroSeen === undefined
  ) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  if (body.grade !== undefined && !isGrade(body.grade)) {
    return NextResponse.json({ error: "grade must be א, ב or ג" }, { status: 400 });
  }
  if (body.gender !== undefined && !isGender(body.gender)) {
    return NextResponse.json({ error: "gender must be boy or girl" }, { status: 400 });
  }
  const introSubject = SUBJECTS.find((s) => s === body.journeyIntroSeen);
  if (body.journeyIntroSeen !== undefined && !introSubject) {
    return NextResponse.json({ error: "journeyIntroSeen must be a subject" }, { status: 400 });
  }
  const suggested = body.suggestion ? getTopicById(body.suggestion.topicId ?? "") : undefined;
  if (body.suggestion && !suggested) {
    return NextResponse.json({ error: "unknown topic" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Ownership check: `kids` is RLS-gated to the signed-in parent, so
  // getKid() only finds this parent's own kids. subject_profiles' policies
  // don't check ownership — the practice_state writes below must never
  // run without this.
  const kid = await getKid(supabase, id);
  if (!kid) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    if (body.avatarId && !(await setKidAvatar(supabase, id, body.avatarId))) {
      throw new Error("avatar update failed");
    }
    if (isGrade(body.grade) && !(await setKidGrade(supabase, id, body.grade))) {
      throw new Error("grade update failed");
    }
    if (isGender(body.gender) && !(await setKidGender(supabase, id, body.gender))) {
      throw new Error("gender update failed");
    }
    if (body.suggestion !== undefined) {
      // One suggestion at a time: it lives on the suggested topic's
      // subject, and is cleared from the other one.
      const at = new Date().toISOString();
      for (const subject of SUBJECTS) {
        const next = suggested?.subject === subject ? { topicId: suggested.id, at } : undefined;
        if (!next && !kid.subjects[subject]?.practice?.parentSuggestion) continue;
        await updatePracticeState(supabase, id, subject, (s) => {
          const rest = { ...s };
          delete rest.parentSuggestion;
          return next ? { ...rest, parentSuggestion: next } : rest;
        });
      }
    }
    if (introSubject) {
      await updatePracticeState(supabase, id, introSubject, (s) =>
        s.journeyIntroSeenAt ? s : { ...s, journeyIntroSeenAt: new Date().toISOString() }
      );
    }
  } catch (err) {
    console.error("[kids] update failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  return NextResponse.json({ kid: await getKid(supabase, id) });
}
