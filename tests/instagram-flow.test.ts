import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { decryptToken, encryptToken } from "../src/lib/crypto.ts";
import {
  buildMetaAuthorizationUrl,
  createOAuthState,
  consumeValidOAuthState,
  isTokenExpired,
  isTokenRefreshDue,
  isValidMetaId,
  shouldUseSecureOAuthCookie,
} from "../src/lib/instagram/oauth.ts";
import {
  classifyInstagramCallback,
  deduplicateInstagramAccounts,
  hasAccountOwnershipConflict,
  isOwnedInstagramAccount,
  shouldDeleteBusinessConnection,
} from "../src/lib/instagram/flow.ts";
import {
  exchangeMetaCode,
  getMetaConfig,
  refreshInstagramLongLivedToken,
} from "../src/lib/instagram/meta.ts";

test("OAuth URL uses direct Instagram Login and hides Facebook Login", () => {
  const url = buildMetaAuthorizationUrl(
    {
      appId: "test-app-id",
      redirectUri: "https://engage.example/api/instagram/callback",
    },
    "state-value"
  );
  assert.equal(url.origin, "https://www.instagram.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "test-app-id");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://engage.example/api/instagram/callback"
  );
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(
    url.searchParams.get("scope"),
    "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages,instagram_business_content_publish"
  );
  assert.equal(url.searchParams.get("enable_fb_login"), "false");
});

test("OAuth state is signed, user-bound, and consumed only once", async () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const created = createOAuthState("user-a", "test-app-secret", now);
  const consumed = new Set<string>();
  const consume = async ({ nonceHash }: { nonceHash: string }) => {
    if (consumed.has(nonceHash)) return false;
    consumed.add(nonceHash);
    return true;
  };

  assert.equal(created.record.nonceHash.length, 64);
  assert.equal(created.state.includes(created.record.nonceHash), false);
  assert.equal(
    await consumeValidOAuthState(
      created.state,
      created.state,
      "user-a",
      "test-app-secret",
      consume,
      now
    ),
    true
  );
  assert.equal(
    await consumeValidOAuthState(
      created.state,
      created.state,
      "user-a",
      "test-app-secret",
      consume,
      now
    ),
    false
  );
});

test("OAuth state rejects expired and future-dated payloads even when the cookie remains", async () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const expired = createOAuthState("user-a", "test-app-secret", now);
  const future = createOAuthState(
    "user-a",
    "test-app-secret",
    now + 1
  );
  let consumeCalls = 0;
  const consume = async () => {
    consumeCalls += 1;
    return true;
  };

  assert.equal(
    await consumeValidOAuthState(
      expired.state,
      expired.state,
      "user-a",
      "test-app-secret",
      consume,
      now + 10 * 60 * 1000
    ),
    false
  );
  assert.equal(
    await consumeValidOAuthState(
      future.state,
      future.state,
      "user-a",
      "test-app-secret",
      consume,
      now
    ),
    false
  );
  assert.equal(consumeCalls, 0);
});

test("OAuth state rejects modified signatures, invalid HMACs, and other users", async () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const created = createOAuthState("user-a", "test-app-secret", now);
  let consumeCalls = 0;
  const consume = async () => {
    consumeCalls += 1;
    return true;
  };
  const [encodedPayload, signature] = created.state.split(".");
  const modifiedSignature = `${encodedPayload}.${signature.slice(0, -1)}${
    signature.endsWith("A") ? "B" : "A"
  }`;

  for (const [state, userId, secret] of [
    [modifiedSignature, "user-a", "test-app-secret"],
    [created.state, "user-a", "invalid-secret"],
    [created.state, "user-b", "test-app-secret"],
  ]) {
    assert.equal(
      await consumeValidOAuthState(
        state,
        state,
        userId,
        secret,
        consume,
        now
      ),
      false
    );
  }
  assert.equal(consumeCalls, 0);
});

