import { createClient } from "@/lib/supabase/server";
import {
  completeOAuthCallback,
  getOAuthErrorRedirect,
  oauthErrorCode,
} from "@/lib/auth/flow";
import { getSiteUrl } from "@/lib/auth/site-url";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const siteUrl = getSiteUrl();
  const providerError = oauthErrorCode(requestUrl.searchParams.get("error"));

  if (providerError) {
    const loginUrl = new URL("/login", siteUrl);
    loginUrl.searchParams.set("error", providerError);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const supabase = await createClient();
    const result = await completeOAuthCallback(
      {
        async exchangeCodeForSession(code) {
          const { data, error } =
            await supabase.auth.exchangeCodeForSession(code);
          return { userId: data.user?.id ?? null, failed: Boolean(error) };
        },
        async hasProfile(userId) {
          const { data, error } = await supabase
            .from("profiles")
            .select("id")
            .eq("id", userId)
            .maybeSingle();
          return !error && data?.id === userId;
        },
        async signOut() {
          const { error } = await supabase.auth.signOut();
          return Boolean(error);
        },
      },
      requestUrl.searchParams.get("code"),
      requestUrl.searchParams.get("next")
    );

    if (result.failure) {
      console.error("[Auth] OAuth callback rejected.", result.failure);
    }

    return NextResponse.redirect(new URL(result.destination, siteUrl));
  } catch (error) {
    console.error(
      "[Auth] OAuth callback failed.",
      error instanceof Error ? error.message : "Unknown server error"
    );
    return NextResponse.redirect(getOAuthErrorRedirect(siteUrl));
  }
}
