"use server";

import { redirect } from "next/navigation";
import { decryptToken, encryptToken } from "@/lib/crypto";
import {
  getMetaConfig,
  MetaApiError,
  refreshInstagramLongLivedToken,
  refreshSystemUserToken,
} from "@/lib/instagram/meta";
import { isTokenRefreshDue } from "@/lib/instagram/oauth";
import {
  isOwnedInstagramAccount,
  shouldDeleteBusinessConnection,
} from "@/lib/instagram/flow";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getOwnerId(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login?redirectTo=%2Finstagram");
  return data.user.id;
}

export async function disconnectInstagramAccount(formData: FormData) {
  const ownerId = await getOwnerId();
  const accountId = formData.get("accountId");
  if (typeof accountId !== "string" || !UUID_PATTERN.test(accountId)) {
    redirect("/instagram?status=disconnect_failed");
  }

  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin
    .from("instagram_accounts")
    .select("id, owner_id, connection_id, unified_connection_id")
    .eq("id", accountId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (accountError) throw new Error("Unable to load the Instagram account.");
  if (!account || !isOwnedInstagramAccount(account, ownerId)) {
    redirect("/instagram?status=disconnect_failed");
  }

  const { error: logError } = await admin.from("activity_logs").insert({
    owner_id: ownerId,
    instagram_account_id: account.id,
    event_type: "INSTAGRAM_ACCOUNT_DISCONNECTED",
    action_type: "DISCONNECT",
    status: "SKIPPED",
    metadata: {},
  });
  if (logError) throw new Error("Unable to record the disconnect activity.");

  const { error: deleteError } = await admin
    .from("instagram_accounts")
    .delete()
    .eq("id", account.id)
    .eq("owner_id", ownerId);
  if (deleteError) throw new Error("Unable to disconnect the Instagram account.");

  if (account.connection_id) {
    const { count, error: countError } = await admin
      .from("instagram_accounts")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", account.connection_id)
      .eq("owner_id", ownerId);
    if (countError) throw new Error("Unable to validate the shared connection.");

    if (count !== null && shouldDeleteBusinessConnection(count)) {
      const { error: connectionError } = await admin
        .from("instagram_business_connections")
        .delete()
        .eq("id", account.connection_id)
        .eq("owner_id", ownerId);
      if (connectionError) {
        throw new Error("Unable to remove the stored business connection.");
      }
    }
  }

  if (account.unified_connection_id) {
    const { count, error: countError } = await admin
      .from("instagram_accounts")
      .select("id", { count: "exact", head: true })
      .eq("unified_connection_id", account.unified_connection_id)
      .eq("owner_id", ownerId);
    if (countError) throw new Error("Unable to validate the Unified Login connection.");

    if (count !== null && shouldDeleteBusinessConnection(count)) {
      const { error: connectionError } = await admin
        .from("instagram_unified_login_connections")
        .delete()
        .eq("id", account.unified_connection_id)
        .eq("owner_id", ownerId);
      if (connectionError) {
        throw new Error("Unable to remove the stored Unified Login connection.");
      }
    }
  }

  redirect("/instagram?status=disconnected");
}

export async function refreshInstagramConnection(formData: FormData) {
  const ownerId = await getOwnerId();
  const connectionId = formData.get("connectionId");
  if (typeof connectionId !== "string" || !UUID_PATTERN.test(connectionId)) {
    redirect("/instagram?status=refresh_failed");
  }

  const admin = createAdminClient();
  const { data: connection, error: lookupError } = await admin
    .from("instagram_business_connections")
    .select(
      "id, owner_id, login_type, instagram_user_id, encrypted_access_token, token_expires_at, connection_status, updated_at"
    )
    .eq("id", connectionId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (lookupError) throw new Error("Unable to load the Instagram connection.");
  if (!connection) redirect("/instagram?status=refresh_failed");
  if (
    connection.login_type !== "INSTAGRAM_LOGIN" ||
    !connection.instagram_user_id ||
    connection.connection_status !== "CONNECTED"
  ) {
    redirect("/instagram?status=refresh_failed");
  }

  if (
    connection.token_expires_at &&
    Date.parse(connection.token_expires_at) <= Date.now()
  ) {
    const { error: connectionUpdateError } = await admin
      .from("instagram_business_connections")
      .update({ connection_status: "EXPIRED" })
      .eq("id", connection.id)
      .eq("owner_id", ownerId);
    if (connectionUpdateError) {
      throw new Error("Unable to mark the expired Instagram token.");
    }

    const { error: accountsUpdateError } = await admin
      .from("instagram_accounts")
      .update({ connection_status: "EXPIRED" })
      .eq("connection_id", connection.id)
      .eq("owner_id", ownerId);
    if (accountsUpdateError) {
      throw new Error("Unable to mark the Instagram account as expired.");
    }
    redirect("/instagram?status=refresh_failed");
  }

  if (
    !isTokenRefreshDue(
      connection.token_expires_at,
      connection.updated_at
    )
  ) {
    redirect("/instagram?status=refresh_not_due");
  }

  const { data: accounts, error: accountsError } = await admin
    .from("instagram_accounts")
    .select("instagram_business_id")
    .eq("connection_id", connection.id)
    .eq("owner_id", ownerId)
    .eq("connection_status", "CONNECTED");
  if (accountsError) throw new Error("Unable to load connected Instagram assets.");
  if (
    !accounts.some(
      (account) => account.instagram_business_id === connection.instagram_user_id
    )
  ) {
    redirect("/instagram?status=refresh_failed");
  }

  try {
    const config = getMetaConfig();
    const currentToken = decryptToken(connection.encrypted_access_token);
    const refreshedToken = await refreshInstagramLongLivedToken(
      config,
      currentToken,
      connection.instagram_user_id
    );
    const { error: updateError } = await admin
      .from("instagram_business_connections")
      .update({
        encrypted_access_token: encryptToken(refreshedToken.accessToken),
        token_expires_at: refreshedToken.expiresAt,
        connection_status: "CONNECTED",
      })
      .eq("id", connection.id)
      .eq("owner_id", ownerId);
    if (updateError) throw new Error("Unable to securely store the refreshed token.");
  } catch (error) {
    if (error instanceof MetaApiError) {
      console.error("[Instagram] Instagram token refresh failed.", error.code);
      if (
        error.code === "instagram_token_invalid" ||
        error.code === "meta_token_invalid"
      ) {
        const { error: connectionUpdateError } = await admin
          .from("instagram_business_connections")
          .update({ connection_status: "REVOKED" })
          .eq("id", connection.id)
          .eq("owner_id", ownerId);
        if (connectionUpdateError) {
          throw new Error("Unable to mark the revoked Instagram token.");
        }

        const { error: accountsUpdateError } = await admin
          .from("instagram_accounts")
          .update({ connection_status: "REVOKED" })
          .eq("connection_id", connection.id)
          .eq("owner_id", ownerId);
        if (accountsUpdateError) {
          throw new Error("Unable to mark the Instagram account as revoked.");
        }
      }
      redirect("/instagram?status=refresh_failed");
    }
    throw error;
  }

  redirect("/instagram?status=refreshed");
}

export async function refreshUnifiedLoginConnection(formData: FormData) {
  const ownerId = await getOwnerId();
  const connectionId = formData.get("connectionId");
  if (typeof connectionId !== "string" || !UUID_PATTERN.test(connectionId)) {
    redirect("/instagram?status=refresh_failed");
  }

  const admin = createAdminClient();
  const { data: connection, error: lookupError } = await admin
    .from("instagram_unified_login_connections")
    .select(
      "id, owner_id, client_business_id, system_user_id, encrypted_access_token, token_expires_at, connection_status, updated_at"
    )
    .eq("id", connectionId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (lookupError) throw new Error("Unable to load the Unified Login connection.");
  if (!connection || connection.connection_status !== "CONNECTED") {
    redirect("/instagram?status=refresh_failed");
  }

  if (
    connection.token_expires_at &&
    Date.parse(connection.token_expires_at) <= Date.now()
  ) {
    const { error: connectionUpdateError } = await admin
      .from("instagram_unified_login_connections")
      .update({ connection_status: "EXPIRED" })
      .eq("id", connection.id)
      .eq("owner_id", ownerId);
    if (connectionUpdateError) {
      throw new Error("Unable to mark the expired Unified Login token.");
    }

    const { error: accountsUpdateError } = await admin
      .from("instagram_accounts")
      .update({ connection_status: "EXPIRED" })
      .eq("unified_connection_id", connection.id)
      .eq("owner_id", ownerId);
    if (accountsUpdateError) {
      throw new Error("Unable to mark the Unified Login accounts as expired.");
    }
    redirect("/instagram?status=refresh_failed");
  }

  if (!isTokenRefreshDue(connection.token_expires_at, connection.updated_at)) {
    redirect("/instagram?status=refresh_not_due");
  }

  const { data: accounts, error: accountsError } = await admin
    .from("instagram_accounts")
    .select("instagram_business_id")
    .eq("unified_connection_id", connection.id)
    .eq("owner_id", ownerId)
    .eq("connection_status", "CONNECTED");
  if (accountsError) throw new Error("Unable to load assigned Instagram assets.");
  if (accounts.length === 0) redirect("/instagram?status=refresh_failed");

  try {
    const config = getMetaConfig();
    const refreshedToken = await refreshSystemUserToken(
      config,
      decryptToken(connection.encrypted_access_token),
      connection.client_business_id,
      connection.system_user_id,
      accounts.map((account) => account.instagram_business_id)
    );
    const { error: updateError } = await admin
      .from("instagram_unified_login_connections")
      .update({
        encrypted_access_token: encryptToken(refreshedToken.accessToken),
        token_expires_at: refreshedToken.expiresAt,
        connection_status: "CONNECTED",
      })
      .eq("id", connection.id)
      .eq("owner_id", ownerId);
    if (updateError) {
      throw new Error("Unable to securely store the refreshed System User token.");
    }
  } catch (error) {
    if (error instanceof MetaApiError) {
      console.error("[Instagram] Unified Login token refresh failed.", error.code);
      if (
        error.code === "meta_token_invalid" ||
        error.code === "meta_system_user_token_invalid"
      ) {
        const { error: connectionUpdateError } = await admin
          .from("instagram_unified_login_connections")
          .update({ connection_status: "REVOKED" })
          .eq("id", connection.id)
          .eq("owner_id", ownerId);
        if (connectionUpdateError) {
          throw new Error("Unable to mark the Unified Login token as revoked.");
        }

        const { error: accountsUpdateError } = await admin
          .from("instagram_accounts")
          .update({ connection_status: "REVOKED" })
          .eq("unified_connection_id", connection.id)
          .eq("owner_id", ownerId);
        if (accountsUpdateError) {
          throw new Error("Unable to mark the Unified Login accounts as revoked.");
        }
      }
      redirect("/instagram?status=refresh_failed");
    }
    throw error;
  }

  redirect("/instagram?status=refreshed");
}
