import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { decryptToken, encryptToken } from "../src/lib/crypto.ts";
import {
  buildMetaAuthorizationUrl,
  createAppSecretProof,
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
  getMetaConfig,
  refreshSystemUserToken,
} from "../src/lib/instagram/meta.ts";

test("OAuth URL uses Unified Login code flow and an exact server callback", () => {
  const url = buildMetaAuthorizationUrl(
    {
      appId: "test-app-id",
      configId: "test-config",
      redirectUri: "https://engage.example/api/instagram/callback",
    },
    "state-value"
  );
  assert.equal(url.origin, "https://www.facebook.com");
  assert.equal(url.pathname, "/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), "test-app-id");
  assert.equal(url.searchParams.get("config_id"), "test-config");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://engage.example/api/instagram/callback"
  );
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-value");
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

test("Meta app-secret proof is a SHA-256 HMAC of the access token", () => {
  assert.equal(
    createAppSecretProof("token-value", "app-secret"),
    "3decdc49a80347184a48f58815bf90e3e3008571e007091022e7b3a74e75f175"
  );
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
    isTokenRefreshDue("2026-01-06T00:00:00.000Z", now),
    true
  );
  assert.equal(
    isTokenRefreshDue("2026-01-10T00:00:00.000Z", now),
    false
  );
  assert.equal(isTokenRefreshDue("2025-12-31T23:59:59.000Z", now), false);
  assert.equal(isTokenRefreshDue("invalid", now), false);
  assert.equal(isTokenRefreshDue(null, now), false);
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

test("business token refresh calls Meta with appsecret_proof and never uses an external host", async () => {
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
  let capturedUrl: URL | undefined;
  let capturedMethod: string | undefined;
  const startedAt = Date.now();

  process.env.NEXT_PUBLIC_SITE_URL = "https://engage.example";
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.META_CONFIG_ID = "test-config-id";
  process.env.META_REDIRECT_URI =
    "https://engage.example/api/instagram/callback";
  process.env.META_API_VERSION = "v27.0";
  globalThis.fetch = async (input, init) => {
    capturedUrl = new URL(input.toString());
    capturedMethod = init?.method;
    return new Response(JSON.stringify({ access_token: "rotated-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const config = getMetaConfig();
    const token = await refreshSystemUserToken(
      config,
      "current-token",
      "123",
      "456",
      ["789"]
    );
    assert.equal(token.accessToken, "rotated-token");
    const expiry = Date.parse(token.expiresAt);
    assert.ok(expiry >= startedAt + 60 * 24 * 60 * 60 * 1000);
    assert.ok(expiry <= Date.now() + 60 * 24 * 60 * 60 * 1000);
    assert.equal(capturedMethod, "POST");
    assert.equal(
      capturedUrl?.origin,
      "https://graph.facebook.com"
    );
    assert.equal(
      capturedUrl?.pathname,
      "/v27.0/123/system_user_access_tokens"
    );
    assert.equal(
      capturedUrl?.searchParams.get("appsecret_proof"),
      createAppSecretProof("current-token", "test-app-secret")
    );
    assert.equal(
      capturedUrl?.searchParams.get("system_user_id"),
      "456"
    );
    assert.equal(capturedUrl?.searchParams.get("asset"), "789");
    assert.equal(
      capturedUrl?.searchParams.get("scope"),
      "instagram_basic,instagram_manage_comments,instagram_manage_messages,business_management"
    );
    assert.equal(
      capturedUrl?.searchParams.get("set_token_expires_in_60_days"),
      "true"
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
