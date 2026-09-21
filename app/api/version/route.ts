import { NextResponse } from "next/server";

export const runtime = "nodejs";
/** Read the environment on every request, never at build time and never
 *  from a cache: the whole point is to answer "what is actually running
 *  right now". */
export const dynamic = "force-dynamic";

/**
 * GET /api/version — which commit is live, in one unauthenticated request.
 *
 * Written after a deploy that could not be verified from outside: the app
 * exposed no build identity, and a server-only change leaves the client
 * bundle byte-identical, so the usual "did the chunk hashes move" trick
 * proves nothing. Vercel hands every build its own
 * VERCEL_GIT_COMMIT_SHA; this is the one line that makes it readable.
 *
 * Deliberately public. It reveals a commit SHA of a private repo, which
 * is an opaque identifier — not code, not history, not a token — and the
 * alternative (an authenticated check) is exactly the thing that made the
 * last deploy unverifiable. Nothing else about the environment is exposed:
 * the fields are listed one by one below, never the env object.
 */
export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  return NextResponse.json(
    {
      // Short form, as `git log --oneline` prints it — what a person
      // compares against by eye. Null locally, where git metadata is not
      // injected; the full form is there too when something needs to
      // match it exactly.
      sha: sha ? sha.slice(0, 7) : null,
      fullSha: sha,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      env: process.env.VERCEL_ENV ?? "local",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
