import "server-only";
import { getSiteUrl } from "../auth/site-url.ts";
import {
  createAppSecretProof,
  META_REQUIRED_PERMISSIONS,
} from "./oauth.ts";

export class MetaApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "MetaApiError";
    this.code = code;
  }
}

export type MetaConfig = {
  appId: string;
  appSecret: string;
  configId: string;
  apiVersion: string;
  redirectUri: string;
};

export type MetaInstagramAccount = {
  id: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

export function getMetaConfig(): MetaConfig {
  const apiVersion = process.env.META_API_VERSION ?? "v27.0";
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error("META_API_VERSION must have the format vNN.N.");
  }

  const redirectUri = requiredEnv("META_REDIRECT_URI");
  const expectedRedirectUri = `${getSiteUrl()}/api/instagram/callback`;
  if (redirectUri !== expectedRedirectUri) {
    throw new Error(
      "META_REDIRECT_URI must exactly match the configured Instagram callback URL."
    );
  }

  return {
    appId: requiredEnv("META_APP_ID"),
    appSecret: requiredEnv("META_APP_SECRET"),
    configId: requiredEnv("META_CONFIG_ID"),
    apiVersion,
    redirectUri,
  };
}

function graphUrl(config: MetaConfig, path: string): URL {
  if (path.startsWith("/") || path.includes("..")) {
    throw new Error("Invalid Meta Graph API path.");
  }
  return new URL(`https://graph.facebook.com/${config.apiVersion}/${path}`);
}

async function graphRequest<T>(
  config: MetaConfig,
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  method: "GET" | "POST" = "GET"
): Promise<T> {
  const url = graphUrl(config, path);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set(
    "appsecret_proof",
    createAppSecretProof(accessToken, config.appSecret)
  );
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MetaApiError("meta_unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MetaApiError("meta_invalid_response");
  }

  if (!response.ok || !payload || typeof payload !== "object") {
    throw new MetaApiError("meta_request_failed");
  }

  return payload as T;
}

type TokenExchangeResponse = {
  access_token?: unknown;
  expires_in?: unknown;
};

export type ExchangedMetaToken = {
  accessToken: string;
  expiresAt: string | null;
};

export async function exchangeMetaCode(
  config: MetaConfig,
  code: string
): Promise<ExchangedMetaToken> {
  const url = graphUrl(config, "oauth/access_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("code", code);
  url.searchParams.set("redirect_uri", config.redirectUri);

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MetaApiError("meta_unavailable");
  }

  let payload: TokenExchangeResponse;
  try {
    payload = (await response.json()) as TokenExchangeResponse;
  } catch {
    throw new MetaApiError("meta_invalid_response");
  }

  
if (
  !response.ok ||
  typeof payload.access_token !== "string" ||
  payload.access_token.length === 0
) {
  const metaError = (
    payload as {
      error?: {
        type?: string;
        code?: number;
        error_subcode?: number;
      };
    }
  ).error;

  console.error("[Instagram] Meta token exchange rejected.", {
    httpStatus: response.status,
    errorType: metaError?.type ?? "unknown",
    errorCode: metaError?.code ?? null,
    errorSubcode: metaError?.error_subcode ?? null,
  });

  throw new MetaApiError("meta_token_exchange_failed");
}


  if (payload.expires_in === undefined) {
    return { accessToken: payload.access_token, expiresAt: null };
  }
  if (
    typeof payload.expires_in !== "number" ||
    !Number.isFinite(payload.expires_in) ||
    payload.expires_in <= 0
  ) {
    throw new MetaApiError("meta_invalid_expiry");
  }

  return {
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
  };
}

type MetaIdentityResponse = {
  id?: unknown;
  client_business_id?: unknown;
};

type PermissionResponse = {
  data?: Array<{ permission?: unknown; status?: unknown }>;
};

export type MetaBusinessIdentity = {
  systemUserId: string;
  clientBusinessId: string;
};