test("OAuth state rejects malformed signed payloads and lifetimes over ten minutes", async () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const signPayload = (payload: unknown) => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", "test-app-secret")
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  };
  const malformed = signPayload(null);
  const tooLong = signPayload({
    version: 1,
    nonce: "a".repeat(43),
    userId: "user-a",
    issuedAt: now,
    expiresAt: now + 10 * 60 * 1000 + 1,
  });
  const consume = async () => true;

  assert.equal(
    await consumeValidOAuthState(
      malformed,
      malformed,
      "user-a",
      "test-app-secret",
      consume,
      now
    ),
    false
  );
  assert.equal(
    await consumeValidOAuthState(
      tooLong,
      tooLong,
      "user-a",
      "test-app-secret",
      consume,
      now
    ),
    false
  );
});

test("OAuth state rejects a missing cookie and a nonce unknown to the server", async () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const created = createOAuthState("user-a", "test-app-secret", now);
  let consumeCalls = 0;
  const consume = async () => {
    consumeCalls += 1;
    return false;
  };

  assert.equal(
    await consumeValidOAuthState(
      created.state,
      undefined,
      "user-a",
      "test-app-secret",
      consume,
      now
    ),
    false
  );
  assert.equal(
    await consumeValidOAuthState(
      created.state,
      created.state,
      "user-a",
      "test-app-secret",
      consume,
      now
    ),
    false
  );
  assert.equal(consumeCalls, 1);
});

test("concurrent OAuth state consumption attempts allow exactly one winner", async () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const created = createOAuthState("user-a", "test-app-secret", now);
  let consumed = false;
  const consume = async () => {
    if (consumed) return false;
    consumed = true;
    return true;
  };
  const attempts = await Promise.all([
    consumeValidOAuthState(
      created.state,
      created.state,
      "user-a",
      "test-app-secret",
      consume,
      now
    ),
    consumeValidOAuthState(
      created.state,
      created.state,
      "user-a",
      "test-app-secret",
      consume,
      now
    ),
  ]);
  assert.deepEqual(attempts.sort(), [false, true]);
});

test("invalid callback state never reaches the token-exchange stage", async () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const created = createOAuthState("user-a", "test-app-secret", now);
  let exchangeRequests = 0;
  const stateConsumed = await consumeValidOAuthState(
    `${created.state}modified`,
    created.state,
    "user-a",
    "test-app-secret",
    async () => true,
    now
  );
  const callback = classifyInstagramCallback(stateConsumed, null, "auth-code");
  if (callback.kind === "continue") {
    exchangeRequests += 1;
  }

  assert.equal(callback.kind, "invalid_state");
  assert.equal(exchangeRequests, 0);
});

test("OAuth cookie security follows the configured origin scheme", () => {
  assert.equal(shouldUseSecureOAuthCookie("https://engage.example"), true);
  assert.equal(shouldUseSecureOAuthCookie("http://localhost:3000"), false);
});

test("callback rejects invalid state, cancellation, provider errors, and missing codes", () => {
  assert.deepEqual(classifyInstagramCallback(false, null, "code"), {
    kind: "invalid_state",
    status: "invalid_state",
  });
  assert.deepEqual(classifyInstagramCallback(true, "access_denied", null), {
    kind: "provider_error",
    status: "oauth_cancelled",
  });
  assert.deepEqual(classifyInstagramCallback(true, "server_error", null), {
    kind: "provider_error",
    status: "oauth_failed",
  });
  assert.deepEqual(classifyInstagramCallback(true, null, null), {
    kind: "missing_code",
    status: "oauth_failed",
  });
  assert.deepEqual(classifyInstagramCallback(true, null, "code"), {
    kind: "continue",
    code: "code",
  });
});

test("account ownership rejects cross-tenant conflicts and duplicate account results", () => {
  const accounts = deduplicateInstagramAccounts([
    { id: "100", username: "one" },
    { id: "100", username: "one" },
    { id: "200", username: "two" },
  ]);
  assert.equal(accounts.length, 2);
  assert.equal(hasAccountOwnershipConflict([{ owner_id: "user-b" }], "user-a"), true);
  assert.equal(hasAccountOwnershipConflict([{ owner_id: "user-a" }], "user-a"), false);
  assert.equal(isOwnedInstagramAccount({ owner_id: "user-a" }, "user-a"), true);
  assert.equal(isOwnedInstagramAccount({ owner_id: "user-b" }, "user-a"), false);
  assert.equal(isOwnedInstagramAccount(null, "user-a"), false);
});

