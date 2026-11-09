const PROTECTED_PREFIXES = [
  "/dashboard",
  "/automations",
  "/activity",
  "/instagram",
  "/settings",
];

export type OAuthFailure = "oauth_failed" | "oauth_cancelled" | "profile_missing";

export function safeInternalRedirect(
  value: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const url = new URL(value, "https://engageflow.invalid");
    return url.origin === "https://engageflow.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function getProtectedRouteRedirect(
  requestUrl: URL,
  hasUser: boolean
): URL | null {
  const { pathname } = requestUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!hasUser && isProtected) {
    const loginUrl = new URL("/login", requestUrl);
    const requestedPath = safeInternalRedirect(
      `${pathname}${requestUrl.search}`
    );
    loginUrl.searchParams.set("redirectTo", requestedPath);
    return loginUrl;
  }

  if (hasUser && pathname === "/login") {
    return new URL("/dashboard", requestUrl);
  }

  return null;
}

export function isExpectedMissingAuthSession(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AuthSessionMissingError"
  );
}

export function getLogoutRedirect(siteUrl: string): URL {
  return new URL("/login", siteUrl);
}

export function getOAuthErrorRedirect(siteUrl: string): URL {
  const loginUrl = new URL("/login", siteUrl);
  loginUrl.searchParams.set("error", "oauth_failed");
  return loginUrl;
}

interface OAuthCallbackOperations {
  exchangeCodeForSession: (
    code: string
  ) => Promise<{ userId: string | null; failed: boolean }>;
  hasProfile: (userId: string) => Promise<boolean>;
  signOut: () => Promise<boolean>;
}

export async function completeOAuthCallback(
  operations: OAuthCallbackOperations,
  code: string | null,
  next: string | null
): Promise<{ destination: string; failure?: OAuthFailure }> {
  if (!code) {
    return { destination: "/login?error=oauth_failed", failure: "oauth_failed" };
  }

  const { userId, failed } = await operations.exchangeCodeForSession(code);
  if (failed || !userId) {
    return { destination: "/login?error=oauth_failed", failure: "oauth_failed" };
  }

  let hasProfile = false;
  try {
    hasProfile = await operations.hasProfile(userId);
  } catch {
    hasProfile = false;
  }

  if (!hasProfile) {
    const signOutFailed = await operations.signOut();
    if (signOutFailed) {
      throw new Error("Unable to clear the session after profile verification failed.");
    }

    return {
      destination: "/login?error=profile_missing",
      failure: "profile_missing",
    };
  }

  return { destination: safeInternalRedirect(next) };
}

export async function signOutSession(
  signOut: () => Promise<{ error: unknown | null }>
): Promise<void> {
  const { error } = await signOut();
  if (error) {
    throw new Error("Unable to end the Supabase session.");
  }
}

export function oauthErrorCode(
  error: string | null
): "oauth_cancelled" | "oauth_failed" | null {
  if (!error) return null;
  return error === "access_denied" ? "oauth_cancelled" : "oauth_failed";
}
