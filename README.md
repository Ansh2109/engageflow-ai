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

New Instagram connections use the app's **Facebook Login for Business**
configuration for **Instagram API with Facebook Login / Unified Login**. This
is required for newer Meta apps where standalone Instagram Login setup is
unavailable. The current configuration is set to return a Business Integration
System User token and must be configured as Instagram Login Compatible.
Supabase remains the application's login provider; Meta authorization,
token exchange, validation, and asset discovery run on the server.

Set these additional environment variables on the server:

```text
META_APP_ID=<Meta app ID>
META_APP_SECRET=<Meta app secret; server-only>
META_CONFIG_ID=<Facebook Login for Business configuration ID>
META_API_VERSION=v27.0
META_REDIRECT_URI=<NEXT_PUBLIC_SITE_URL>/api/instagram/callback
TOKEN_ENCRYPTION_KEY=<64-character hexadecimal AES-256 key>
```

`META_APP_ID` is the general Meta App ID; `META_CONFIG_ID` identifies the
Business Login configuration. `META_REDIRECT_URI` must exactly match the
valid OAuth redirect URI registered in Meta. Do not prefix the app secret or
encryption key with `NEXT_PUBLIC_`, and do not commit real credentials.
`.env.example` lists the complete variable names needed by the app;
`META_API_VERSION` defaults to `v27.0`.

In Meta's App Dashboard:

1. Use a **Business** app and configure **Facebook Login for Business** with
   the **Instagram API (Unified Login)** configuration. Select
   **Business Integration System User** as the access-token type and ensure
   the configuration is Instagram Login Compatible.
2. Register `<app-origin>/api/instagram/callback` as a valid OAuth redirect
   URI and set the same value as `META_REDIRECT_URI`. This callback is separate
   from the Supabase `/api/auth/callback`.
3. Copy the Meta App ID, App Secret, and Business Login configuration ID into
   the server-side environment variables above. Never use an Instagram App ID
   from the standalone Instagram Login setup.
4. Configure and request `instagram_basic`, `instagram_manage_comments`,
   `instagram_manage_messages`, and `instagram_content_publish`. These are the
   permissions required to connect an account. The app validates granted
   permissions from Meta's token and permissions responses before persisting a
   connection.
5. Assign the Instagram professional accounts to the configured System User.
   The app discovers only Instagram accounts assigned to that System User.
6. For customers outside the app's roles/testers, request the required
   Advanced Access through Meta App Review and complete Business Verification
   where Meta requires it. Configure the app as **Live** for production.
