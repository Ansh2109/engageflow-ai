import assert from "node:assert/strict";
import test from "node:test";
import {
  completeOAuthCallback,
  getLogoutRedirect,
  getOAuthErrorRedirect,
  getProtectedRouteRedirect,
  isExpectedMissingAuthSession,
  oauthErrorCode,
  safeInternalRedirect,
  signOutSession,
} from "../src/lib/auth/flow.ts";

function createCallbackOperations({
  exchangeError = null,
  userId = "user-123",
  profileId = userId,
  profileError = null,
  signOutError = null,
}: {
  exchangeError?: unknown | null;
  userId?: string | null;
  profileId?: string | null;
  profileError?: unknown | null;
  signOutError?: unknown | null;
} = {}) {
  const calls = { exchangedCode: "", queriedUserId: "", signOut: 0 };
  const operations = {
    async exchangeCodeForSession(code: string) {
      calls.exchangedCode = code;
      return {
        userId: userId ?? null,
        failed: Boolean(exchangeError),
      };
    },
    async hasProfile(value: string) {
      calls.queriedUserId = value;
      if (profileError) throw profileError;
      return profileId === value;
    },
    async signOut() {
      calls.signOut += 1;
      return Boolean(signOutError);
    },
  };
  return { operations, calls };
}

test("safeInternalRedirect only accepts same-origin paths", () => {
  assert.equal(safeInternalRedirect("/settings?tab=profile"), "/settings?tab=profile");
  assert.equal(safeInternalRedirect("//attacker.example"), "/dashboard");
  assert.equal(safeInternalRedirect("https://attacker.example"), "/dashboard");
  assert.equal(safeInternalRedirect("/\\attacker.example"), "/dashboard");
  assert.equal(safeInternalRedirect("/%0d%0aLocation:evil"), "/%0d%0aLocation:evil");
  assert.equal(safeInternalRedirect(null), "/dashboard");
});

test("callback exchanges the code, verifies the matching profile, then uses a safe destination", async () => {
  const { operations, calls } = createCallbackOperations();
  const result = await completeOAuthCallback(
    operations,
    "single-use-code",
    "/settings?tab=profile"
  );

  assert.equal(calls.exchangedCode, "single-use-code");
  assert.equal(calls.queriedUserId, "user-123");
  assert.equal(result.destination, "/settings?tab=profile");
  assert.equal(result.failure, undefined);
  assert.equal(calls.signOut, 0);
});

test("callback rejects missing code and failed session exchanges", async () => {
  const missing = await completeOAuthCallback(
    createCallbackOperations().operations,
    null,
    null
  );
  assert.equal(missing.failure, "oauth_failed");

  const { operations } = createCallbackOperations({
    exchangeError: new Error("invalid code"),
  });
  const failed = await completeOAuthCallback(operations, "bad-code", null);
  assert.equal(failed.failure, "oauth_failed");
});

test("callback clears a session if the profile is missing or mismatched", async () => {
  const missing = createCallbackOperations({ profileId: null });
  const missingResult = await completeOAuthCallback(missing.operations, "code", null);
  assert.equal(missingResult.failure, "profile_missing");
  assert.equal(missing.calls.signOut, 1);

  const mismatch = createCallbackOperations({ profileId: "another-user" });
  const mismatchResult = await completeOAuthCallback(mismatch.operations, "code", null);
  assert.equal(mismatchResult.failure, "profile_missing");
  assert.equal(mismatch.calls.signOut, 1);
});

test("callback fails closed when profile lookup or session cleanup fails", async () => {
  const lookup = createCallbackOperations({
    profileError: new Error("database unavailable"),
  });
  const lookupResult = await completeOAuthCallback(lookup.operations, "code", null);
  assert.equal(lookupResult.failure, "profile_missing");
  assert.equal(lookup.calls.signOut, 1);

  const cleanup = createCallbackOperations({
    profileId: null,
    signOutError: new Error("sign out failed"),
  });
  await assert.rejects(
    completeOAuthCallback(cleanup.operations, "code", null),
    /Unable to clear the session/
  );
});

test("provider cancellation is distinguished from other OAuth failures", () => {
  assert.equal(oauthErrorCode("access_denied"), "oauth_cancelled");
  assert.equal(oauthErrorCode("server_error"), "oauth_failed");
  assert.equal(oauthErrorCode(null), null);
});

test("protected routes redirect unauthenticated users and keep signed-in users out of login", () => {
  const origin = "http://localhost:3000";
  assert.equal(
    getProtectedRouteRedirect(new URL("/dashboard", origin), false)?.href,
    `${origin}/login?redirectTo=%2Fdashboard`
  );
  assert.equal(
    getProtectedRouteRedirect(new URL("/settings", origin), false)?.href,
    `${origin}/login?redirectTo=%2Fsettings`
  );
  assert.equal(
    getProtectedRouteRedirect(new URL("/dashboard?tab=overview", origin), false)?.href,
    `${origin}/login?redirectTo=%2Fdashboard%3Ftab%3Doverview`
  );
  assert.equal(
    getProtectedRouteRedirect(
      new URL("/automations/new?template=comment", origin),
      false
    )?.href,
    `${origin}/login?redirectTo=%2Fautomations%2Fnew%3Ftemplate%3Dcomment`
  );
  assert.equal(
    getProtectedRouteRedirect(new URL("/dashboard", origin), true),
    null
  );
  assert.equal(
    getProtectedRouteRedirect(new URL("/login", origin), true)?.href,
    `${origin}/dashboard`
  );
  assert.equal(
    getProtectedRouteRedirect(new URL("/", origin), false),
    null
  );
});

test("logout and OAuth errors use the login route without path-relative resolution", () => {
  assert.equal(
    getLogoutRedirect("http://localhost:3000/settings").href,
    "http://localhost:3000/login"
  );
  assert.equal(
    getOAuthErrorRedirect("http://localhost:3000").href,
    "http://localhost:3000/login?error=oauth_failed"
  );
});

test("missing Supabase session is an expected unauthenticated result", () => {
  assert.equal(
    isExpectedMissingAuthSession({
      name: "AuthSessionMissingError",
      message: "Auth session missing!",
    }),
    true
  );
  assert.equal(
    isExpectedMissingAuthSession(new Error("network unavailable")),
    false
  );
});

test("logout awaits Supabase session revocation and propagates failures", async () => {
  let calls = 0;
  await signOutSession(async () => {
    calls += 1;
    return { error: null };
  });
  assert.equal(calls, 1);

  await assert.rejects(
    signOutSession(async () => ({ error: new Error("revocation failed") })),
    /Unable to end the Supabase session/
  );
});
