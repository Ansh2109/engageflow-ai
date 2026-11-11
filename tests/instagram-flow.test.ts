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
  claimInstagramCommentReplyAttempt,
  exchangeMetaCode,
  getInstagramCommentReplyTarget,
  getInstagramComments,
  getInstagramMedia,
  getInstagramProfile,
  isInstagramCommentReplyableOnMedia,
  getMetaConfig,
  MetaApiError,
  replyToInstagramComment,
  refreshInstagramLongLivedToken,
  verifyInstagramMediaOwnership,
} from "../src/lib/instagram/meta.ts";
import {
  logInstagramPersistenceError,
  sanitizeDatabaseErrorMessage,
} from "../src/lib/instagram/diagnostics.ts";
import {
  deduplicateInstagramMedia,
  isValidInstagramTimestamp,
} from "../src/app/(dashboard)/instagram/instagram-account-data-utils.ts";

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
  const stages: string[] = [];
  const startedAt = Date.now();
  const permissions = [
    "instagram_basic",
    "instagram_manage_comments",
    "instagram_manage_messages",
    "instagram_content_publish",
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
    const token = await exchangeMetaCode(
      config,
      "one-time-code",
      (stage) => stages.push(stage)
    );
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
    assert.deepEqual(stages, [
      "code_exchange",
      "token_validation",
      "business_identity",
      "instagram_account_discovery",
    ]);

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

test("Instagram profile reads the requested account through the configured Graph API", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    requests.push(url);
    return Response.json({
      id: "17841400000000002",
      username: "connected_creator",
      name: "Creator",
      profile_picture_url: "https://cdn.example/profile.jpg",
    });
  };

  try {
    const profile = await getInstagramProfile(
      {
        appId: "1234567890",
        appSecret: "test-app-secret",
        configId: "9876543210",
        apiVersion: "v27.0",
        redirectUri: "https://engage.example/api/instagram/callback",
      },
      "server-only-system-user-token",
      "17841400000000002"
    );

    assert.deepEqual(profile, {
      id: "17841400000000002",
      username: "connected_creator",
      name: "Creator",
      profilePictureUrl: "https://cdn.example/profile.jpg",
    });
    assert.equal(requests[0].origin, "https://graph.facebook.com");
    assert.equal(
      requests[0].pathname,
      "/v27.0/17841400000000002"
    );
    assert.equal(
      requests[0].searchParams.get("fields"),
      "id,username,name,profile_picture_url"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram media supports empty results, Reels, and cursor pagination", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    requests.push(url);
    if (!url.searchParams.has("after")) {
      return Response.json({
        data: [
          {
            id: "18000000000000001",
            caption: "Recent Reel",
            media_type: "VIDEO",
            media_url: null,
            thumbnail_url: "https://cdn.example/reel-cover.jpg",
            permalink: "https://www.instagram.com/reel/example/",
            timestamp: "2026-11-10T12:00:00+0000",
          },
        ],
        paging: {
          cursors: { after: "opaque-next-cursor" },
          next: "https://graph.facebook.com/v27.0/17841400000000002/media?after=opaque-next-cursor",
        },
      });
    }
    return Response.json({ data: [], paging: {} });
  };

  try {
    const firstPage = await getInstagramMedia(
      {
        appId: "1234567890",
        appSecret: "test-app-secret",
        configId: "9876543210",
        apiVersion: "v27.0",
        redirectUri: "https://engage.example/api/instagram/callback",
      },
      "server-only-system-user-token",
      "17841400000000002"
    );
    assert.equal(firstPage.nextCursor, "opaque-next-cursor");
    assert.deepEqual(firstPage.media[0], {
      id: "18000000000000001",
      caption: "Recent Reel",
      mediaType: "VIDEO",
      mediaUrl: null,
      permalink: "https://www.instagram.com/reel/example/",
      thumbnailUrl: "https://cdn.example/reel-cover.jpg",
      timestamp: "2026-11-10T12:00:00+0000",
    });

    const nextPage = await getInstagramMedia(
      {
        appId: "1234567890",
        appSecret: "test-app-secret",
        configId: "9876543210",
        apiVersion: "v27.0",
        redirectUri: "https://engage.example/api/instagram/callback",
      },
      "server-only-system-user-token",
      "17841400000000002",
      firstPage.nextCursor ?? undefined
    );
    assert.deepEqual(nextPage, { media: [], nextCursor: null });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].pathname, "/v27.0/17841400000000002/media");
    assert.equal(requests[0].searchParams.get("limit"), "12");
    assert.equal(
      requests[0].searchParams.get("fields"),
      "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp"
    );
    assert.equal(
      requests[1].searchParams.get("after"),
      "opaque-next-cursor"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram media rejects malformed pagination cursors", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({ data: [] });
  };

  try {
    await assert.rejects(
      getInstagramMedia(
        {
          appId: "1234567890",
          appSecret: "test-app-secret",
          configId: "9876543210",
          apiVersion: "v27.0",
          redirectUri: "https://engage.example/api/instagram/callback",
        },
        "server-only-system-user-token",
        "17841400000000002",
        "x".repeat(513)
      ),
      { code: "meta_pagination_invalid" }
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram comments are read from owned media with safe fields and bounded results", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    requests.push(url);
    if (url.searchParams.has("after")) {
      return Response.json({
        data: [
          {
            id: "17900000000000002",
            text: "Second page",
            timestamp: "2026-11-10T12:01:00+0000",
            hidden: false,
          },
        ],
        paging: {},
      });
    }
    if (url.pathname === "/v27.0/18000000000000001") {
      return Response.json({
        id: "18000000000000001",
        owner: { id: "17841400000000002" },
      });
    }
    return Response.json({
      data: [
        {
          id: "17900000000000001",
          text: "Test comment",
          timestamp: "2026-11-10T12:00:00+0000",
          username: "test_user",
          hidden: false,
        },
      ],
      paging: {
        cursors: { after: "comments-next-cursor" },
        next: "https://graph.facebook.com/v27.0/18000000000000001/comments?after=comments-next-cursor",
      },
    });
  };

  try {
    const config = {
      appId: "1234567890",
      appSecret: "test-app-secret",
      configId: "9876543210",
      apiVersion: "v27.0",
      redirectUri: "https://engage.example/api/instagram/callback",
    };
    await verifyInstagramMediaOwnership(
      config,
      "server-only-system-user-token",
      "17841400000000002",
      "18000000000000001"
    );
    const firstPage = await getInstagramComments(
      config,
      "server-only-system-user-token",
      "18000000000000001"
    );
    assert.deepEqual(firstPage, {
      comments: [
        {
          id: "17900000000000001",
          text: "Test comment",
          timestamp: "2026-11-10T12:00:00+0000",
          username: "test_user",
          hidden: false,
        },
      ],
      nextCursor: "comments-next-cursor",
    });
    const secondPage = await getInstagramComments(
      config,
      "server-only-system-user-token",
      "18000000000000001",
      firstPage.nextCursor ?? undefined
    );
    assert.deepEqual(secondPage.comments, [
      {
        id: "17900000000000002",
        text: "Second page",
        timestamp: "2026-11-10T12:01:00+0000",
        username: null,
        hidden: false,
      },
    ]);
    assert.equal(requests[0].searchParams.get("fields"), "id,owner");
    assert.equal(
      requests[1].pathname,
      "/v27.0/18000000000000001/comments"
    );
    assert.equal(requests[1].searchParams.get("limit"), "50");
    assert.equal(
      requests[1].searchParams.get("fields"),
      "id,text,timestamp,username,hidden"
    );
    assert.equal(requests[2].searchParams.get("after"), "comments-next-cursor");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram comment reply target validates media, visibility, and top-level status", async () => {
  const originalFetch = globalThis.fetch;
  const payloads: unknown[] = [
    {
      id: "17900000000000001",
      hidden: false,
      media: { id: "18000000000000001" },
    },
    {
      id: "17900000000000002",
      hidden: true,
      media: { id: "18000000000000001" },
    },
    {
      id: "17900000000000003",
      hidden: false,
      media: { id: "18000000000000002" },
      parent_id: "17900000000000001",
    },
  ];
  globalThis.fetch = async () => Response.json(payloads.shift());

  try {
    const config = {
      appId: "1234567890",
      appSecret: "test-app-secret",
      configId: "9876543210",
      apiVersion: "v27.0",
      redirectUri: "https://engage.example/api/instagram/callback",
    };
    assert.deepEqual(
      await getInstagramCommentReplyTarget(
        config,
        "server-only-system-user-token",
        "17900000000000001"
      ),
      {
        id: "17900000000000001",
        mediaId: "18000000000000001",
        hidden: false,
        parentId: null,
      }
    );
    assert.equal(
      (await getInstagramCommentReplyTarget(
        config,
        "server-only-system-user-token",
        "17900000000000002"
      )).hidden,
      true
    );
    const reply = await getInstagramCommentReplyTarget(
      config,
      "server-only-system-user-token",
      "17900000000000003"
    );
    assert.equal(reply.parentId, "17900000000000001");
    assert.equal(reply.mediaId, "18000000000000002");
    assert.equal(isInstagramCommentReplyableOnMedia(reply, "18000000000000002"), false);
    assert.equal(
      isInstagramCommentReplyableOnMedia(
        {
          id: "17900000000000004",
          mediaId: "18000000000000001",
          hidden: true,
          parentId: null,
        },
        "18000000000000001"
      ),
      false
    );
    assert.equal(
      isInstagramCommentReplyableOnMedia(
        {
          id: "17900000000000005",
          mediaId: "18000000000000001",
          hidden: false,
          parentId: null,
        },
        "18000000000000001"
      ),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram comment replies send credentials in the POST body and sanitize API errors", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input.toString());
    requests.push({ url, init });
    return Response.json({ id: "17900000000000002" });
  };

  try {
    const reply = await replyToInstagramComment(
      {
        appId: "1234567890",
        appSecret: "test-app-secret",
        configId: "9876543210",
        apiVersion: "v27.0",
        redirectUri: "https://engage.example/api/instagram/callback",
      },
      "server-only-system-user-token",
      "17900000000000001",
      " Thanks for your comment! "
    );
    assert.deepEqual(reply, { id: "17900000000000002" });
    assert.equal(requests[0].url.pathname, "/v27.0/17900000000000001/replies");
    assert.equal(requests[0].url.search, "");
    assert.equal(requests[0].init.method, "POST");
    const form = new URLSearchParams(String(requests[0].init.body));
    assert.equal(form.get("message"), "Thanks for your comment!");
    assert.equal(form.get("access_token"), "server-only-system-user-token");
    assert.ok(form.get("appsecret_proof"));

    globalThis.fetch = async () =>
      Response.json(
        {
          error: {
            message: "private token and raw response must not escape",
            code: 10,
          },
        },
        { status: 400 }
      );
    await assert.rejects(
      replyToInstagramComment(
        {
          appId: "1234567890",
          appSecret: "test-app-secret",
          configId: "9876543210",
          apiVersion: "v27.0",
          redirectUri: "https://engage.example/api/instagram/callback",
        },
        "server-only-system-user-token",
        "17900000000000001",
        "Test reply"
      ),
      (error: unknown) =>
        error instanceof MetaApiError &&
        error.code === "meta_request_failed" &&
        !error.message.includes("private token")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram reply message length uses the 2,200-character limit", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({ id: "17900000000000002" });
  };
  const config = {
    appId: "1234567890",
    appSecret: "test-app-secret",
    configId: "9876543210",
    apiVersion: "v27.0",
    redirectUri: "https://engage.example/api/instagram/callback",
  };

  try {
    await replyToInstagramComment(
      config,
      "server-only-system-user-token",
      "17900000000000001",
      "😀".repeat(2200)
    );
    await assert.rejects(
      replyToInstagramComment(
        config,
        "server-only-system-user-token",
        "17900000000000001",
        "😀".repeat(2201)
      ),
      { code: "meta_comment_reply_invalid" }
    );
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram comment reply attempts block immediate duplicates without claiming durable exactly-once delivery", () => {
  const now = 1_800_000_000_000;
  const accountId = "test-account-reply-guard";
  const commentId = "test-comment-reply-guard";
  assert.equal(
    claimInstagramCommentReplyAttempt(accountId, commentId, now),
    true
  );
  assert.equal(
    claimInstagramCommentReplyAttempt(accountId, commentId, now + 1),
    false
  );
  assert.equal(
    claimInstagramCommentReplyAttempt(
      accountId,
      commentId,
      now + 15 * 60 * 1000
    ),
    true
  );
});

test("uncertain Instagram reply POST failures are reported without retries", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("transport failure");
  };
  try {
    await assert.rejects(
      replyToInstagramComment(
        {
          appId: "1234567890",
          appSecret: "test-app-secret",
          configId: "9876543210",
          apiVersion: "v27.0",
          redirectUri: "https://engage.example/api/instagram/callback",
        },
        "server-only-system-user-token",
        "17900000000000001",
        "One attempt only"
      ),
      { code: "meta_post_outcome_unknown" }
    );
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram public reply routes require same-origin confirmation and owned account context", () => {
  const commentsRoute = readFileSync(
    new URL("../src/app/api/instagram/comments/route.ts", import.meta.url),
    "utf8"
  );
  const replyRoute = readFileSync(
    new URL("../src/app/api/instagram/comment-reply/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(commentsRoute, /getOwnedInstagramDataContext/);
  assert.match(commentsRoute, /verifyInstagramMediaOwnership/);
  assert.match(commentsRoute, /"Cache-Control": "no-store"/);
  assert.match(commentsRoute, /url\.searchParams\.get\("after"\)/);
  assert.match(commentsRoute, /nextCursor/);
  assert.doesNotMatch(commentsRoute, /accessToken\s*:/);
  assert.match(replyRoute, /isSameOriginRequest\(request\)/);
  assert.match(replyRoute, /request\.headers\.get\("origin"\)/);
  assert.match(replyRoute, /body\.confirm !== true/);
  assert.match(replyRoute, /getOwnedInstagramDataContext\(body\.accountId\)/);
  assert.match(replyRoute, /getInstagramCommentReplyTarget/);
  assert.match(replyRoute, /comment\.mediaId !== body\.mediaId/);
  assert.match(replyRoute, /isInstagramCommentReplyableOnMedia/);
  assert.match(replyRoute, /claimInstagramCommentReplyAttempt/);
  assert.match(replyRoute, /retryable: false/);
  assert.match(replyRoute, /outcome: "unknown"/);
  assert.match(replyRoute, /replyToInstagramComment/);
  assert.match(replyRoute, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(replyRoute, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(replyRoute, /accessToken\s*:/);
});

test("Instagram media pagination deduplicates by media ID", () => {
  const firstPage = [
    { id: "media-1", caption: "First" },
    { id: "media-2", caption: "Second" },
  ];
  const nextPage = [
    { id: "media-2", caption: "Duplicate" },
    { id: "media-3", caption: "Third" },
    { id: "media-3", caption: "Duplicate in page" },
  ];

  assert.deepEqual(deduplicateInstagramMedia(firstPage, nextPage), [
    { id: "media-1", caption: "First" },
    { id: "media-2", caption: "Second" },
    { id: "media-3", caption: "Third" },
  ]);
});

test("Instagram media timestamps are validated before display", () => {
  assert.equal(isValidInstagramTimestamp("2026-11-10T12:00:00+0000"), true);
  assert.equal(isValidInstagramTimestamp(""), false);
  assert.equal(isValidInstagramTimestamp("not-a-timestamp"), false);

  const component = readFileSync(
    new URL(
      "../src/app/(dashboard)/instagram/instagram-account-data.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(
    component,
    /isValidInstagramTimestamp\(item\.timestamp\)\s*&&\s*\(\s*<time/
  );
});

test("Instagram account data requests abort on account change and stay independent", () => {
  const component = readFileSync(
    new URL(
      "../src/app/(dashboard)/instagram/instagram-account-data.tsx",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(component, /const controller = new AbortController\(\)/);
  assert.match(component, /controller\.abort\(\)/);
  assert.match(component, /signal: controller\.signal/);
  assert.match(component, /Promise\.all\(\[loadProfile\(\), loadInitialMedia\(\)\]\)/);
  assert.match(component, /loadingMoreRequest\.current/);
  assert.match(component, /aria-busy=\{loadingMore\}/);
  assert.match(component, /aria-live="polite"/);
  assert.doesNotMatch(component, /items-centerjustify-center/);
});

test("Instagram data routes scope token lookup to the authenticated owner", () => {
  const contextSource = readFileSync(
    new URL("../src/lib/instagram/account-data.ts", import.meta.url),
    "utf8"
  );
  const profileRoute = readFileSync(
    new URL("../src/app/api/instagram/profile/route.ts", import.meta.url),
    "utf8"
  );
  const mediaRoute = readFileSync(
    new URL("../src/app/api/instagram/media/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(contextSource, /supabase\.auth\.getUser\(\)/);
  assert.match(
    contextSource,
    /\.eq\("id", accountId\)\s*\.eq\("owner_id", authData\.user\.id\)/
  );
  assert.equal(
    (contextSource.match(/\.eq\("owner_id", authData\.user\.id\)/g) ?? [])
      .length,
    3
  );
  assert.ok(
    contextSource.indexOf("decryptToken(connection.encrypted_access_token)") >
      contextSource.indexOf('.eq("id", accountId)')
  );
  assert.doesNotMatch(profileRoute, /accessToken\s*:/);
  assert.doesNotMatch(mediaRoute, /accessToken\s*:/);
  assert.match(profileRoute, /"Cache-Control": "no-store"/);
  assert.match(mediaRoute, /"Cache-Control": "no-store"/);
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
      (permission) => permission !== "instagram_content_publish"
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
          JSON.stringify(details).includes("instagram_content_publish")
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

test("persistence diagnostics retain SQLSTATE and sanitize private values", () => {
  const originalError = console.error;
  const diagnostics: unknown[] = [];
  console.error = (...args: unknown[]) => diagnostics.push(args);

  try {
    logInstagramPersistenceError(
      {
        code: "23505",
        message:
          'duplicate key for account 17841400000000002 user 123e4567-e89b-12d3-a456-426614174000 "private_value"',
      },
      [
        "authorization-code-secret",
        "app-secret-value",
        "access-token-value",
        "encrypted-token-value",
        "private-user-id",
      ]
    );

    const serialized = JSON.stringify(diagnostics);
    assert.equal(serialized.includes("23505"), true);
    assert.equal(serialized.includes("database_persistence"), true);
    assert.equal(serialized.includes("authorization-code-secret"), false);
    assert.equal(serialized.includes("app-secret-value"), false);
    assert.equal(serialized.includes("access-token-value"), false);
    assert.equal(serialized.includes("encrypted-token-value"), false);
    assert.equal(serialized.includes("private-user-id"), false);
    assert.equal(serialized.includes("17841400000000002"), false);
    assert.equal(
      serialized.includes("123e4567-e89b-12d3-a456-426614174000"),
      false
    );
    assert.equal(serialized.includes("private_value"), false);
  } finally {
    console.error = originalError;
  }
});

test("database error messages are bounded and non-string messages are generic", () => {
  const sanitizedLongMessage = sanitizeDatabaseErrorMessage("x".repeat(500));
  assert.ok(sanitizedLongMessage.length > 0);
  assert.ok(sanitizedLongMessage.length <= 240);
  assert.equal(
    sanitizeDatabaseErrorMessage({ message: "private" }),
    "Database returned an unrecognized error."
  );
});

test("database error sanitizer redacts URL parameters and identifiers", () => {
  const message = sanitizeDatabaseErrorMessage(
    "URL ?access_token=access-secret&client_secret=app-secret&code=oauth-code&state=state-secret&user_id=12345; UUID 123e4567-e89b-12d3-a456-426614174000, account 17841400000000002, values 'private-user' and \"private-account\"",
    [
      "access-secret",
      "app-secret",
      "oauth-code",
      "state-secret",
      "private-user",
      "private-account",
    ]
  );

  for (const sensitiveValue of [
    "access-secret",
    "app-secret",
    "oauth-code",
    "state-secret",
    "12345",
    "123e4567-e89b-12d3-a456-426614174000",
    "17841400000000002",
    "private-user",
    "private-account",
  ]) {
    assert.equal(message.includes(sensitiveValue), false);
  }
  assert.match(message, /access_token=\[redacted\]/);
  assert.match(message, /client_secret=\[redacted\]/);
  assert.match(message, /code=\[redacted\]/);
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

test("Unified Login tokens are not refreshed and only expired tokens require reconnection", () => {
  const meta = readFileSync(
    new URL("../src/lib/instagram/meta.ts", import.meta.url),
    "utf8"
  );
  const actions = readFileSync(
    new URL("../src/app/(dashboard)/instagram/actions.ts", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(meta, /system_user_access_tokens|refreshSystemUserToken/);
  assert.doesNotMatch(actions, /refreshUnifiedLoginConnection|refreshSystemUserToken/);
  assert.match(
    actions,
    /connection\.connection_status === "CONNECTED" && !isExpired/
  );
  assert.match(
    actions,
    /isExpired && connection\.connection_status !== "REVOKED"/
  );
  assert.match(actions, /connection_status: "EXPIRED"/);
  assert.match(actions, /Date\.parse\(connection\.token_expires_at\) <= Date\.now\(\)/);
  assert.match(actions, /\.eq\("owner_id", ownerId\)/);
  assert.equal(isTokenExpired("2025-12-31T23:59:59.000Z"), true);
  assert.equal(isTokenExpired("2099-01-01T00:00:00.000Z"), false);
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

test("Instagram persistence ON CONFLICT targets have matching migration uniqueness", () => {
  const initialSchema = readFileSync(
    new URL(
      "../supabase/migrations/20261109000001_initial_schema.sql",
      import.meta.url
    ),
    "utf8"
  );
  const directLoginMigration = readFileSync(
    new URL(
      "../supabase/migrations/20261110000004_instagram_login_connections.sql",
      import.meta.url
    ),
    "utf8"
  );
  const unifiedLoginMigration = readFileSync(
    new URL(
      "../supabase/migrations/20261110000005_instagram_unified_login.sql",
      import.meta.url
    ),
    "utf8"
  );
  const unifiedLoginPermissionsMigration = readFileSync(
    new URL(
      "../supabase/migrations/20261111000001_unified_login_permissions.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    directLoginMigration,
    /CREATE UNIQUE INDEX unique_instagram_login_user_connection\s+ON public\.instagram_business_connections \(owner_id, instagram_user_id\)\s+WHERE login_type = 'INSTAGRAM_LOGIN'\s+AND instagram_user_id IS NOT NULL/
  );
  assert.match(
    directLoginMigration,
    /ON CONFLICT \(owner_id, instagram_user_id\)\s+WHERE login_type = 'INSTAGRAM_LOGIN'\s+AND instagram_user_id IS NOT NULL/
  );
  assert.match(
    unifiedLoginMigration,
    /CONSTRAINT unique_instagram_unified_login_business\s+UNIQUE \(owner_id, client_business_id\)/
  );
  for (const migration of [
    unifiedLoginMigration,
    unifiedLoginPermissionsMigration,
  ]) {
    assert.match(migration, /ON CONFLICT \(owner_id, client_business_id\)/);
    assert.match(migration, /ON CONFLICT \(instagram_business_id\)/);
  }
  assert.match(
    initialSchema,
    /CONSTRAINT unique_instagram_business_id UNIQUE \(instagram_business_id\)/
  );
});

test("additive Unified Login migration requires only Instagram permissions", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261111000001_unified_login_permissions.sql",
      import.meta.url
    ),
    "utf8"
  );
  const requiredPermissions = [
    "instagram_basic",
    "instagram_manage_comments",
    "instagram_manage_messages",
    "instagram_content_publish",
  ];

  for (const permission of requiredPermissions) {
    assert.match(migration, new RegExp(`'${permission}'`));
  }
  assert.doesNotMatch(migration, /business_management/);
  assert.match(migration, /WHERE existing\.owner_id = EXCLUDED\.owner_id/);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /TO service_role/);
});
