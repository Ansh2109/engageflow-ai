import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

export const META_REQUIRED_PERMISSIONS = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
  "instagram_business_content_publish",
] as const;

export type MetaOAuthConfig = {
  appId: string;
  redirectUri: string;
};

type OAuthStatePayload = {
  version: 1;
  nonce: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

export type OAuthStateRecord = {
  nonceHash: string;
  userId: string;
  issuedAt: string;
  expiresAt: string;
};

function isOAuthStatePayload(value: unknown): value is OAuthStatePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    payload.version === 1 &&
    typeof payload.nonce === "string" &&
    typeof payload.userId === "string" &&
    Number.isSafeInteger(payload.issuedAt) &&
    Number.isSafeInteger(payload.expiresAt)
  );
}

export function createOAuthState(
  userId: string,
  appSecret: string,
  now = Date.now()
): { state: string; record: OAuthStateRecord } {
  if (!userId || !appSecret || !Number.isSafeInteger(now)) {
    throw new Error("Cannot create OAuth state without valid server context.");
  }

  const nonce = randomBytes(32).toString("base64url");
  const payload: OAuthStatePayload = {
    version: 1,
    nonce,
    userId,
    issuedAt: now,
    expiresAt: now + OAUTH_STATE_MAX_AGE_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest("base64url");

  return {
    state: `${encodedPayload}.${signature}`,
    record: {
      nonceHash: createHash("sha256").update(nonce).digest("hex"),
      userId,
      issuedAt: new Date(payload.issuedAt).toISOString(),
      expiresAt: new Date(payload.expiresAt).toISOString(),
    },
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function parseOAuthState(
  state: string | null,
  userId: string,
  appSecret: string,
  now: number
): { payload: OAuthStatePayload; record: OAuthStateRecord } | null {
  if (!state || !userId || !appSecret || !Number.isSafeInteger(now)) {
    return null;
  }
  const [encodedPayload, signature, ...extra] = state.split(".");
  if (
    !encodedPayload ||
    !signature ||
    extra.length > 0 ||
    !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return null;
  }

  const expectedSignature = createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest();
  const actualSignature = Buffer.from(signature, "base64url");
  if (
    actualSignature.toString("base64url") !== signature ||
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    const decodedPayload = Buffer.from(encodedPayload, "base64url");
    if (decodedPayload.toString("base64url") !== encodedPayload) return null;
    payload = JSON.parse(decodedPayload.toString("utf8")) as unknown;
  } catch {
    return null;
  }

  if (!isOAuthStatePayload(payload)) return null;

  if (
    payload.version !== 1 ||
    typeof payload.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce) ||
    Buffer.from(payload.nonce, "base64url").toString("base64url") !==
      payload.nonce ||
    payload.userId !== userId ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.issuedAt > now ||
    payload.expiresAt <= now ||
    payload.expiresAt <= payload.issuedAt ||
    payload.expiresAt - payload.issuedAt > OAUTH_STATE_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    payload,
    record: {
      nonceHash: createHash("sha256").update(payload.nonce).digest("hex"),
      userId: payload.userId,
      issuedAt: new Date(payload.issuedAt).toISOString(),
      expiresAt: new Date(payload.expiresAt).toISOString(),
    },
  };
}

export async function consumeValidOAuthState(
  receivedState: string | null,
  storedBinding: string | undefined,
  userId: string,
  appSecret: string,
  consume: (record: OAuthStateRecord) => Promise<boolean>,
  now = Date.now()
): Promise<boolean> {
  if (!receivedState || !storedBinding || !safeEqual(receivedState, storedBinding)) {
    return false;
  }
  const parsed = parseOAuthState(receivedState, userId, appSecret, now);
  if (!parsed) return false;
  return consume(parsed.record);
}

export function shouldUseSecureOAuthCookie(siteUrl: string): boolean {
  return new URL(siteUrl).protocol === "https:";
}

export function buildMetaAuthorizationUrl(
  config: MetaOAuthConfig,
  state: string
): URL {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_REQUIRED_PERMISSIONS.join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("enable_fb_login", "false");
  return url;
}

export function isTokenRefreshDue(
  expiresAt: string | null,
  lastRefreshedAt?: string | null,
  now = Date.now()
): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  if (lastRefreshedAt !== undefined) {
    const refreshedAt = lastRefreshedAt ? Date.parse(lastRefreshedAt) : NaN;
    if (
      !Number.isFinite(refreshedAt) ||
      now - refreshedAt < 24 * 60 * 60 * 1000
    ) {
      return false;
    }
  }
  return (
    Number.isFinite(expiry) &&
    expiry > now &&
    expiry - now <= 7 * 24 * 60 * 60 * 1000
  );
}

export function isTokenExpired(
  expiresAt: string | null,
  now = Date.now()
): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

export function isValidMetaId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}