export async function getMetaBusinessIdentity(
  config: MetaConfig,
  accessToken: string
): Promise<MetaBusinessIdentity> {
  const identity = await graphRequest<MetaIdentityResponse>(
    config,
    "me",
    accessToken,
    { fields: "id,client_business_id" }
  );
    console.error("[Instagram] Meta identity response shape.", {
    fields: Object.keys(identity),
    hasId: typeof identity.id === "string",
    hasClientBusinessId:
      typeof identity.client_business_id === "string",
  });
  if (
    typeof identity.id !== "string" ||
    !/^\d+$/.test(identity.id) ||
    typeof identity.client_business_id !== "string" ||
    !/^\d+$/.test(identity.client_business_id)
  ) {
    throw new MetaApiError("meta_business_identity_missing");
  }

  const permissions = await graphRequest<PermissionResponse>(
    config,
    "me/permissions",
    accessToken
  );
  const granted = new Set(
    (permissions.data ?? [])
      .filter((permission) => permission.status === "granted")
      .map((permission) => permission.permission)
      .filter((permission): permission is string => typeof permission === "string")
  );
  if (!META_REQUIRED_PERMISSIONS.every((permission) => granted.has(permission))) {
    throw new MetaApiError("meta_permissions_missing");
  }

  return {
    systemUserId: identity.id,
    clientBusinessId: identity.client_business_id,
  };
}

type AssignedAccountsResponse = {
  data?: Array<{
    id?: unknown;
    username?: unknown;
    name?: unknown;
    profile_picture_url?: unknown;
  }>;
  paging?: { cursors?: { after?: unknown }; next?: unknown };
};

export async function getAssignedInstagramAccounts(
  config: MetaConfig,
  accessToken: string
): Promise<MetaInstagramAccount[]> {
  const accounts: MetaInstagramAccount[] = [];
  let after: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const params: Record<string, string> = {
      fields: "id,username,name,profile_picture_url",
      limit: "100",
    };
    if (after) params.after = after;

    const result = await graphRequest<AssignedAccountsResponse>(
      config,
      "me/assigned_instagram_accounts",
      accessToken,
      params
    );
    if (!Array.isArray(result.data)) {
      throw new MetaApiError("meta_accounts_invalid_response");
    }

    for (const item of result.data) {
      if (
        typeof item.id !== "string" ||
        !/^\d+$/.test(item.id) ||
        typeof item.username !== "string" ||
        item.username.length === 0
      ) {
        throw new MetaApiError("meta_account_invalid");
      }
      accounts.push({
        id: item.id,
        username: item.username,
        name: typeof item.name === "string" ? item.name : null,
        profilePictureUrl:
          typeof item.profile_picture_url === "string"
            ? item.profile_picture_url
            : null,
      });
    }

    const next = result.paging?.cursors?.after;
    if (!result.paging?.next) return accounts;
    if (typeof next !== "string" || next === after) {
      throw new MetaApiError("meta_pagination_invalid");
    }
    after = next;
  }

  throw new MetaApiError("meta_account_limit_exceeded");
}

type RenewedSystemUserTokenResponse = {
  access_token?: unknown;
};

export async function refreshSystemUserToken(
  config: MetaConfig,
  accessToken: string,
  clientBusinessId: string,
  systemUserId: string,
  instagramAccountIds: string[]
): Promise<{ accessToken: string; expiresAt: string }> {
  if (
    !/^\d+$/.test(clientBusinessId) ||
    !/^\d+$/.test(systemUserId) ||
    instagramAccountIds.length === 0 ||
    instagramAccountIds.some((id) => !/^\d+$/.test(id))
  ) {
    throw new MetaApiError("meta_business_identity_missing");
  }
  const result = await graphRequest<RenewedSystemUserTokenResponse>(
    config,
    `${clientBusinessId}/system_user_access_tokens`,
    accessToken,
    {
      system_user_id: systemUserId,
      asset: instagramAccountIds.join(","),
      scope: META_REQUIRED_PERMISSIONS.join(","),
      set_token_expires_in_60_days: "true",
    },
    "POST"
  );
  if (typeof result.access_token !== "string" || !result.access_token) {
    throw new MetaApiError("meta_refresh_failed");
  }
  return {
    accessToken: result.access_token,
    expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  };
}
