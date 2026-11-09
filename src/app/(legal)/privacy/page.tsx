import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Learn how EngageFlow AI handles Google account, Instagram, automation, and activity information.",
};

function PolicySection({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="border-b border-border py-7 last:border-b-0">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-8">
        <p className="mb-2 text-sm font-medium text-primary">Legal</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-3 text-muted-foreground">
          This policy describes information handled by EngageFlow AI and how it
          is used to provide the service.
        </p>
      </header>

      <div className="rounded-xl border border-border bg-card px-5 sm:px-7">
        <PolicySection title="Information from Google sign-in">
          <p>
            Sign-in is provided by Google through Supabase Auth. The service
            receives account identity information made available by that flow,
            including your email address and, when provided, your name. The
            application uses the authenticated account ID and stores the
            profile name and email in its profile record. Google and Supabase
            may process additional information under their own privacy
            practices.
          </p>
        </PolicySection>

        <PolicySection title="Instagram account and permissions">
          <p>
            If you connect an eligible Instagram professional account, Meta
            provides account identifiers and display information such as the
            Instagram business ID, username, name, and profile-picture URL.
            The service also records connection status, business/system-user
            identifiers, token expiry information, and granted permission
            names needed to manage that connection.
          </p>
          <p>
            Depending on what you authorize and which features you configure,
            the integration can use permissions for basic Instagram account
            information, comment management, messaging, and business
            management. You choose which business assets to authorize through
            Meta. Meta independently controls its platform data and
            authorization.
          </p>
        </PolicySection>

        <PolicySection title="Comments, messages, and automation information">
          <p>
            The service is designed to process eligible Instagram comments and
            direct-message events for keyword-based automations. Meta webhook
            payloads may include comment or message text, event and account
            identifiers, sender or recipient identifiers, and event
            information. The database schema supports retaining webhook
            payloads for processing and deduplication.
          </p>
          <p>
            You may store automation names, keywords, target post identifiers
            or URLs, selected action types, and message or comment-reply text
            that you write. Activity records can include event/action types,
            status, matched keyword, recipient identifier, error information,
            timestamps, and metadata. Configure automations only for content
            and recipients you are authorized to address.
          </p>
        </PolicySection>

        <PolicySection title="Access tokens and security">
          <p>
            Instagram access tokens are encrypted by the application using
            AES-256-GCM before being stored in Supabase. The encryption key is
            server-side configuration and is not intended to be sent to the
            browser. Tokens are used by server-side integration code and are
            not displayed in the application interface. The application also
            uses Supabase row-level security and owner-matched database
            relationships to limit access to account-owned records.
          </p>
          <p>
            These are technical safeguards, not a guarantee that every
            incident or unauthorized access can be prevented. No independent
            security certification or audit is represented by this policy.
          </p>
        </PolicySection>

        <PolicySection title="Service providers">
          <p>
            The service relies on Google for sign-in, Supabase for
            authentication and database infrastructure, Vercel for application
            hosting, and Meta for Instagram authorization, APIs, and related
            platform services. These providers process information as needed
            to provide their services and under their own terms and privacy
            notices. Information may be processed in locations determined by
            those providers.
          </p>
        </PolicySection>

        <PolicySection title="Retention and deletion">
          <p>
            Information is retained as needed to provide and secure the
            service. There is no configured general retention period or
            automatic schedule for deleting webhook payloads or activity
            records in the implementation reviewed. OAuth state records expire
            after ten minutes and expired records are cleaned up when a new
            authorization is started.
          </p>
          <p>
            Disconnecting an Instagram account removes its connected account
            record and its automation configuration through the database’s
            account relationship. A shared encrypted business token is removed
            only when no other connected account uses it. Associated activity
            records are retained with account/automation references cleared;
            webhook payload records may also remain after disconnection.
            Disconnection is therefore not the same as a complete data
            deletion request.
          </p>
          <p>
            See the{" "}
            <Link
              href="/data-deletion"
              className="font-medium text-primary underline underline-offset-4"
            >
              data deletion instructions
            </Link>{" "}
            for the available in-product steps and the current support-contact
            limitation.
          </p>
        </PolicySection>

        <PolicySection title="Your privacy choices and rights">
          <p>
            Depending on where you live, you may have rights to request access
            to, correction of, or deletion of personal information, or to
            object to or restrict certain processing. You can disconnect an
            Instagram account in the authenticated app. For other privacy
            requests, a verified support contact must be published by the
            service operator before requests can be submitted through a
            designated channel.
          </p>
        </PolicySection>

        <PolicySection title="Policy details and contact">
          <p>
            This policy does not identify a legal entity, postal address,
            governing jurisdiction, or verified support email because none
            could be confirmed from the published project information. The
            service operator must provide the responsible entity and a
            working privacy/support contact before relying on this policy.
          </p>
        </PolicySection>
      </div>

      {/* TODO(owner): Add the verified legal operator name and privacy/support contact before publication. */}
    </article>
  );
}
