import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/** Client-side Supabase client for the login/signup form — the only place
 *  that calls Supabase directly from the browser. Uses the same
 *  publishable/anon key as the server (safe to expose). */
export function getSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
