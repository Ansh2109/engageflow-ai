
import type { Metadata } from "next";
import { connection } from "next/server";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Shield,
  Unplug,
} from "lucide-react";
import { redirect } from "next/navigation";
import { Instagram } from "@/components/icons/Instagram";
import {
  disconnectInstagramAccount,
  reconnectUnifiedLoginConnection,
  refreshInstagramConnection,
} from "./actions";
import {
  isTokenExpired,
  isTokenRefreshDue,
} from "@/lib/instagram/oauth";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Instagram Account",
};

export const instant = false;

const statusMessages: Record<string, { text: string; success?: boolean }> = {
  connected: { text: "Instagram account connected.", success: true },
  disconnected: {
    text: "The Instagram account was disconnected.",
    success: true,
  },
  refreshed: {
    text: "The Instagram access token was refreshed.",
    success: true,
  },
  oauth_cancelled: {
    text: "Instagram authorization was cancelled.",
  },
  invalid_state: {
    text: "The authorization request expired or could not be verified. Please try again.",
  },
  account_in_use: {
    text: "An Instagram account is already connected to a different EngageFlow user.",
  },
  profile_missing: {
    text: "Your EngageFlow profile is unavailable. Sign in again or contact support before connecting Instagram.",
  },
  refresh_not_due: {
    text: "This token is not eligible for refresh yet. Try again later.",
  },
  reauthorize_not_due: {
    text: "This connection is still valid. Reconnect will be available after the token expires.",
  },
  refresh_failed: {
    text: "The token could not be refreshed. Reconnect the Instagram account.",
  },
  disconnect_failed: {
    text: "The account could not be disconnected. Please try again.",
  },
  oauth_failed: {
    text: "Instagram could not be connected. Check the configuration and try again.",
  },
};

type InstagramPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function InstagramPage({
  searchParams,
}: InstagramPageProps) {
  // Ensure request-time rendering before Supabase Auth loads the session.
  await connection();

  const { status } = await searchParams;
  const notice = status ? statusMessages[status] : undefined;

  const supabase = await createClient();

  const { data: authData, error: authError } =
    await supabase.auth.getUser();

  if (authError || !authData.user) {
    redirect("/login?redirectTo=%2Finstagram");
  }

  const { data: accounts, error: accountsError } = await supabase
    .from("instagram_accounts")
    .select(
      "id, instagram_business_id, username, name, connection_status, connection_id, unified_connection_id, created_at"
    )
    .eq("owner_id", authData.user.id)
    .order("created_at", { ascending: true });

  if (accountsError) {
    throw new Error("Unable to load Instagram accounts.");
  }

  const admin = createAdminClient();

  const { data: connections, error: connectionsError } = await admin
    .from("instagram_business_connections")
    .select(
      "id, login_type, instagram_user_id, token_expires_at, connection_status, updated_at"
    )
    .eq("owner_id", authData.user.id);

  if (connectionsError) {
    throw new Error("Unable to load Instagram connections.");
  }

  const { data: unifiedConnections, error: unifiedConnectionsError } =
    await admin
      .from("instagram_unified_login_connections")
      .select(
        "id, client_business_id, system_user_id, token_expires_at, connection_status, updated_at"
      )
      .eq("owner_id", authData.user.id);
  if (unifiedConnectionsError) {
    throw new Error("Unable to load Unified Login connections.");
  }

  const accountsByConnection = new Map<
    string,
    NonNullable<typeof accounts>
  >();
  const accountsByUnifiedConnection = new Map<
    string,
    NonNullable<typeof accounts>
  >();

  for (const account of accounts ?? []) {
    if (account.connection_id) {
      const linked = accountsByConnection.get(account.connection_id) ?? [];
      linked.push(account);
      accountsByConnection.set(account.connection_id, linked);
    }
    if (account.unified_connection_id) {
      const linked =
        accountsByUnifiedConnection.get(account.unified_connection_id) ?? [];
      linked.push(account);
      accountsByUnifiedConnection.set(account.unified_connection_id, linked);
    }
  }

  const connectedAccounts = accounts ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Instagram Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect an Instagram professional account to enable automations.
        </p>
      </header>

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
            notice.success
              ? "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          }`}
        >
          {notice.success ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {notice.text}
        </div>
      )}

      {connectedAccounts.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="font-semibold">Connected accounts</h2>

          {connectedAccounts.map((account) => (
            <article
              key={account.id}
              className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Instagram className="h-5 w-5 text-primary" />
                </span>

                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    @{account.username}
                  </p>

                  {account.name && (
                    <p className="truncate text-sm text-muted-foreground">
                      {account.name}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {account.connection_status.toLowerCase()}
                  </p>
                </div>
              </div>

              <form action={disconnectInstagramAccount}>
                <input
                  type="hidden"
                  name="accountId"
                  value={account.id}
                />

                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
                >
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </button>
              </form>
            </article>
          ))}
        </section>
      ) : (
        <section className="flex flex-col items-center gap-6 rounded-xl border border-border bg-card p-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Instagram className="h-8 w-8 text-muted-foreground" />
          </span>

          <div>
            <h2 className="mb-2 text-lg font-semibold">
              No account connected
            </h2>

            <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
              Connect your Instagram professional account using Meta Business
              Login. The selected Meta configuration may require a Facebook
              login and assigned Instagram business assets.
            </p>
          </div>
        </section>
      )}

      <a
        href="/api/instagram/connect"
        className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        <Instagram className="h-4 w-4" />
        {connectedAccounts.length
          ? "Connect another Instagram account"
          : "Connect Instagram"}
      </a>

      {(connections ?? []).map((connectionItem) => {
        const linkedAccounts =
          accountsByConnection.get(connectionItem.id) ?? [];

        if (linkedAccounts.length === 0) return null;

        const expiresAt = connectionItem.token_expires_at;
        const expired = isTokenExpired(expiresAt);
        const isInstagramLogin = connectionItem.login_type === "INSTAGRAM_LOGIN";
        const refreshDue =
          isInstagramLogin &&
          connectionItem.connection_status === "CONNECTED" &&
          isTokenRefreshDue(expiresAt, connectionItem.updated_at);

        return (
          <section
            key={connectionItem.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <h2 className="font-semibold">
              {isInstagramLogin ? "Instagram Login (existing)" : "Legacy connection"}
            </h2>

            <p className="text-sm text-muted-foreground">
              {!isInstagramLogin
                ? "This existing business connection is retained. New connections use the configured Meta Business Login flow."
                : expired || connectionItem.connection_status === "EXPIRED"
                  ? "This Instagram token has expired. Reconnect the Instagram account to restore access."
                  : connectionItem.connection_status === "CONNECTED"
                    ? expiresAt
                      ? `Token expires ${new Date(expiresAt).toLocaleDateString()}.`
                      : "This Instagram token has no recorded expiration."
                    : "This Instagram connection needs to be reauthorized."}
            </p>

            {refreshDue && (
              <form action={refreshInstagramConnection}>
                <input
                  type="hidden"
                  name="connectionId"
                  value={connectionItem.id}
                />

                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
                >
                  Refresh access
                </button>
              </form>
            )}
          </section>
        );
      })}

      {(unifiedConnections ?? []).map((connectionItem) => {
        const linkedAccounts =
          accountsByUnifiedConnection.get(connectionItem.id) ?? [];
        if (linkedAccounts.length === 0) return null;

        const expiresAt = connectionItem.token_expires_at;
        const expired = isTokenExpired(expiresAt);
        const reconnectRequired =
          expired || connectionItem.connection_status !== "CONNECTED";

        return (
          <section
            key={connectionItem.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <h2 className="font-semibold">Meta Business Login connection</h2>
            <p className="text-sm text-muted-foreground">
              {expired || connectionItem.connection_status === "EXPIRED"
                ? "This System User token has expired. Reconnect to restore access."
                : connectionItem.connection_status === "CONNECTED"
                  ? expiresAt
                    ? `System User token expires ${new Date(expiresAt).toLocaleDateString()}. It must be reconnected after expiry.`
                    : `System User token for business ${connectionItem.client_business_id} has no recorded expiration.`
                  : "This Meta Business Login connection needs to be reauthorized."}
            </p>
            {reconnectRequired && (
              <form action={reconnectUnifiedLoginConnection}>
                <input
                  type="hidden"
                  name="connectionId"
                  value={connectionItem.id}
                />
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
                >
                  Reconnect Instagram
                </button>
              </form>
            )}
          </section>
        );
      })}

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 font-semibold">
          <Shield className="h-5 w-5 text-primary" />
          Connection details
        </div>

        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>Instagram Business or Creator accounts are supported.</li>

          <li>
            Authorization uses the Facebook Login for Business configuration.
            Instagram assets must be assigned to the configured System User.
          </li>

          <li>
            System User access tokens are encrypted and stored server-side.
            Meta validates the token type and granted permissions before
            assigned Instagram accounts are saved.
          </li>

          <li>
            Unified Login System User tokens are not automatically refreshed.
            Reconnect after the token expires to restore access.
          </li>

          <li>
            Disconnecting removes EngageFlow&apos;s local access. Revoke the
            app&apos;s permissions in Meta&apos;s Business Integrations settings
            to remove the grant itself.
          </li>
        </ul>

        <a
          href="https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Meta Business Login documentation
          <ExternalLink className="h-3 w-3" />
        </a>
      </section>
    </div>
  );
}
