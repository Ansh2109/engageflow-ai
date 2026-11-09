import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  buildMetaAuthorizationUrl,
  createOAuthState,
  shouldUseSecureOAuthCookie,
} from "@/lib/instagram/oauth";
import { getMetaConfig } from "@/lib/instagram/meta";
import { getSiteUrl } from "@/lib/auth/site-url";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.redirect(
      new URL("/login?redirectTo=%2Finstagram", getSiteUrl())
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) throw new Error("Unable to validate the application profile.");
  if (!profile) {
    return NextResponse.redirect(
      new URL("/instagram?status=profile_missing", getSiteUrl())
    );
  }

  const config = getMetaConfig();
  const { state, record } = createOAuthState(data.user.id, config.appSecret);
  const admin = createAdminClient();
  const { error: stateError } = await admin.rpc(
    "create_instagram_oauth_state",
    {
      p_nonce_hash: record.nonceHash,
      p_user_id: record.userId,
      p_issued_at: record.issuedAt,
      p_expires_at: record.expiresAt,
    }
  );
  if (stateError) {
    throw new Error("Unable to securely create the Instagram OAuth state.");
  }

  const response = NextResponse.redirect(
    buildMetaAuthorizationUrl(config, state)
  );
  response.cookies.set(
    "instagram_oauth_state",
    state,
    {
      httpOnly: true,
      secure: shouldUseSecureOAuthCookie(getSiteUrl()),
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    }
  );
  return response;
}
