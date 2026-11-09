import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  getProtectedRouteRedirect,
  isExpectedMissingAuthSession,
} from "@/lib/auth/flow";

/**
 * Updates Supabase session tokens in cookies and enforces route protection.
 * Used inside Next.js 16 proxy.ts.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Fail closed on protected pages if auth configuration is unavailable.
  if (!supabaseUrl || !supabaseAnonKey) {
    const redirectTo = getProtectedRouteRedirect(request.nextUrl, false);
    if (redirectTo) {
      return NextResponse.redirect(redirectTo);
    }

    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Validate with the Auth server; never trust the session cookie alone.
  let hasUser = false;
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    hasUser = Boolean(user && !error);
    if (error && !isExpectedMissingAuthSession(error)) {
      console.warn("[Auth] Session validation failed.", error.message);
    }
  } catch (error) {
    if (!isExpectedMissingAuthSession(error)) {
      console.error(
        "[Auth] Session validation could not reach Supabase.",
        error instanceof Error ? error.message : "Unknown auth error"
      );
    }
  }

  const redirectTo = getProtectedRouteRedirect(request.nextUrl, hasUser);
  if (redirectTo) {
    return NextResponse.redirect(redirectTo);
  }

  return response;
}
