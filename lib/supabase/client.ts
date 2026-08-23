import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Server-only Supabase client. Uses the publishable/anon key — safe to
 * embed, not a secret — because there's no Supabase Auth user system yet
 * and all access is mediated by our own trusted API routes (never called
 * directly from the browser). RLS policies on each table are scoped to
 * exactly what the app does (select/insert/update, no delete).
 *
 * Tighten to the service_role key + real per-parent auth before this holds
 * real families' data — noted in the migration itself too.
 */
let client: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set.");
    }
    client = createClient<Database>(url, key);
  }
  return client;
}
