
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { consumeValidOAuthState } from "@/lib/instagram/oauth";

import {
  exchangeMetaCode,
  getMetaConfig,
  MetaApiError,
} from "@/lib/instagram/meta";

import { encryptToken } from "@/lib/crypto";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/auth/site-url";

import {
  classifyInstagramCallback,
} from "@/lib/instagram/flow";

const STATE_COOKIE = "instagram_oauth_state";

function getCallbackParameter(
  requestUrl: URL,
  name: string,
  maxLength: number
): string | null {
  const values = requestUrl.searchParams.getAll(name);
  if (values.length !== 1) return null;
  const value = values[0];
  if (
    !value ||
    value.length > maxLength ||
    /[\u0000-\u001f]/.test(value)
  ) {
    return null;
  }
  return value;
}

function instagramRedirect(status: string, clearState = true) {
  const response = NextResponse.redirect(
    new URL(`/instagram?status=${encodeURIComponent(status)}`, getSiteUrl())
  );

  if (clearState) response.cookies.delete(STATE_COOKIE);

  return response;
}

function loginRedirect() {
  const response = NextResponse.redirect(
    new URL("/login?redirectTo=%2Finstagram", getSiteUrl())
  );

  response.cookies.delete(STATE_COOKIE);

  return response;
}

async function writeActivityLog(
  admin: ReturnType<typeof createAdminClient>,
  entry: {
    owner_id: string;
    instagram_account_id?: string | null;
    event_type: string;
    action_type: string;
    status: "MATCHED" | "FAILED";
    error_code?: string | null;
    metadata?: Record<string, string>;
  }
) {
  const { error } = await admin.from("activity_logs").insert({
    owner_id: entry.owner_id,
    instagram_account_id: entry.instagram_account_id ?? null,
    event_type: entry.event_type,
    action_type: entry.action_type,
    status: entry.status,
    error_code: entry.error_code ?? null,
    metadata: entry.metadata ?? {},
  });

  if (error) {
    console.error(
      "[Instagram] Could not write connection activity log.",
      error.code
    );
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  const cookieStore = await cookies();
  const savedState = cookieStore.get(STATE_COOKIE)?.value;

  const receivedState = getCallbackParameter(requestUrl, "state", 4096);
  const code = getCallbackParameter(requestUrl, "code", 2048);
  const providerError = getCallbackParameter(requestUrl, "error", 128);
  const invalidProviderError =
    requestUrl.searchParams.has("error") && providerError === null;

  const supabase = await createClient();

  const { data: authData, error: authError } =
    await supabase.auth.getUser();

  if (authError || !authData.user) {
    return loginRedirect();
  }

  const config = getMetaConfig();
  const admin = createAdminClient();

  const stateConsumed = await consumeValidOAuthState(
    receivedState,
    savedState,
    authData.user.id,
    config.appSecret,
    async (record) => {
      const { data, error } = await admin.rpc(
        "consume_instagram_oauth_state",
        {
          p_nonce_hash: record.nonceHash,
          p_user_id: record.userId,
          p_issued_at: record.issuedAt,
          p_expires_at: record.expiresAt,
        }
      );

      if (error) {
        throw new Error(
          "Unable to securely validate the Instagram OAuth state."
        );
      }

      return data === true;
    }
  );

  const callback = classifyInstagramCallback(
    stateConsumed,
    invalidProviderError ? "invalid_request" : providerError,
    code
  );

  if (callback.kind === "invalid_state") {
    return instagramRedirect(callback.status);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error("Unable to validate the application profile.");
  }

  if (!profile) {
    await writeActivityLog(admin, {
      owner_id: authData.user.id,
      event_type: "INSTAGRAM_CONNECTION_FAILED",
      action_type: "CONNECT",
      status: "FAILED",
      error_code: "profile_missing",
    });

    return instagramRedirect("profile_missing");
  }

  if (callback.kind === "provider_error") {
    await writeActivityLog(admin, {
      owner_id: authData.user.id,
      event_type: "INSTAGRAM_CONNECTION_FAILED",
      action_type: "CONNECT",
      status: "FAILED",
      error_code: callback.status,
    });

    return instagramRedirect(callback.status);
  }

  if (callback.kind === "missing_code") {
    await writeActivityLog(admin, {
      owner_id: authData.user.id,
      event_type: "INSTAGRAM_CONNECTION_FAILED",
      action_type: "CONNECT",
      status: "FAILED",
      error_code: "oauth_code_missing",
    });

    return instagramRedirect(callback.status);
  }

  try {
    // Exchange the code, extend the token, and resolve the authorized account.
    const token = await exchangeMetaCode(config, callback.code);

    const { error: persistError } = await admin.rpc(
      "persist_instagram_login_connection",
      {
        p_owner_id: authData.user.id,
        p_instagram_user_id: token.account.id,
        p_username: token.account.username,
        p_name: token.account.name,
        p_profile_picture_url: token.account.profilePictureUrl,
        p_account_type: token.account.accountType,
        p_encrypted_access_token: encryptToken(token.accessToken),
        p_token_expires_at: token.expiresAt,
        p_scopes: token.scopes,
      }
    );

    if (persistError) {
      if (
        persistError.message ===
        "instagram_account_already_connected"
      ) {
        throw new MetaApiError("instagram_account_already_connected");
      }

      throw new Error(
        "Unable to atomically save the Instagram connection."
      );
    }

    return instagramRedirect("connected");
  } catch (error) {
    const failureCode =
      error instanceof MetaApiError
        ? error.code
        : "connection_failed";

    console.error(
      "[Instagram] OAuth connection failed.",
      failureCode
    );

    await writeActivityLog(admin, {
      owner_id: authData.user.id,
      event_type: "INSTAGRAM_CONNECTION_FAILED",
      action_type: "CONNECT",
      status: "FAILED",
      error_code: failureCode,
    });

    return instagramRedirect(
      failureCode === "instagram_account_already_connected"
        ? "account_in_use"
        : "oauth_failed"
    );
  }
}
