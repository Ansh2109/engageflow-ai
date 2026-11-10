import "server-only";

import { decryptToken } from "../crypto.ts";
import { createAdminClient, createClient } from "../supabase/server.ts";
import { getMetaConfig, type MetaConfig } from "./meta.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type InstagramConnectionStatus = "EXPIRED" | "REVOKED";

type InstagramDataContext = {
  instagramBusinessId: string;
  accessToken: string;
  config: MetaConfig;
  markConnectionStatus: (status: InstagramConnectionStatus) => Promise<void>;
};

type InstagramDataContextResult =
  | { ok: true; context: InstagramDataContext }
  | { ok: false; status: number; error: string };

export async function getOwnedInstagramDataContext(
  accountId: string | null
): Promise<InstagramDataContextResult> {
  if (!accountId || !UUID_PATTERN.test(accountId)) {
    return { ok: false, status: 400, error: "invalid_account_id" };
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin
    .from("instagram_accounts")
    .select(
      "id, owner_id, instagram_business_id, connection_id, unified_connection_id, connection_status"
    )
    .eq("id", accountId)
    .eq("owner_id", authData.user.id)
    .maybeSingle();

  if (accountError) {
    throw new Error("Unable to load the owned Instagram account.");
  }
  if (!account) {
    return { ok: false, status: 404, error: "account_not_found" };
  }

  let connection:
    | {
        id: string;
        encrypted_access_token: string;
        token_expires_at: string | null;
        connection_status: string;
      }
    | undefined;
  let connectionTable:
      | "instagram_unified_login_connections"
      | "instagram_business_connections";

  if (account.unified_connection_id) {
      const { data, error } = await admin
        .from("instagram_unified_login_connections")
        .select(
          "id, owner_id, encrypted_access_token, token_expires_at, connection_status"
        )
      .eq("id", account.unified_connection_id)
      .eq("owner_id", authData.user.id)
      .maybeSingle();
    if (error) {
      throw new Error("Unable to load the Instagram System User connection.");
    }
    if (!data) {
      return { ok: false, status: 404, error: "connection_not_found" };
    }
    connection = data;
    connectionTable = "instagram_unified_login_connections";
  } else if (account.connection_id) {
    const { data, error } = await admin
      .from("instagram_business_connections")
      .select(
        "id, owner_id, login_type, encrypted_access_token, token_expires_at, connection_status"
      )
      .eq("id", account.connection_id)
      .eq("owner_id", authData.user.id)
      .maybeSingle();
    if (error) {
      throw new Error("Unable to load the Instagram connection.");
    }
    if (!data) {
      return { ok: false, status: 404, error: "connection_not_found" };
    }
    if (data.login_type !== "UNIFIED_LOGIN") {
      return { ok: false, status: 409, error: "system_user_token_required" };
    }
    connection = data;
    connectionTable = "instagram_business_connections";
  } else {
    return { ok: false, status: 409, error: "system_user_token_required" };
  }

  if (
    connection.token_expires_at &&
    Date.parse(connection.token_expires_at) <= Date.now()
  ) {
    await updateConnectionStatus(
      admin,
      account.owner_id,
      connection.id,
      connectionTable,
      "EXPIRED"
    );
    return { ok: false, status: 401, error: "reconnect_required" };
  }
  if (
    account.connection_status !== "CONNECTED" ||
    connection.connection_status !== "CONNECTED"
  ) {
    return { ok: false, status: 401, error: "reconnect_required" };
  }

  const accessToken = decryptToken(connection.encrypted_access_token);
  const config = getMetaConfig();

  return {
    ok: true,
    context: {
      instagramBusinessId: account.instagram_business_id,
      accessToken,
      config,
      markConnectionStatus: async (status) => {
        await updateConnectionStatus(
          admin,
          account.owner_id,
          connection.id,
          connectionTable,
          status
        );
      },
    },
  };
}

async function updateConnectionStatus(
  admin: ReturnType<typeof createAdminClient>,
  ownerId: string,
  connectionId: string,
  connectionTable:
    | "instagram_unified_login_connections"
    | "instagram_business_connections",
  status: InstagramConnectionStatus
): Promise<void> {
  const { error: connectionError } = await admin
    .from(connectionTable)
    .update({ connection_status: status })
    .eq("id", connectionId)
    .eq("owner_id", ownerId);
  if (connectionError) {
    throw new Error("Unable to update the Instagram connection status.");
  }

  const accountQuery = admin
    .from("instagram_accounts")
    .update({ connection_status: status })
    .eq("owner_id", ownerId);
  const { error: accountError } =
    connectionTable === "instagram_unified_login_connections"
      ? await accountQuery.eq("unified_connection_id", connectionId)
      : await accountQuery.eq("connection_id", connectionId);
  if (accountError) {
    throw new Error("Unable to update the Instagram account status.");
  }
}