7. To receive Instagram webhook events, configure the HTTPS callback, verify
   token, and webhook fields in Meta, then subscribe each authorized account.
   See Meta's [Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business),
   [Instagram API with Facebook Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login),
   [System User assigned Instagram accounts](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_instagram_accounts),
   [System User access token management](https://developers.facebook.com/documentation/graph-api/reference/business/system_user_access_tokens),
   [webhook setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup),
   [webhook permissions](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields),
   [messaging](https://developers.facebook.com/documentation/business-messaging/instagram-messaging),
   [comment moderation](https://developers.facebook.com/documentation/instagram-platform/comment-moderation), and
   [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
   documentation.

The server validates the authenticated Supabase user, a signed and single-use
OAuth state, callback parameters, the returned token's `SYSTEM_USER` type, app
identity, business identity, granted scopes, and assigned Instagram assets.
It exchanges the authorization code at Meta's Graph OAuth endpoint, encrypts
the System User token with AES-256-GCM, and stores it with its business and
System User IDs. Unified Login System User tokens are not automatically
refreshed: renewing them through
Meta's Business System User access-token endpoint is part of the Business
Manager API and may require the separate `business_management` permission.
The app avoids that endpoint rather than requesting an extra permission. When
a token expires, the customer can reconnect; that action marks the connection
and its accounts as expired before starting OAuth. Valid, unexpired tokens are
left untouched. Tokens, authorization codes, and secrets are never sent to
browser code or written to application logs.

Before using this integration, apply these additive migrations in order to the
intended database:

1. `supabase/migrations/20261110000001_instagram_business_connections.sql`
2. `supabase/migrations/20261110000002_atomic_instagram_connection.sql`
3. `supabase/migrations/20261110000003_instagram_oauth_state.sql`
4. `supabase/migrations/20261110000004_instagram_login_connections.sql`
5. `supabase/migrations/20261110000005_instagram_unified_login.sql`
6. `supabase/migrations/20261111000001_unified_login_permissions.sql`

The fifth migration adds a separate table, account relationship, and
service-role-only RPC for the Unified Login System User token flow. The sixth
migration replaces that RPC's scope validation with the four Instagram
permissions required for connection; it does not drop or rewrite existing
columns, connections, or token records.
Existing legacy and direct Instagram Login connections remain in their
original table; when an account is reconnected through Unified Login, only its
account link changes. The migration does not delete customer accounts or
connection rows. Apply this migration manually; the app does not apply it
automatically.

Disconnecting deletes the local account record and may remove its now-unused
Unified Login token; unrelated legacy and direct Instagram Login connection
records are not deleted. To revoke the Meta grant itself, the user must also
remove EngageFlow from the connected Meta Business integration.

### Public comment reply proof of concept

The authenticated `GET /api/instagram/comments?accountId=<ACCOUNT_ID>&mediaId=<MEDIA_ID>`
route lists up to 50 top-level comments for media owned by the selected
connected account. If Meta returns a `nextCursor`, request the next page with
`&after=<NEXT_CURSOR>`; the route returns the next cursor or `null`. The server
verifies account ownership and media ownership before using the encrypted
System User token.

The `POST /api/instagram/comment-reply` route accepts
`{ "accountId": "...", "mediaId": "...", "commentId": "...", "message": "...", "confirm": true }`.
It requires a same-origin request, a currently visible top-level comment
on that exact media, and explicit `confirm: true`. The route checks the
comment directly rather than searching only the first comments page, and
rejects hidden comments and replies to another comment. It allows up to 2,200
Unicode code points in a reply. This is a server-side manual proof of concept;
it does not run automatically, and tests do not call Meta or publish a reply.
An uncertain POST result is not retried. Verify the comment in Instagram before
deciding what to do next.
Before posting, the operator must confirm the media is not a Live video;
this proof of concept does not determine Live status.

Duplicate submission protection is process-local and blocks another attempt
for the same account/comment for 15 minutes after the server begins the POST.
This reduces concurrent and immediate duplicate requests but is not durable
across server restarts or multiple serverless instances and does not guarantee
exactly-once delivery.

Meta's Unified Login comment reference documents Business Integration System
User tokens and `instagram_basic` plus `instagram_manage_comments` for comment
operations. The specific reply reference has a different token/permission
description. The current connection uses the Unified Login System User token
and does not request additional permissions; validate write compatibility on
an explicitly approved test comment before enabling broader use. Hidden
comments and comments on Live video are not replyable.

**Repository limitation:** this source tree currently has no Instagram webhook
route, account webhook-subscription call, or automation event processor. It
contains automation and webhook-event database tables, but connecting an
account alone cannot receive events or execute DM/comment automations. These
must be implemented and deployed before promising those features. Meta
requires an HTTPS webhook endpoint, account subscriptions, the corresponding
permissions, and compliance with Instagram's messaging windows (generally 24
hours; some Click-to-Direct-ad interactions allow up to 7 days).

Comment-to-DM drafts can be saved, edited, listed, and deleted after applying
the additive `20261111000002_comment_to_dm_drafts.sql` migration. Drafts remain
`DRAFT`; activation, webhook execution, and automatic Instagram replies are not
implemented.

### Automation lifecycle

The additive `20261111000003_automation_child_draft_only.sql` migration
restricts authenticated trigger and action writes to owner-owned drafts.
`20261111000004_automation_lifecycle.sql` adds owner-scoped lifecycle
transitions and an append-only lifecycle history separate from message
execution logs.

Allowed transitions are `DRAFT → ACTIVE` (Activate), `ACTIVE → PAUSED`
(Pause), and `PAUSED → ACTIVE` (Resume). Draft editing and deletion remain
draft-only; active and paused automations cannot be edited or deleted. There is
no transition back to draft.

Activation and resume are fail-closed. The database checks account ownership
and connection status, stored token expiry and permission scopes, automation
configuration, and a privileged runtime-readiness record. That record defaults
to unavailable and requires recent verification of Meta webhook subscription,
event ingestion, event processing, message execution, retry safety, and
idempotency. Comment-to-DM activation also requires a fresh, server-written
verification record matching the automation, connected account, and selected
media. Media evidence is created only by
`POST /api/automations/{id}/media-validation`, which loads an owned draft,
verifies media ownership and type with Meta using the server-side account
token, then records short-lived evidence. Authenticated users cannot modify
either readiness source, and runtime readiness has no application provisioning
path. No readiness attestation tool, webhook processor, or automation message
execution service currently exists in this application, so Activate and Resume
remain blocked; this feature does not send Instagram messages. Pause remains
available for an automation already stored as `ACTIVE`.

The lifecycle API is session-authenticated and uses the caller's Supabase
session (no service-role client):

- `GET /api/automations/readiness` returns readiness per owned automation.
- `POST /api/automations/{id}/lifecycle` accepts exactly
  `{"action":"ACTIVATE"}`, `{"action":"PAUSE"}`, or `{"action":"RESUME"}`.
- `GET /api/automations/{id}/lifecycle` returns owner-scoped lifecycle events.

Mutations require a same-origin `Origin` header. The database transition
function locks the owner-owned automation row, validates the transition and
readiness, and atomically updates status. A private transaction-scoped,
single-use permit and database trigger prevent direct inserts or updates from
changing status in either direction, including `ACTIVE`/`PAUSED` back to
`DRAFT`. The permit is inaccessible to application roles, is consumed by the
trigger for the exact prior/next status pair, and must be absent after the RPC
completes. Account-disconnection pauses also use the lifecycle RPC through a
database trigger; service-role RPC calls are restricted to pausing automations
whose account is no longer connected. The transition function locks the
Instagram account before the automation row for activation/resume so account
disconnects and lifecycle changes use a consistent lock order.
Its status trigger writes lifecycle events; authenticated users can read only
their own events and cannot insert, update, or delete them. The trigger records
new automation creation as well as status changes, including
account-disconnection pauses. Existing automations receive a baseline status
event at migration time; it does not claim their original status or creation
history is known.

Apply migrations manually in filename order after reviewing them against the
target Supabase schema. Do not mark runtime readiness true until every listed
capability is implemented and operationally verified. Future readiness
provisioning must be an out-of-band, reviewed operation by a trusted database
administrator (or a separately secured operator-only deployment job), never a
user-facing route or ordinary service-role request. Before provisioning,
verify each webhook, ingestion, processor, executor, retry, and idempotency
capability with operational evidence; update the singleton row in one audited
transaction with `last_verified_at` set by the database clock. Revoke or clear
readiness immediately when any capability regresses, and re-verify after
relevant deployments. The application currently provides no readiness write
API. Never expose a service-role key to browser code.

Run lifecycle and draft regressions with:

```powershell
npm run test:automation
npm run test:instagram
npm run test:auth
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

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
