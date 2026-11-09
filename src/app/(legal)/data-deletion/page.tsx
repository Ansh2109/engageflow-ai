import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Data Deletion Instructions",
  description:
    "How to disconnect Instagram and request deletion of EngageFlow AI data.",
};

function DeletionSection({
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

export default function DataDeletionPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-8">
        <p className="mb-2 text-sm font-medium text-primary">Privacy</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Data Deletion Instructions
        </h1>
        <p className="mt-3 text-muted-foreground">
          Disconnecting Instagram and requesting deletion are separate
          actions. Review the details below before proceeding.
        </p>
      </header>

      <div className="rounded-xl border border-border bg-card px-5 sm:px-7">
        <DeletionSection title="Disconnect an Instagram account">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Sign in to your EngageFlow AI account.</li>
            <li>
              Open{" "}
              <Link
                href="/instagram"
                className="font-medium text-primary underline underline-offset-4"
              >
                Instagram Accounts
              </Link>{" "}
              from the dashboard navigation.
            </li>
            <li>
              Select <strong>Disconnect</strong> beside the account you want to
              unlink and confirm the resulting status in the app.
            </li>
          </ol>
          <p>
            Disconnect removes the linked Instagram account record and its
            automation configuration. A shared business access token is kept
            only while another connected account uses it. This action does not
            revoke your grant in Meta’s Business Integrations settings; remove
            EngageFlow there as well if you want to revoke Meta authorization.
          </p>
        </DeletionSection>

        <DeletionSection title="Request deletion of account information">
          <p>
            The current application does not provide a working self-service
            account deletion control; the Delete account control in Settings
            is disabled. To request deletion of your EngageFlow profile and
            other associated information, a verified support contact must be
            published by the service operator. No support email or request
            form could be verified in the existing application.
          </p>
          <p>
            Until the operator publishes that contact method, this page cannot
            accept or route deletion requests. Do not send passwords, access
            tokens, or other secrets in a request.
          </p>
        </DeletionSection>

        <DeletionSection title="Automation and activity information">
          <p>
            Disconnecting an account deletes its automation configuration via
            the database relationships. Activity-log entries are retained for
            audit history, with account and automation links cleared.
            Webhook-event payload records may also remain after disconnect.
            Request deletion of those records explicitly after the operator
            publishes a working support channel.
          </p>
          <p>
            A request can identify the Google sign-in email, the Instagram
            username to disconnect or delete, and the categories of data
            requested for deletion. Do not include passwords, Meta access
            tokens, or full message contents unless the operator provides a
            secure, appropriate channel.
          </p>
        </DeletionSection>

        <DeletionSection title="Verification and processing">
          <p>
            Before acting on a request, the operator should verify that the
            requester controls the relevant EngageFlow account, for example
            through an authenticated session or a confirmation sent to the
            account’s verified email. Requests concerning an Instagram asset
            may require verifying the requester’s authority over that asset.
          </p>
          <p>
            No deletion-request intake or processing workflow is implemented
            in the current application, and no completion timeline is
            established. The operator must publish a verified contact,
            verification procedure, and processing timeline before accepting
            customer requests.
          </p>
        </DeletionSection>

        <DeletionSection title="Retention exceptions">
          <p>
            Some records may need to be retained where required for legal
            obligations, security, fraud prevention, dispute resolution, or
            service integrity. The current application has no configured
            general retention schedule for activity logs or webhook payloads.
            The operator must define and disclose applicable retention
            periods and exceptions.
          </p>
        </DeletionSection>
      </div>

      {/* TODO(owner): Publish verified support contact, request intake/verification process, and deletion processing timeline. */}
    </article>
  );
}