test("shared business connection is deleted only after its last account is removed", () => {
  assert.equal(shouldDeleteBusinessConnection(0), true);
  assert.equal(shouldDeleteBusinessConnection(1), false);
  assert.equal(shouldDeleteBusinessConnection(-1), false);
});

test("token refresh is offered only for a valid expiry within seven days", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(
    isTokenRefreshDue("2026-01-06T00:00:00.000Z", undefined, now),
    true
  );
  assert.equal(
    isTokenRefreshDue("2026-01-10T00:00:00.000Z", undefined, now),
    false
  );
  assert.equal(
    isTokenRefreshDue("2025-12-31T23:59:59.000Z", undefined, now),
    false
  );
  assert.equal(isTokenRefreshDue("invalid", undefined, now), false);
  assert.equal(isTokenRefreshDue(null, undefined, now), false);
  assert.equal(
    isTokenRefreshDue(
      "2026-01-06T00:00:00.000Z",
      new Date(now - 12 * 60 * 60 * 1000).toISOString(),
      now
    ),
    false
  );
  assert.equal(
    isTokenRefreshDue(
      "2026-01-06T00:00:00.000Z",
      new Date(now - 25 * 60 * 60 * 1000).toISOString(),
      now
    ),
    true
  );
  assert.equal(isTokenExpired("2025-12-31T23:59:59.000Z", now), true);
  assert.equal(isTokenExpired("2026-01-02T00:00:00.000Z", now), false);
  assert.equal(isTokenExpired(null, now), false);
});

test("Meta account and business IDs must be decimal IDs", () => {
  assert.equal(isValidMetaId("123456"), true);
  assert.equal(isValidMetaId(""), false);
  assert.equal(isValidMetaId("123abc"), false);
  assert.equal(isValidMetaId(123456), false);
});

test("access tokens are encrypted and tampering is rejected", () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  try {
    const token = "temporary-test-access-token";
    const encrypted = encryptToken(token);
    assert.equal(encrypted.includes(token), false);
    assert.equal(decryptToken(encrypted), token);
    const replacement = encrypted.endsWith("0") ? "1" : "0";
    const tampered = `${encrypted.slice(0, -1)}${replacement}`;
    assert.throws(() => decryptToken(tampered));
  } finally {
    if (previousKey === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = previousKey;
    }
  }
});

