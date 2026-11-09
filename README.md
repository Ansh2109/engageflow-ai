This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Google sign-in

The application uses Supabase Auth for Google OAuth and session cookies. Set these
application environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL=<your Supabase project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your Supabase publishable key>
NEXT_PUBLIC_SITE_URL=<the app origin, such as http://localhost:3000 for local development>
```

Configure Google OAuth in Google Cloud Console:

1. Configure the OAuth consent screen and create an OAuth client ID of type **Web application**.
2. Add the Supabase Auth callback shown in Supabase Dashboard under **Authentication → Sign In / Providers → Google** to the Google client's **Authorized redirect URIs**. For the standard Supabase domain, the format is `https://<project-ref>.supabase.co/auth/v1/callback`. Use the dashboard's exact callback if the project uses a custom auth domain.
3. Enable Google under **Authentication → Sign In / Providers** in Supabase and enter the Google client ID and client secret there. Do not put the Google client secret in this application or browser environment.
4. Under **Authentication → URL Configuration**, set **Site URL** to the deployed app origin and add `<app-origin>/api/auth/callback` to **Redirect URLs**. For local development, use the value of `NEXT_PUBLIC_SITE_URL` with `/api/auth/callback` appended.
5. Disable the Email provider in Supabase if Google is to remain the only enabled sign-in method. The app itself exposes only Google sign-in.

The Google OAuth client redirects to Supabase's Auth callback; Supabase then redirects to the application callback at `<app-origin>/api/auth/callback`, where the server exchanges the code, verifies the session and trigger-created profile, and redirects only to a safe internal path.

Run the auth flow tests with `npm run test:auth` (Node.js with built-in TypeScript stripping, such as Node 22.6 or later).

## Instagram Unified Login

Instagram connections use Meta's official Facebook Login for Business flow for
the Instagram API with Unified Login. Supabase remains the application's login
provider; Meta authorization is a separate server-side integration.

Set these additional environment variables on the server:

```text
META_APP_ID=<Meta app ID>
META_APP_SECRET=<Meta app secret; server-only>
META_CONFIG_ID=<Facebook Login for Business configuration ID>
META_API_VERSION=v27.0
META_REDIRECT_URI=<NEXT_PUBLIC_SITE_URL>/api/instagram/callback
TOKEN_ENCRYPTION_KEY=<64-character hexadecimal AES-256 key>
```

`META_REDIRECT_URI` must exactly equal the callback URL entered in Meta. Use an
HTTPS app origin outside local development. Do not prefix any Meta secret or
encryption key with `NEXT_PUBLIC_`, and do not commit real credentials.

In Meta's App Dashboard:

1. Use a business app with **Manage messaging & content on Instagram** and
   **Facebook Login for Business** enabled. Configure **Instagram API with
   Unified Login**.
2. Create a configuration that issues a **System-user access token**. Add the
   exact redirect URI above and grant `instagram_basic`,
   `instagram_manage_comments`, `instagram_manage_messages`, and
   `business_management`. The last permission is required for the official
   business-token management API used when a token is near expiration.
3. Configure the connected Instagram professional-account assets. Copy the
   configuration ID into `META_CONFIG_ID`.
4. For production onboarding beyond app-role testers, complete Meta App Review
   and obtain the Advanced Access required for these permissions.

The OAuth callback exchanges its one-time code on the server, validates the
granted permissions, reads `/me/assigned_instagram_accounts`, rejects accounts
owned by another EngageFlow user, encrypts the shared business token, and stores
only public account metadata in `instagram_accounts`. Tokens are never returned
to the browser. When an expiring business token is within seven days of expiry,
renewal uses Meta's Business Integration System User Access Token Management
API and `appsecret_proof`, explicitly requests a new 60-day token, and limits
its permissions and assets to those already connected. The returned token
expiry is recorded rather than treated as non-expiring.

Before using this integration, apply these additive migrations in order to the
intended database:

1. `supabase/migrations/20261110000001_instagram_business_connections.sql`
   creates a server-only shared-token table and an optional owner-matched
   account link.
2. `supabase/migrations/20261110000002_atomic_instagram_connection.sql`
   adds a service-role-only function that atomically upserts the business
   token, reconciles currently assigned Instagram accounts, pauses active
   automations for assets no longer assigned, removes unused connections, and
   writes activity logs.
3. `supabase/migrations/20261110000003_instagram_oauth_state.sql` creates a
   server-only nonce registry. Signed states are bound to their initiating
   user, expire after ten minutes, and are atomically consumed once. Starting
   a new authorization safely removes expired nonce records.

These migrations do not alter or delete existing application rows. Existing
legacy `instagram_account_tokens` rows are not migrated or removed
automatically. These migrations are not applied automatically by the app.

Disconnecting deletes the local account link, and deletes the shared encrypted
token only when no other connected Instagram account uses it. To fully revoke
the business integration grant, the user must also remove EngageFlow in Meta
Business Integrations.

Run the integration flow tests with `npm run test:instagram`; they use no live
Meta credentials or network requests.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
