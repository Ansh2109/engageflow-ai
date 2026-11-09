import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Standard server-side Supabase client for Server Components, Server Actions,
 * and Route Handlers.
 *
 * It uses the user's session cookies and public anon key, respecting all
 * Row Level Security (RLS) policies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase public configuration. Please check your .env.local file."
    );
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
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
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have proxy/middleware refreshing sessions.
        }
      },
    },
  });
}

/**
 * Privileged Admin Supabase Client.
 *
 * CRITICAL SECURITY CONSTRAINTS:
 * 1. Uses SUPABASE_SECRET_KEY to bypass Row Level Security.
 * 2. ONLY for internal server-side operations (webhook ingestion, background jobs).
 * 3. Throws immediately if invoked in a browser environment.
 * 4. NEVER import or call this function from client components ("use client").
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "FATAL SECURITY VIOLATION: createAdminClient cannot be called on the client."
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "Missing Supabase URL or SUPABASE_SECRET_KEY. Please verify your .env.local configuration."
    );
  }

  return createSupabaseClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