test("long-lived token refresh validates the account before and after refreshing", async () => {
  const names = [
    "NEXT_PUBLIC_SITE_URL",
    "META_APP_ID",
    "META_APP_SECRET",
    "META_REDIRECT_URI",
    "META_API_VERSION",
  ] as const;
  const originalValues = new Map(
    names.map((name) => [name, process.env[name]])
  );
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  const startedAt = Date.now();
  process.env.NEXT_PUBLIC_SITE_URL = "https://engage.example";
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_REDIRECT_URI =
    "https://engage.example/api/instagram/callback";
  process.env.META_API_VERSION = "v27.0";

  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    requests.push(url);
    if (url.pathname.endsWith("/me")) {
      return Response.json({
        user_id: "17841400000000001",
        username: "connected_creator",
      });
    }
    if (url.pathname === "/refresh_access_token") {
      return Response.json({
        access_token: "refreshed-token",
        expires_in: 5_183_944,
      });
    }
    throw new Error(`Unexpected Instagram API request: ${url.pathname}`);
  };

  try {
    const token = await refreshInstagramLongLivedToken(
      getMetaConfig(),
      "current-token",
      "17841400000000001"
    );
    assert.equal(token.accessToken, "refreshed-token");
    assert.ok(
      Date.parse(token.expiresAt) >= startedAt + 5_183_944 * 1000
    );
    assert.equal(requests.length, 3);
    assert.equal(requests[0].origin, "https://graph.instagram.com");
    assert.equal(requests[1].pathname, "/refresh_access_token");
    assert.equal(
      requests[1].searchParams.get("grant_type"),
      "ig_refresh_token"
    );
    assert.equal(
      requests[1].searchParams.get("access_token"),
      "current-token"
    );
    assert.equal(
      requests[2].searchParams.get("access_token"),
      "refreshed-token"
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      const value = originalValues.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("code exchange validates permissions, upgrades the token, and resolves the authorized account", async () => {
  const names = [
    "NEXT_PUBLIC_SITE_URL",
    "META_APP_ID",
    "META_APP_SECRET",
    "META_REDIRECT_URI",
    "META_API_VERSION",
  ] as const;
  const originalValues = new Map(
    names.map((name) => [name, process.env[name]])
  );
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; method: string; body: BodyInit | null }> =
    [];
  const startedAt = Date.now();
  const permissions =
    "instagram_business_basic,instagram_business_manage_comments," +
    "instagram_business_manage_messages,instagram_business_content_publish";

  process.env.NEXT_PUBLIC_SITE_URL = "https://engage.example";
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_REDIRECT_URI =
    "https://engage.example/api/instagram/callback";
  process.env.META_API_VERSION = "v27.0";
  globalThis.fetch = async (input, init) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = init?.body ?? null;
    requests.push({ url, method, body });

    if (url.origin === "https://api.instagram.com") {
      return Response.json({
        data: [
          {
            access_token: "short-lived-token",
            user_id: "17841400000000002",
            permissions,
          },
        ],
      });
    }
    if (url.pathname === "/access_token") {
      return Response.json({
        access_token: "long-lived-token",
        token_type: "bearer",
        expires_in: 5_183_944,
      });
    }
    if (url.pathname === "/v27.0/me") {
      return Response.json({
        user_id: "17841400000000001",
        username: "connected_creator",
        name: "Creator",
        profile_picture_url: "https://example.test/profile.jpg",
        account_type: "MEDIA_CREATOR",
      });
    }
    throw new Error(`Unexpected Instagram API request: ${url.origin}${url.pathname}`);
  };

  try {
    const config = getMetaConfig();
    const token = await exchangeMetaCode(config, "one-time-code");
    assert.equal(token.accessToken, "long-lived-token");
    assert.equal(token.account.id, "17841400000000001");
    assert.equal(token.account.username, "connected_creator");
    assert.equal(token.account.accountType, "CREATOR");
    assert.deepEqual(token.scopes, permissions.split(","));
    const expiry = Date.parse(token.expiresAt);
    assert.ok(expiry >= startedAt + 5_183_944 * 1000);
    assert.ok(expiry <= Date.now() + 5_183_944 * 1000);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].method, "POST");
    assert.equal(
      requests[0].url.origin,
      "https://api.instagram.com"
    );
    assert.equal(
      requests[0].url.pathname,
      "/oauth/access_token"
    );
    assert.ok(requests[0].body instanceof FormData);
    const codeExchangeBody = requests[0].body as FormData;
    assert.equal(codeExchangeBody.get("code"), "one-time-code");
    assert.equal(codeExchangeBody.get("grant_type"), "authorization_code");
    assert.equal(
      codeExchangeBody.get("redirect_uri"),
      "https://engage.example/api/instagram/callback"
    );
    assert.equal(
      requests[1].url.origin,
      "https://graph.instagram.com"
    );
    assert.equal(requests[1].url.pathname, "/access_token");
    assert.equal(
      requests[1].url.searchParams.get("grant_type"),
      "ig_exchange_token"
    );
    assert.equal(
      requests[1].url.searchParams.get("access_token"),
      "short-lived-token"
    );
    assert.equal(
      requests[2].url.origin,
      "https://graph.instagram.com"
    );
    assert.equal(
      requests[2].url.searchParams.get("access_token"),
      "long-lived-token"
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      const value = originalValues.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
