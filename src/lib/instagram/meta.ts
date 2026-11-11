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

export type MetaInstagramProfile = {
  id: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
};

export type MetaInstagramMedia = {
  id: string;
  caption: string | null;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  mediaUrl: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string;
};

export type MetaInstagramMediaPage = {
  media: MetaInstagramMedia[];
  nextCursor: string | null;
};

export type MetaInstagramComment = {
  id: string;
  text: string;
  timestamp: string;
  username: string | null;
  hidden: boolean | null;
};

export type MetaInstagramCommentPage = {
  comments: MetaInstagramComment[];
  nextCursor: string | null;
};

export type MetaInstagramCommentReplyTarget = {
  id: string;
  mediaId: string;
  hidden: boolean;
  parentId: string | null;
};

export function isInstagramCommentReplyableOnMedia(
  comment: MetaInstagramCommentReplyTarget,
  mediaId: string
): boolean {
  return comment.mediaId === mediaId && !comment.hidden && comment.parentId === null;
}

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
  const requestParams = new URLSearchParams({
    access_token: accessToken,
    appsecret_proof: appSecretProof(accessToken, config.appSecret),
    ...params,
  });
  const requestOptions: RequestInit = {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  };
  if (method === "GET") {
    requestParams.forEach((value, key) => url.searchParams.set(key, value));
  } else {
    requestOptions.headers = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    requestOptions.body = requestParams.toString();
  }

  let response: Response;
  try {
    response = await fetch(url, requestOptions);
  } catch {
    throw new MetaApiError(
      method === "POST" ? "meta_post_outcome_unknown" : "meta_unavailable"
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MetaApiError(
      method === "POST" ? "meta_post_outcome_unknown" : "meta_invalid_response"
    );
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

export async function getInstagramProfile(
  config: MetaConfig,
  accessToken: string,
  instagramUserId: string
): Promise<MetaInstagramProfile> {
  if (!isValidMetaId(instagramUserId)) {
    throw new MetaApiError("meta_identity_invalid");
  }

  const payload = asRecord(
    await requestJson(config, instagramUserId, accessToken, {
      params: { fields: "id,username,name,profile_picture_url" },
    })
  );
  if (
    !payload ||
    payload.id !== instagramUserId ||
    typeof payload.username !== "string" ||
    payload.username.trim().length === 0
  ) {
    throw new MetaApiError("meta_profile_invalid_response");
  }

  return {
    id: instagramUserId,
    username: payload.username,
    name: typeof payload.name === "string" ? payload.name : null,
    profilePictureUrl:
      typeof payload.profile_picture_url === "string"
        ? payload.profile_picture_url
        : null,
  };
}

const INSTAGRAM_MEDIA_PAGE_SIZE = 12;

export async function getInstagramMedia(
  config: MetaConfig,
  accessToken: string,
  instagramUserId: string,
  after?: string
): Promise<MetaInstagramMediaPage> {
  if (!isValidMetaId(instagramUserId)) {
    throw new MetaApiError("meta_identity_invalid");
  }
  if (
    after !== undefined &&
    (after.length === 0 || after.length > 512 || /[\u0000-\u001f]/.test(after))
  ) {
    throw new MetaApiError("meta_pagination_invalid");
  }

  const payload = asRecord(
    await requestJson(config, `${instagramUserId}/media`, accessToken, {
      params: {
        fields:
          "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp",
        limit: String(INSTAGRAM_MEDIA_PAGE_SIZE),
        ...(after ? { after } : {}),
      },
    })
  );
  if (!payload || !Array.isArray(payload.data)) {
    throw new MetaApiError("meta_media_invalid_response");
  }

  const media: MetaInstagramMedia[] = [];
  for (const value of payload.data) {
    const item = asRecord(value);
    if (
      !item ||
      !isValidMetaId(item.id) ||
      (item.media_type !== "IMAGE" &&
        item.media_type !== "VIDEO" &&
        item.media_type !== "CAROUSEL_ALBUM") ||
      typeof item.timestamp !== "string"
    ) {
      throw new MetaApiError("meta_media_invalid_response");
    }

    media.push({
      id: item.id,
      caption: typeof item.caption === "string" ? item.caption : null,
      mediaType: item.media_type,
      mediaUrl: typeof item.media_url === "string" ? item.media_url : null,
      permalink: typeof item.permalink === "string" ? item.permalink : null,
      thumbnailUrl:
        typeof item.thumbnail_url === "string" ? item.thumbnail_url : null,
      timestamp: item.timestamp,
    });
  }

  const paging = asRecord(payload.paging);
  const cursors = asRecord(paging?.cursors);
  const hasNextPage = typeof paging?.next === "string" && paging.next !== "";
  const nextCursor = hasNextPage ? cursors?.after : null;
  if (
    hasNextPage &&
    (typeof nextCursor !== "string" ||
      nextCursor.length === 0 ||
      nextCursor.length > 512)
  ) {
    throw new MetaApiError("meta_pagination_invalid");
  }

  return {
    media,
    nextCursor: typeof nextCursor === "string" ? nextCursor : null,
  };
}

export async function verifyInstagramMediaOwnership(
  config: MetaConfig,
  accessToken: string,
  instagramUserId: string,
  mediaId: string
): Promise<void> {
  if (!isValidMetaId(instagramUserId) || !isValidMetaId(mediaId)) {
    throw new MetaApiError("meta_identity_invalid");
  }

  const media = asRecord(
    await requestJson(config, mediaId, accessToken, {
      params: { fields: "id,owner" },
    })
  );
  const owner = asRecord(media?.owner);
  if (media?.id !== mediaId || owner?.id !== instagramUserId) {
    throw new MetaApiError("meta_media_not_owned");
  }
}

export async function verifyInstagramMedia(
  config: MetaConfig,
  accessToken: string,
  instagramUserId: string,
  mediaId: string
): Promise<MetaInstagramMedia["mediaType"]> {
  if (!isValidMetaId(instagramUserId) || !isValidMetaId(mediaId)) {
    throw new MetaApiError("meta_identity_invalid");
  }

  const media = asRecord(
    await requestJson(config, mediaId, accessToken, {
      params: { fields: "id,owner,media_type" },
    })
  );
  const owner = asRecord(media?.owner);
  if (media?.id !== mediaId || owner?.id !== instagramUserId) {
    throw new MetaApiError("meta_media_not_owned");
  }
  if (
    media.media_type !== "IMAGE" &&
    media.media_type !== "VIDEO" &&
    media.media_type !== "CAROUSEL_ALBUM"
  ) {
    throw new MetaApiError("meta_media_invalid_response");
  }

  return media.media_type;
}

export async function getInstagramComments(
  config: MetaConfig,
  accessToken: string,
  mediaId: string,
  after?: string
): Promise<MetaInstagramCommentPage> {
  if (!isValidMetaId(mediaId)) {
    throw new MetaApiError("meta_identity_invalid");
  }
  if (
    after !== undefined &&
    (after.length === 0 || after.length > 512 || /[\u0000-\u001f]/.test(after))
  ) {
    throw new MetaApiError("meta_pagination_invalid");
  }

  const payload = asRecord(
    await requestJson(config, `${mediaId}/comments`, accessToken, {
      params: {
        fields: "id,text,timestamp,username,hidden",
        limit: "50",
        ...(after ? { after } : {}),
      },
    })
  );
  if (!payload || !Array.isArray(payload.data)) {
    throw new MetaApiError("meta_comments_invalid_response");
  }

  const comments = payload.data.map((value) => {
    const comment = asRecord(value);
    if (
      !comment ||
      !isValidMetaId(comment.id) ||
      typeof comment.text !== "string" ||
      typeof comment.timestamp !== "string" ||
      !Number.isFinite(Date.parse(comment.timestamp)) ||
      (comment.hidden !== undefined && typeof comment.hidden !== "boolean")
    ) {
      throw new MetaApiError("meta_comments_invalid_response");
    }

    return {
      id: comment.id,
      text: comment.text,
      timestamp: comment.timestamp,
      username: typeof comment.username === "string" ? comment.username : null,
      hidden: typeof comment.hidden === "boolean" ? comment.hidden : null,
    };
  });

  const paging = asRecord(payload.paging);
  const cursors = asRecord(paging?.cursors);
  const hasNextPage = typeof paging?.next === "string" && paging.next !== "";
  const nextCursor = hasNextPage ? cursors?.after : null;
  if (
    hasNextPage &&
    (typeof nextCursor !== "string" ||
      nextCursor.length === 0 ||
      nextCursor.length > 512 ||
      /[\u0000-\u001f]/.test(nextCursor))
  ) {
    throw new MetaApiError("meta_pagination_invalid");
  }

  return {
    comments,
    nextCursor: typeof nextCursor === "string" ? nextCursor : null,
  };
}

export async function getInstagramCommentReplyTarget(
  config: MetaConfig,
  accessToken: string,
  commentId: string
): Promise<MetaInstagramCommentReplyTarget> {
  if (!isValidMetaId(commentId)) {
    throw new MetaApiError("meta_identity_invalid");
  }

  const comment = asRecord(
    await requestJson(config, commentId, accessToken, {
      params: { fields: "id,hidden,media,parent_id" },
    })
  );
  const media = asRecord(comment?.media);
  if (
    comment?.id !== commentId ||
    typeof comment.hidden !== "boolean" ||
    !isValidMetaId(media?.id) ||
    (comment.parent_id !== undefined &&
      comment.parent_id !== null &&
      !isValidMetaId(comment.parent_id))
  ) {
    throw new MetaApiError("meta_comment_invalid_response");
  }

  return {
    id: commentId,
    mediaId: media.id,
    hidden: comment.hidden,
    parentId:
      typeof comment.parent_id === "string" ? comment.parent_id : null,
  };
}

const REPLY_ATTEMPT_TTL_MS = 15 * 60 * 1000;
const MAX_REPLY_ATTEMPTS = 10_000;
const replyAttempts = new Map<string, number>();

export function claimInstagramCommentReplyAttempt(
  accountId: string,
  commentId: string,
  now = Date.now()
): boolean {
  for (const [key, expiresAt] of replyAttempts) {
    if (expiresAt <= now) replyAttempts.delete(key);
  }

  const key = `${accountId}:${commentId}`;
  if (replyAttempts.has(key) || replyAttempts.size >= MAX_REPLY_ATTEMPTS) {
    return false;
  }

  replyAttempts.set(key, now + REPLY_ATTEMPT_TTL_MS);
  return true;
}

export async function replyToInstagramComment(
  config: MetaConfig,
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  const normalizedMessage = message.trim();
  if (
    !isValidMetaId(commentId) ||
    normalizedMessage.length === 0 ||
    [...normalizedMessage].length > 2200
  ) {
    throw new MetaApiError("meta_comment_reply_invalid");
  }

  const payload = asRecord(
    await requestJson(config, `${commentId}/replies`, accessToken, {
      method: "POST",
      params: { message: normalizedMessage },
    })
  );
  if (!payload || !isValidMetaId(payload.id)) {
    throw new MetaApiError("meta_post_outcome_unknown");
  }

  return { id: payload.id };
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
