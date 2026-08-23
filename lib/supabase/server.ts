import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/** Session-bound Supabase client for Route Handlers / Server Components —
 *  reads the parent's auth cookie so `auth.uid()` resolves correctly in
 *  RLS policies (the `kids` table policies added in the parent-accounts
 *  migration require this; the plain anon client in client.ts has no user
 *  context and would be denied by those policies). */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component that can't set cookies — fine,
            // middleware.ts handles session refresh instead.
          }
        },
      },
    }
  );
}
