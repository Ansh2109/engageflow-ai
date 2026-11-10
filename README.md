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

## Instagram Login

Instagram connections use Meta's **Business Login for Instagram** (Instagram
Login), not Facebook Login for Business or a System User token. A customer
authorizes their Instagram Business or Creator account directly; a linked
Facebook Page and Business Manager asset assignment are not required.
Supabase remains the application's login provider, and all Instagram OAuth
exchanges run on the server.

Set these additional environment variables on the server:

```text
META_APP_ID=<Meta app ID>
META_APP_SECRET=<Meta app secret; server-only>
META_API_VERSION=v27.0
META_REDIRECT_URI=<NEXT_PUBLIC_SITE_URL>/api/instagram/callback
TOKEN_ENCRYPTION_KEY=<64-character hexadecimal AES-256 key>
```

`META_REDIRECT_URI` must exactly match the OAuth redirect URI configured in
Meta. Do not prefix the app secret or encryption key with `NEXT_PUBLIC_`, and
do not commit real credentials. `.env.example` lists the complete variable
names needed by the app; `META_API_VERSION` defaults to `v27.0`.

In Meta's App Dashboard:

1. Use a **Business** app and add **Instagram API with Instagram Login**.
   Configure Business Login for Instagram and copy its Instagram App ID and
   App Secret into the server-side variables above.
2. Add `<app-origin>/api/instagram/callback` to the Instagram Login OAuth
   redirect URI allowlist. Meta's callback is separate from the Supabase
   `/api/auth/callback`.
3. Configure `instagram_business_basic`,
   `instagram_business_manage_messages`,
   `instagram_business_manage_comments`, and
   `instagram_business_content_publish`. The OAuth request explicitly sets
   `enable_fb_login=false`.
4. For customer accounts outside the app's own testers, request the required
   Advanced Access through Meta App Review and complete Business Verification
   where Meta requires it. Configure the app as **Live** for production
   webhooks.
5. To receive Instagram webhook events, configure the HTTPS callback, verify
   token, and webhook fields in Meta, then subscribe each authorized account
   using its Instagram User token. `comments` needs basic + manage-comments
   permissions and `messages` needs basic + manage-messages permissions. See
   Meta's [Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login),
   [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login),
   [webhook setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup),
   [webhook permissions](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields),
   [messaging](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api),
   [comment moderation](https://developers.facebook.com/documentation/instagram-platform/comment-moderation), and
   [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
   documentation.

The server validates the authenticated Supabase user, a signed and single-use
OAuth state, callback parameters, granted scopes, and Instagram account
identity. It exchanges the authorization code for a short-lived token,
upgrades it to a 60-day token, encrypts it with AES-256-GCM, then stores it with
the Instagram professional account ID. The dashboard refresh action validates
the token and refreshes it only when due; Meta requires the existing long-lived
token to be valid and at least 24 hours old. Tokens and OAuth codes are never
sent to browser code or written to application logs.

Before using this integration, apply these additive migrations in order to the
intended database:

1. `supabase/migrations/20261110000001_instagram_business_connections.sql`
2. `supabase/migrations/20261110000002_atomic_instagram_connection.sql`
3. `supabase/migrations/20261110000003_instagram_oauth_state.sql`
4. `supabase/migrations/20261110000004_instagram_login_connections.sql`

The fourth migration adds Instagram Login rows and a service-role-only
connection RPC. It retains existing Unified Login connection columns and data;
the legacy persistence RPC also remains for backward compatibility. The
migration does not delete or transform existing connections or
`instagram_account_tokens`. Reconnecting an existing account through Instagram
Login links that account to the new token without deleting legacy rows. Apply
these migrations manually; the app does not apply them automatically.

Disconnecting deletes the local account link and its now-unused connection
record. To revoke the Instagram grant itself, the user must also remove
EngageFlow from Instagram's **Apps and Websites** settings.

**Repository limitation:** this source tree currently has no Instagram webhook
route, account webhook-subscription call, or automation event processor. It
contains automation and webhook-event database tables, but connecting an
account alone cannot receive events or execute DM/comment automations. These
must be implemented and deployed before promising those features. Meta
requires an HTTPS webhook endpoint, account subscriptions, the corresponding
permissions, and compliance with Instagram's messaging windows (generally 24
hours; some Click-to-Direct-ad interactions allow up to 7 days).

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
