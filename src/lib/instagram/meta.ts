import "server-only";

import { createHmac } from "node:crypto";
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

export type ExchangedMetaToken = {
  accessToken: string;
  expiresAt: string | null;
  scopes: string[];
  systemUserId: string;
  clientBusinessId: string;
  accounts: MetaInstagramAccount[];
};

type MetaTokenDebugInfo = {
  scopes: string[];
  systemUserId: string;
  expiresAt: string | null;
};

type MetaPermission = {
  permission: string;
  status: string;
};

type GraphRequestOptions = {
  method?: "GET" | "POST";
  params?: Record<string, string>;
};

export type MetaExchangeStage =
  | "code_exchange"
  | "token_validation"
  | "business_identity"
  | "instagram_account_discovery";

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
    throw new Error("META_APP_ID must be the numeric Meta App ID.");
  }

  const configId = requiredEnv("META_CONFIG_ID");
  if (!isValidMetaId(configId)) {
    throw new Error("META_CONFIG_ID must be the numeric Login configuration ID.");
  }

  const redirectUri = requiredEnv("META_REDIRECT_URI");
  const expectedRedirectUri = `${getSiteUrl()}/api/instagram/callback`;
  if (redirectUri !== expectedRedirectUri) {
    throw new Error(
      "META_REDIRECT_URI must exactly match the configured Meta Login callback URL."
    );
  }

  return {
    appId,
    appSecret: requiredEnv("META_APP_SECRET"),
    configId,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

async function requestJson(
  config: MetaConfig,
  path: string,
  accessToken: string,
  { method = "GET", params = {} }: GraphRequestOptions = {}
): Promise<unknown> {
  const url = graphUrl(config, path);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set(
    "appsecret_proof",
    appSecretProof(accessToken, config.appSecret)
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

  if (!response.ok) {
    const root = asRecord(payload);
    const error = asRecord(root?.error);
    if (error?.code === 190) {
      throw new MetaApiError("meta_token_invalid");
    }
    throw new MetaApiError("meta_request_failed");
  }

  return payload;
}

function tokenExpiry(expiresAt: unknown): string | null {
  if (expiresAt === 0) return null;
  if (
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0
  ) {
    throw new MetaApiError("meta_invalid_expiry");
  }
  return new Date(expiresAt * 1000).toISOString();
}

function getMissingPermissions(granted: Iterable<string>): string[] {
  const grantedSet = new Set(granted);
  return META_REQUIRED_PERMISSIONS.filter(
    (permission) => !grantedSet.has(permission)
  );
}

function logPermissionValidationFailure(
  stage: string,
  details: Record<string, unknown>
): void {
  console.warn("[Instagram] Permission validation failed.", {
    stage,
    ...details,
  });
}

function summarizePermissions(permissions: MetaPermission[]) {
  return permissions.slice(0, 100).map(({ permission, status }) => ({
    permission: /^[a-zA-Z0-9_.:-]{1,128}$/.test(permission)
      ? permission
      : "[invalid]",
    status:
      status === "granted" || status === "declined" || status === "expired"
        ? status
        : "[unknown]",
  }));
}

export async function debugMetaAccessToken(
  config: MetaConfig,
  inputToken: string
): Promise<MetaTokenDebugInfo> {
  const url = graphUrl(config, "debug_token");
  url.searchParams.set("input_token", inputToken);
  url.searchParams.set(
    "access_token",
    `${config.appId}|${config.appSecret}`
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MetaApiError("meta_token_debug_unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MetaApiError("meta_invalid_response");
  }

  if (!response.ok) {
    throw new MetaApiError("meta_token_debug_failed");
  }

  const data = asRecord(asRecord(payload)?.data);
  const scopes = data?.scopes;
  if (
    data?.type !== "SYSTEM_USER" ||
    data.is_valid !== true ||
    data.app_id !== config.appId ||
    !isValidMetaId(data.user_id) ||
    !Array.isArray(scopes) ||
    !scopes.every((scope) => typeof scope === "string")
  ) {
    logPermissionValidationFailure("debug_token_metadata", {
      reason: "invalid_token_metadata_or_scopes_shape",
    });
    throw new MetaApiError("meta_system_user_token_invalid");
  }

  const normalizedScopes = scopes as string[];
  const missingPermissions = getMissingPermissions(normalizedScopes);
  if (missingPermissions.length > 0) {
    logPermissionValidationFailure("debug_token_scopes", {
      missingPermissions,
      returnedPermissions: normalizedScopes.slice(0, 100),
      omittedPermissionCount: Math.max(0, normalizedScopes.length - 100),
    });
    throw new MetaApiError("meta_permissions_missing");
  }

  return {
    systemUserId: data.user_id,
    scopes: normalizedScopes,
    expiresAt: tokenExpiry(data.expires_at),
  };
}

type MetaBusinessIdentity = {
  clientBusinessId: string;
};

async function getMetaBusinessIdentity(
  config: MetaConfig,
  accessToken: string,
  systemUserId: string
): Promise<MetaBusinessIdentity> {
  const payload = await requestJson(config, "me", accessToken, {
    params: { fields: "client_business_id" },
  });
  const identity = asRecord(payload);
  if (!identity || !isValidMetaId(identity.client_business_id)) {
    throw new MetaApiError("meta_business_identity_missing");
  }

  let permissionsPayload: unknown;
  try {
    permissionsPayload = await requestJson(
      config,
      `${systemUserId}/permissions`,
      accessToken
    );
  } catch (error) {
    logPermissionValidationFailure("system_user_permissions_request", {
      errorCode:
        error instanceof MetaApiError ? error.code : "unexpected_error",
    });
    throw error;
  }

  const permissionRows = asRecord(permissionsPayload)?.data;
  if (!Array.isArray(permissionRows)) {
    logPermissionValidationFailure("system_user_permissions_response", {
      reason: "data_is_not_an_array",
    });
    throw new MetaApiError("meta_permissions_invalid");
  }

  const permissions: MetaPermission[] = [];
  for (const row of permissionRows) {
    const permission = asRecord(row);
    if (
      typeof permission?.permission !== "string" ||
      typeof permission.status !== "string"
    ) {
      logPermissionValidationFailure("system_user_permissions_response", {
        reason: "invalid_permission_row",
        validPermissionRows: summarizePermissions(permissions),
      });
      throw new MetaApiError("meta_permissions_invalid");
    }
    permissions.push({
      permission: permission.permission,
      status: permission.status,
    });
  }

  const permissionSummary = summarizePermissions(permissions);
  console.info("[Instagram] Meta permission response.", {
    stage: "system_user_permissions",
    permissions: permissionSummary,
    omittedPermissionCount: Math.max(0, permissions.length - 100),
  });

  const granted = permissions
    .filter(({ status }) => status === "granted")
    .map(({ permission }) => permission);
  const missingPermissions = getMissingPermissions(granted);
  if (missingPermissions.length > 0) {
    logPermissionValidationFailure("system_user_permissions", {
      missingPermissions,
      permissions: permissionSummary,
      omittedPermissionCount: Math.max(0, permissions.length - 100),
    });
    throw new MetaApiError("meta_permissions_missing");
  }

  return { clientBusinessId: identity.client_business_id };
}

type AssignedInstagramAccountsResponse = {
  data?: Array<{
    id?: unknown;
    username?: unknown;
    name?: unknown;
    profile_picture_url?: unknown;
  }>;
  paging?: {
    cursors?: { after?: unknown };
    next?: unknown;
  };
};

export async function getAssignedInstagramAccounts(
  config: MetaConfig,
  accessToken: string,
  systemUserId: string
): Promise<MetaInstagramAccount[]> {
  if (!isValidMetaId(systemUserId)) {
    throw new MetaApiError("meta_system_user_identity_invalid");
  }

  const accounts: MetaInstagramAccount[] = [];
  const seenIds = new Set<string>();
  let after: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const params: Record<string, string> = {
      fields: "id,username,name,profile_picture_url",
    };
    if (after) params.after = after;

    const payload = await requestJson(
      config,
      `${systemUserId}/assigned_instagram_accounts`,
      accessToken,
      { params }
    );
    const result = asRecord(payload) as
      | AssignedInstagramAccountsResponse
      | null;
    if (!Array.isArray(result?.data)) {
      throw new MetaApiError("meta_accounts_invalid_response");
    }

    for (const item of result.data) {
      if (
        !isValidMetaId(item.id) ||
        typeof item.username !== "string" ||
        item.username.trim().length === 0 ||
        item.username.length > 255
      ) {
        throw new MetaApiError("meta_account_invalid");
      }
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
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

    if (!result.paging?.next) return accounts;
    const next = result.paging.cursors?.after;
    if (typeof next !== "string" || next === after) {
      throw new MetaApiError("meta_pagination_invalid");
    }
    after = next;
  }

  throw new MetaApiError("meta_account_limit_exceeded");
}

export async function exchangeMetaCode(
  config: MetaConfig,
  code: string,
  onStage?: (stage: MetaExchangeStage) => void
): Promise<ExchangedMetaToken> {
  if (!code || code.length > 2048 || /[\u0000-\u001f]/.test(code)) {
    throw new MetaApiError("oauth_code_invalid");
  }

  onStage?.("code_exchange");
  const url = graphUrl(config, "oauth/access_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("code", code);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
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

  const tokenResponse = asRecord(payload);
  if (
    !response.ok ||
    typeof tokenResponse?.access_token !== "string" ||
    tokenResponse.access_token.length === 0
  ) {
    throw new MetaApiError("meta_token_exchange_failed");
  }

  const accessToken = tokenResponse.access_token;
  onStage?.("token_validation");
  const tokenInfo = await debugMetaAccessToken(config, accessToken);
  onStage?.("business_identity");
  const identity = await getMetaBusinessIdentity(
    config,
    accessToken,
    tokenInfo.systemUserId
  );
  onStage?.("instagram_account_discovery");
  const accounts = await getAssignedInstagramAccounts(
    config,
    accessToken,
    tokenInfo.systemUserId
  );
  if (accounts.length === 0) {
    throw new MetaApiError("meta_accounts_missing");
  }

  return {
    accessToken,
    expiresAt: tokenInfo.expiresAt,
    scopes: tokenInfo.scopes,
    systemUserId: tokenInfo.systemUserId,
    clientBusinessId: identity.clientBusinessId,
    accounts,
  };
}

async function instagramLoginRequest(
  url: URL,
  failureCode: string
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
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
    const error = asRecord(asRecord(payload)?.error);
    if (error?.code === 190) {
      throw new MetaApiError("instagram_token_invalid");
    }
    throw new MetaApiError(failureCode);
  }

  const record = asRecord(payload);
  if (!record) throw new MetaApiError("meta_invalid_response");
  return record;
}

async function getInstagramLoginUserId(
  config: MetaConfig,
  accessToken: string
): Promise<string> {
  const url = new URL(
    `https://graph.instagram.com/${config.apiVersion}/me`
  );
  url.searchParams.set("fields", "user_id");
  url.searchParams.set("access_token", accessToken);
  const identity = await instagramLoginRequest(url, "meta_identity_failed");
  if (!isValidMetaId(identity.user_id)) {
    throw new MetaApiError("meta_identity_invalid");
  }
  return identity.user_id;
}

export async function refreshInstagramLongLivedToken(
  config: MetaConfig,
  accessToken: string,
  expectedInstagramUserId: string
): Promise<{ accessToken: string; expiresAt: string }> {
  if (!isValidMetaId(expectedInstagramUserId)) {
    throw new MetaApiError("meta_identity_invalid");
  }
  if (
    (await getInstagramLoginUserId(config, accessToken)) !==
    expectedInstagramUserId
  ) {
    throw new MetaApiError("meta_identity_mismatch");
  }

  const url = new URL(
    "https://graph.instagram.com/refresh_access_token"
  );
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const refreshed = await instagramLoginRequest(
    url,
    "meta_token_refresh_failed"
  );
  if (
    typeof refreshed.access_token !== "string" ||
    !refreshed.access_token
  ) {
    throw new MetaApiError("meta_token_refresh_failed");
  }
  if (
    (await getInstagramLoginUserId(config, refreshed.access_token)) !==
    expectedInstagramUserId
  ) {
    throw new MetaApiError("meta_identity_mismatch");
  }
  const expiresIn = refreshed.expires_in;
  if (
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new MetaApiError("meta_invalid_expiry");
  }
  return {
    accessToken: refreshed.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}
