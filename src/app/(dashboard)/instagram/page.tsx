
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
    text: "The account was disconnected. A shared business token remains only while another account uses it.",
    success: true,
  },
  refreshed: {
    text: "The business access token was refreshed.",
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
    text: "This token is not close to expiring yet.",
  },
  refresh_failed: {
    text: "The token could not be refreshed. Reconnect the business account.",
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
      "id, instagram_business_id, username, name, connection_status, connection_id, created_at"
    )
    .eq("owner_id", authData.user.id)
    .order("created_at", { ascending: true });

  if (accountsError) {
    throw new Error("Unable to load Instagram accounts.");
  }

  const admin = createAdminClient();

  const { data: connections, error: connectionsError } = await admin
    .from("instagram_business_connections")
    .select("id, token_expires_at, connection_status")
    .eq("owner_id", authData.user.id);

  if (connectionsError) {
    throw new Error("Unable to load Instagram connections.");
  }

  const accountsByConnection = new Map<
    string,
    NonNullable<typeof accounts>
  >();

  for (const account of accounts ?? []) {
    if (!account.connection_id) continue;

    const linked =
      accountsByConnection.get(account.connection_id) ?? [];

    linked.push(account);
    accountsByConnection.set(account.connection_id, linked);
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
              Authorize EngageFlow AI to access the professional Instagram
              accounts in your business portfolio.
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
          ? "Connect another business"
          : "Connect Instagram"}
      </a>

      {(connections ?? []).map((connectionItem) => {
        const linkedAccounts =
          accountsByConnection.get(connectionItem.id) ?? [];

        if (linkedAccounts.length === 0) return null;

        const expiresAt = connectionItem.token_expires_at;
        const expired = isTokenExpired(expiresAt);
        const refreshDue = isTokenRefreshDue(expiresAt);

        return (
          <section
            key={connectionItem.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <h2 className="font-semibold">Business access</h2>

            <p className="text-sm text-muted-foreground">
              {expired
                ? "This business token has expired. Reconnect the business to restore access."
                : connectionItem.connection_status === "CONNECTED"
                  ? expiresAt
                    ? `Token expires ${new Date(expiresAt).toLocaleDateString()}.`
                    : "This business token does not have a scheduled expiration."
                  : "This business connection needs to be reauthorized."}
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

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 font-semibold">
          <Shield className="h-5 w-5 text-primary" />
          Connection details
        </div>

        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>Instagram Business or Creator accounts are supported.</li>

          <li>
            Meta Unified Login requires the Instagram account to be shared
            from a business portfolio.
          </li>

          <li>
            Access tokens are encrypted and retained only on the server. One
            business token can cover multiple connected accounts.
          </li>

          <li>
            Disconnecting removes EngageFlow&apos;s local access. To revoke
            the business integration grant itself, also remove EngageFlow in
            Meta Business Integrations.
          </li>
        </ul>

        <a
          href="https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Meta Unified Login documentation
          <ExternalLink className="h-3 w-3" />
        </a>
      </section>
    </div>
  );
}
