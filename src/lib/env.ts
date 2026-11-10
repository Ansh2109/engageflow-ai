/**
 * Environment variable validation.
 *
 * Call getEnv() on the server to get validated env vars.
 * Never import this in client components — it references server-only vars.
 *
 * Phase 1: Only the shape is defined. Validation is activated in later phases
 * when the values are actually available.
 */

export interface Env {
  // Supabase (Phase 2)
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string;
  siteUrl: string;

  // Meta / Instagram (Phase 4)
  metaAppId: string;
  metaAppSecret: string;
  metaApiVersion: string;
  metaRedirectUri: string;

  // Token encryption (Phase 4)
  tokenEncryptionKey: string;
}

/** Returns validated environment variables or throws with a clear message. */
export function getEnv(): Env {
  const required = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    metaAppId: process.env.META_APP_ID,
    metaAppSecret: process.env.META_APP_SECRET,
    metaApiVersion: process.env.META_API_VERSION ?? "v27.0",
    metaRedirectUri: process.env.META_REDIRECT_URI,
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
  } as const;

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    // During Phase 1 we don't throw — we return defaults so the UI builds.
    // Phase 2 onwards will enforce strict validation.
    console.warn(
      `[EngageFlow] Missing environment variables: ${missing.join(", ")}. ` +
        "Some features will not work until they are set in .env.local."
    );
  }

  return required as unknown as Env;
}

/**
 * Public (browser-safe) env vars only.
 * Safe to import in client components.
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
} as const;
