import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 *
 * SAFETY NOTICE:
 * Uses ONLY public environment variables (NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
 *
 * SUPABASE_SECRET_KEY is NEVER imported or referenced here.
 * This client is safe to use in Client Components ("use client").
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase public configuration. Please check your .env.local file."
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
