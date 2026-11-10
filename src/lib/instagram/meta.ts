import "server-only";

import { getSiteUrl } from "../auth/site-url.ts";
import {
  isValidMetaId,
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
  apiVersion: string;
  redirectUri: string;
};

export type MetaInstagramAccount = {
  id: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  accountType: "BUSINESS" | "CREATOR" | "UNKNOWN";
};

export type ExchangedMetaToken = {
  accessToken: string;
  expiresAt: string;
  scopes: string[];
  account: MetaInstagramAccount;
};

type InstagramTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  user_id?: unknown;
  permissions?: unknown;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required server configuration: ${name}`);
  }
  return value;
}

export function getMetaConfig(): MetaConfig {
  const apiVersion = process.env.META_API_VERSION ?? "v27.0";
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error("META_API_VERSION must have the format vNN.N.");
  }

  const appId = requiredEnv("META_APP_ID");
  if (!isValidMetaId(appId)) {
    throw new Error("META_APP_ID must be the numeric Instagram App ID.");
  }

  const redirectUri = requiredEnv("META_REDIRECT_URI");
  const expectedRedirectUri = `${getSiteUrl()}/api/instagram/callback`;
  if (redirectUri !== expectedRedirectUri) {
    throw new Error(
      "META_REDIRECT_URI must exactly match the configured Instagram callback URL."
    );
  }

  return {
    appId,
    appSecret: requiredEnv("META_APP_SECRET"),
    apiVersion,
    redirectUri,
  };
}

function graphUrl(config: MetaConfig, path: string): URL {
  if (path.startsWith("/") || path.includes("..")) {
    throw new Error("Invalid Instagram Graph API path.");
  }
  return new URL(`https://graph.instagram.com/${config.apiVersion}/${path}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function responseData(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  if (!("data" in record)) return record;

  if (Array.isArray(record.data)) {
    return record.data.length === 1 ? asRecord(record.data[0]) : null;
  }
  return asRecord(record.data);
}

async function requestJson(
  url: URL,
  init: RequestInit,
  failureCode: string
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
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

  if (!response.ok) {
    const root = asRecord(payload);
    const error = asRecord(root?.error);
    if (error?.code === 190) {
      throw new MetaApiError("instagram_token_invalid");
    }
    throw new MetaApiError(failureCode);
  }
  return payload;
}

function tokenExpiry(expiresIn: unknown): string {
  if (
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new MetaApiError("meta_invalid_expiry");
  }
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function accountType(value: unknown): MetaInstagramAccount["accountType"] {
  if (typeof value !== "string") return "UNKNOWN";
  if (value.toUpperCase() === "BUSINESS") return "BUSINESS";
  if (
    value.toUpperCase() === "MEDIA_CREATOR" ||
    value.toUpperCase() === "CREATOR"
  ) {
    return "CREATOR";
  }
  return "UNKNOWN";
}

export async function getInstagramAccountIdentity(
  config: MetaConfig,
  accessToken: string
): Promise<MetaInstagramAccount> {
  const url = graphUrl(config, "me");
  url.searchParams.set(
    "fields",
    "id,user_id,username,name,profile_picture_url,account_type"
  );
  url.searchParams.set("access_token", accessToken);

  const payload = await requestJson(
    url,
    { method: "GET" },
    "meta_identity_failed"
  );
  const identity = responseData(payload);
  if (
    !identity ||
    !isValidMetaId(identity.user_id) ||
    typeof identity.username !== "string" ||
    identity.username.trim().length === 0 ||
    identity.username.length > 255
  ) {
    throw new MetaApiError("meta_identity_invalid");
  }

  return {
    id: identity.user_id,
    username: identity.username,
    name: typeof identity.name === "string" ? identity.name : null,
    profilePictureUrl:
      typeof identity.profile_picture_url === "string"
        ? identity.profile_picture_url
        : null,
    accountType: accountType(identity.account_type),
  };
}

async function exchangeForLongLivedToken(
  config: MetaConfig,
  shortLivedToken: string
): Promise<{ accessToken: string; expiresAt: string }> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const payload = await requestJson(
    url,
    { method: "GET" },
    "meta_long_lived_exchange_failed"
  );
  const token = asRecord(payload);
  if (typeof token?.access_token !== "string" || !token.access_token) {
    throw new MetaApiError("meta_long_lived_exchange_failed");
  }

  return {
    accessToken: token.access_token,
    expiresAt: tokenExpiry(token.expires_in),
  };
}

export async function exchangeMetaCode(
  config: MetaConfig,
  code: string
): Promise<ExchangedMetaToken> {
  if (!code || code.length > 2048 || /[\u0000-\u001f]/.test(code)) {
    throw new MetaApiError("oauth_code_invalid");
  }

  const form = new FormData();
  form.set("client_id", config.appId);
  form.set("client_secret", config.appSecret);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", config.redirectUri);
  form.set("code", code);

  const shortLivedPayload = await requestJson(
    new URL("https://api.instagram.com/oauth/access_token"),
    { method: "POST", body: form },
    "meta_token_exchange_failed"
  );
  const shortLived = responseData(shortLivedPayload) as
    | InstagramTokenResponse
    | null;
  if (
    typeof shortLived?.access_token !== "string" ||
    !shortLived.access_token ||
    !isValidMetaId(shortLived.user_id) ||
    typeof shortLived.permissions !== "string"
  ) {
    throw new MetaApiError("meta_token_exchange_invalid");
  }

  const grantedScopes = shortLived.permissions
    .split(",")
    .map((permission) => permission.trim())
    .filter(Boolean);
  if (
    !META_REQUIRED_PERMISSIONS.every((permission) =>
      grantedScopes.includes(permission)
    )
  ) {
    throw new MetaApiError("meta_permissions_missing");
  }

  const token = await exchangeForLongLivedToken(
    config,
    shortLived.access_token
  );
  const account = await getInstagramAccountIdentity(config, token.accessToken);

  return {
    ...token,
    account,
    scopes: grantedScopes,
  };
}

export async function refreshInstagramLongLivedToken(
  config: MetaConfig,
  accessToken: string,
  expectedInstagramUserId: string
): Promise<{ accessToken: string; expiresAt: string }> {
  if (!isValidMetaId(expectedInstagramUserId)) {
    throw new MetaApiError("meta_identity_invalid");
  }

  const currentIdentity = await getInstagramAccountIdentity(config, accessToken);
  if (currentIdentity.id !== expectedInstagramUserId) {
    throw new MetaApiError("meta_identity_mismatch");
  }

  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);

  const payload = await requestJson(
    url,
    { method: "GET" },
    "meta_token_refresh_failed"
  );
  const refreshed = asRecord(payload);
  if (typeof refreshed?.access_token !== "string" || !refreshed.access_token) {
    throw new MetaApiError("meta_token_refresh_failed");
  }

  const result = {
    accessToken: refreshed.access_token,
    expiresAt: tokenExpiry(refreshed.expires_in),
  };
  const refreshedIdentity = await getInstagramAccountIdentity(
    config,
    result.accessToken
  );
  if (refreshedIdentity.id !== expectedInstagramUserId) {
    throw new MetaApiError("meta_identity_mismatch");
  }
  return result;
}
