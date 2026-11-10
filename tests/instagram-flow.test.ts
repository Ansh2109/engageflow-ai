import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
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
  MetaApiError,
  refreshInstagramLongLivedToken,
  refreshSystemUserToken,
} from "../src/lib/instagram/meta.ts";

test("OAuth URL invokes the configured Facebook Login for Business flow", () => {
  const url = buildMetaAuthorizationUrl(
    {
      appId: "test-app-id",
      configId: "test-config-id",
      redirectUri: "https://engage.example/api/instagram/callback",
    },
    "state-value"
  );
  assert.equal(url.origin, "https://www.facebook.com");
  assert.equal(url.pathname, "/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), "test-app-id");
  assert.equal(url.searchParams.get("config_id"), "test-config-id");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://engage.example/api/instagram/callback"
  );
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.has("scope"), false);
  assert.equal(url.searchParams.has("enable_fb_login"), false);
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
    "META_CONFIG_ID",
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
  process.env.META_CONFIG_ID = "9876543210";
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

test("code exchange validates the System User token, scopes, identity, and assigned assets", async () => {
  const names = [
    "NEXT_PUBLIC_SITE_URL",
    "META_APP_ID",
    "META_APP_SECRET",
    "META_CONFIG_ID",
    "META_REDIRECT_URI",
    "META_API_VERSION",
  ] as const;
  const originalValues = new Map(
    names.map((name) => [name, process.env[name]])
  );
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; method: string }> = [];
  const startedAt = Date.now();
  const permissions = [
    "instagram_basic",
    "instagram_manage_comments",
    "instagram_manage_messages",
    "instagram_content_publish",
    "business_management",
  ];

  process.env.NEXT_PUBLIC_SITE_URL = "https://engage.example";
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_CONFIG_ID = "9876543210";
  process.env.META_REDIRECT_URI =
    "https://engage.example/api/instagram/callback";
  process.env.META_API_VERSION = "v27.0";
  globalThis.fetch = async (input, init) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ url, method });

    if (url.pathname === "/v27.0/oauth/access_token") {
      return Response.json({ access_token: "system-user-token" });
    }
    if (url.pathname === "/v27.0/debug_token") {
      return Response.json({
        data: {
          app_id: "1234567890",
          type: "SYSTEM_USER",
          is_valid: true,
          user_id: "10000000001",
          scopes: permissions,
          expires_at: Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
        },
      });
    }
    if (url.pathname === "/v27.0/me") {
      return Response.json({ client_business_id: "20000000002" });
    }
    if (url.pathname === "/v27.0/10000000001/permissions") {
      return Response.json({
        data: permissions.map((permission) => ({
          permission,
          status: "granted",
        })),
      });
    }
    if (url.pathname === "/v27.0/10000000001/assigned_instagram_accounts") {
      return Response.json({
        data: [
          {
            id: "17841400000000002",
            username: "connected_creator",
            name: "Creator",
            profile_picture_url: "https://example.test/profile.jpg",
          },
        ],
      });
    }
    throw new Error(`Unexpected Meta request: ${url.origin}${url.pathname}`);
  };

  try {
    const config = getMetaConfig();
    const token = await exchangeMetaCode(config, "one-time-code");
    assert.equal(token.accessToken, "system-user-token");
    assert.equal(token.systemUserId, "10000000001");
    assert.equal(token.clientBusinessId, "20000000002");
    assert.deepEqual(token.scopes, permissions);
    assert.equal(token.accounts.length, 1);
    assert.deepEqual(token.accounts[0], {
      id: "17841400000000002",
      username: "connected_creator",
      name: "Creator",
      profilePictureUrl: "https://example.test/profile.jpg",
    });
    assert.ok(Date.parse(token.expiresAt ?? "") > startedAt);

    assert.equal(requests.length, 5);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url.origin, "https://graph.facebook.com");
    assert.equal(
      requests[0].url.pathname,
      "/v27.0/oauth/access_token"
    );
    assert.equal(requests[0].url.searchParams.get("client_id"), "1234567890");
    assert.equal(requests[0].url.searchParams.get("code"), "one-time-code");
    assert.equal(
      requests[0].url.searchParams.get("redirect_uri"),
      "https://engage.example/api/instagram/callback"
    );
    assert.equal(requests[1].url.pathname, "/v27.0/debug_token");
    assert.equal(
      requests[1].url.searchParams.get("input_token"),
      "system-user-token"
    );
    assert.equal(requests[2].url.searchParams.get("fields"), "client_business_id");
    assert.equal(
      requests[3].url.pathname,
      "/v27.0/10000000001/permissions"
    );
    assert.equal(
      requests[4].url.pathname,
      "/v27.0/10000000001/assigned_instagram_accounts"
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

test("permission diagnostics distinguish missing token scopes and denied permission rows", async () => {
  const names = [
    "NEXT_PUBLIC_SITE_URL",
    "META_APP_ID",
    "META_APP_SECRET",
    "META_CONFIG_ID",
    "META_REDIRECT_URI",
    "META_API_VERSION",
  ] as const;
  const originalValues = new Map(
    names.map((name) => [name, process.env[name]])
  );
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const diagnostics: Array<{
    level: "warn" | "info";
    message: unknown;
    details: unknown;
  }> = [];
  const permissions = [
    "instagram_basic",
    "instagram_manage_comments",
    "instagram_manage_messages",
    "instagram_content_publish",
    "business_management",
  ];
  let scopes = permissions;
  let permissionsPayload: unknown = {
    data: permissions.map((permission) => ({
      permission,
      status: "granted",
    })),
  };

  process.env.NEXT_PUBLIC_SITE_URL = "https://engage.example";
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_CONFIG_ID = "9876543210";
  process.env.META_REDIRECT_URI =
    "https://engage.example/api/instagram/callback";
  process.env.META_API_VERSION = "v27.0";
  console.warn = (...args: Parameters<typeof console.warn>) => {
    diagnostics.push({ level: "warn", message: args[0], details: args[1] });
  };
  console.info = (...args: Parameters<typeof console.info>) => {
    diagnostics.push({ level: "info", message: args[0], details: args[1] });
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    if (url.pathname === "/v27.0/oauth/access_token") {
      return Response.json({ access_token: "test-system-user-token" });
    }
    if (url.pathname === "/v27.0/debug_token") {
      return Response.json({
        data: {
          app_id: "1234567890",
          type: "SYSTEM_USER",
          is_valid: true,
          user_id: "10000000001",
          scopes,
          expires_at: Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
        },
      });
    }
    if (url.pathname === "/v27.0/me") {
      return Response.json({ client_business_id: "20000000002" });
    }
    if (url.pathname === "/v27.0/10000000001/permissions") {
      return Response.json(permissionsPayload);
    }
    throw new Error(`Unexpected Meta request: ${url.pathname}`);
  };

  try {
    const config = getMetaConfig();
    scopes = permissions.filter(
      (permission) => permission !== "business_management"
    );
    await assert.rejects(
      exchangeMetaCode(config, "test-authorization-code"),
      (error: unknown) =>
        error instanceof MetaApiError &&
        error.code === "meta_permissions_missing"
    );
    assert.ok(
      diagnostics.some(
        ({ level, details }) =>
          level === "warn" &&
          JSON.stringify(details).includes('"stage":"debug_token_scopes"') &&
          JSON.stringify(details).includes("business_management")
      )
    );

    scopes = permissions;
    permissionsPayload = {
      data: permissions.map((permission) => ({
        permission,
        status:
          permission === "instagram_manage_messages" ? "declined" : "granted",
      })),
    };
    await assert.rejects(
      exchangeMetaCode(config, "test-authorization-code"),
      (error: unknown) =>
        error instanceof MetaApiError &&
        error.code === "meta_permissions_missing"
    );
    assert.ok(
      diagnostics.some(
        ({ level, details }) =>
          level === "warn" &&
          JSON.stringify(details).includes(
            '"stage":"system_user_permissions"'
          ) &&
          JSON.stringify(details).includes("instagram_manage_messages")
      )
    );
    assert.ok(
      diagnostics.some(
        ({ level, details }) =>
          level === "info" &&
          JSON.stringify(details).includes('"status":"declined"')
      )
    );

    permissionsPayload = {
      data: [{ permission: "instagram_basic" }],
    };
    await assert.rejects(
      exchangeMetaCode(config, "test-authorization-code"),
      (error: unknown) =>
        error instanceof MetaApiError &&
        error.code === "meta_permissions_invalid"
    );
    assert.ok(
      diagnostics.some(
        ({ level, details }) =>
          level === "warn" &&
          JSON.stringify(details).includes(
            '"stage":"system_user_permissions_response"'
          )
      )
    );

    const serializedDiagnostics = JSON.stringify(diagnostics);
    assert.equal(serializedDiagnostics.includes("test-system-user-token"), false);
    assert.equal(serializedDiagnostics.includes("test-app-secret"), false);
    assert.equal(
      serializedDiagnostics.includes("test-authorization-code"),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.info = originalInfo;
    for (const name of names) {
      const value = originalValues.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("code exchange rejects a User token returned by the System User configuration", async () => {
  const names = [
    "NEXT_PUBLIC_SITE_URL",
    "META_APP_ID",
    "META_APP_SECRET",
    "META_CONFIG_ID",
    "META_REDIRECT_URI",
    "META_API_VERSION",
  ] as const;
  const originalValues = new Map(
    names.map((name) => [name, process.env[name]])
  );
  const originalFetch = globalThis.fetch;
  let graphCalls = 0;
  process.env.NEXT_PUBLIC_SITE_URL = "https://engage.example";
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_CONFIG_ID = "9876543210";
  process.env.META_REDIRECT_URI =
    "https://engage.example/api/instagram/callback";
  process.env.META_API_VERSION = "v27.0";
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    graphCalls += 1;
    if (url.pathname === "/v27.0/oauth/access_token") {
      return Response.json({ access_token: "user-access-token" });
    }
    if (url.pathname === "/v27.0/debug_token") {
      return Response.json({
        data: {
          app_id: "1234567890",
          type: "USER",
          is_valid: true,
          user_id: "10000000001",
          scopes: [],
        },
      });
    }
    throw new Error(`Unexpected Meta request: ${url.pathname}`);
  };

  try {
    await assert.rejects(
      exchangeMetaCode(getMetaConfig(), "one-time-code"),
      { code: "meta_system_user_token_invalid" }
    );
    assert.equal(graphCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      const value = originalValues.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("System User refresh uses the business token endpoint and revalidates the token", async () => {
  const names = [
    "NEXT_PUBLIC_SITE_URL",
    "META_APP_ID",
    "META_APP_SECRET",
    "META_CONFIG_ID",
    "META_REDIRECT_URI",
    "META_API_VERSION",
  ] as const;
  const originalValues = new Map(
    names.map((name) => [name, process.env[name]])
  );
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; method: string }> = [];
  const permissions = [
    "instagram_basic",
    "instagram_manage_comments",
    "instagram_manage_messages",
    "instagram_content_publish",
    "business_management",
  ];
  process.env.NEXT_PUBLIC_SITE_URL = "https://engage.example";
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_CONFIG_ID = "9876543210";
  process.env.META_REDIRECT_URI =
    "https://engage.example/api/instagram/callback";
  process.env.META_API_VERSION = "v27.0";
  globalThis.fetch = async (input, init) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ url, method });
    if (url.pathname === "/v27.0/debug_token") {
      const inputToken = url.searchParams.get("input_token");
      return Response.json({
        data: {
          app_id: "1234567890",
          type: "SYSTEM_USER",
          is_valid: true,
          user_id: "10000000001",
          scopes: permissions,
          expires_at:
            Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
          inputToken,
        },
      });
    }
    if (url.pathname === "/v27.0/me") {
      return Response.json({ client_business_id: "20000000002" });
    }
    if (url.pathname === "/v27.0/10000000001/permissions") {
      return Response.json({
        data: permissions.map((permission) => ({
          permission,
          status: "granted",
        })),
      });
    }
    if (
      url.pathname ===
      "/v27.0/10000000001/assigned_instagram_accounts"
    ) {
      return Response.json({
        data: [
          {
            id: "17841400000000002",
            username: "connected_creator",
          },
        ],
      });
    }
    if (
      url.pathname ===
      "/v27.0/20000000002/system_user_access_tokens" &&
      method === "POST"
    ) {
      return Response.json({ access_token: "refreshed-system-user-token" });
    }
    throw new Error(`Unexpected Meta request: ${url.pathname}`);
  };

  try {
    const refreshed = await refreshSystemUserToken(
      getMetaConfig(),
      "current-system-user-token",
      "20000000002",
      "10000000001",
      ["17841400000000002"]
    );
    assert.equal(refreshed.accessToken, "refreshed-system-user-token");
    assert.ok(Date.parse(refreshed.expiresAt ?? "") > Date.now());

    const refreshRequest = requests.find(
      ({ url }) =>
        url.pathname === "/v27.0/20000000002/system_user_access_tokens"
    );
    assert.ok(refreshRequest);
    assert.equal(refreshRequest.method, "POST");
    assert.equal(
      refreshRequest.url.searchParams.get("system_user_id"),
      "10000000001"
    );
    assert.equal(
      refreshRequest.url.searchParams.get("asset"),
      "17841400000000002"
    );
    assert.equal(
      refreshRequest.url.searchParams.get("set_token_expires_in_60_days"),
      "true"
    );
    assert.equal(
      refreshRequest.url.searchParams.get("appsecret_proof")?.length,
      64
    );
    assert.equal(requests.length, 9);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      const value = originalValues.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Unified Login persistence migration keeps legacy tables and owner-checks account upserts", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261110000005_instagram_unified_login.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(migration, /CREATE TABLE public\.instagram_unified_login_connections/);
  assert.match(migration, /ADD COLUMN unified_connection_id UUID/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.persist_instagram_unified_login_connection/
  );
  assert.match(
    migration,
    /WHERE existing\.owner_id = EXCLUDED\.owner_id/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.persist_instagram_unified_login_connection/
  );
  assert.doesNotMatch(
    migration,
    /DROP TABLE|DELETE FROM public\.instagram_business_connections|DELETE FROM public\.instagram_unified_login_connections/i
  );
});
