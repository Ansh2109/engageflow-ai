import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms for using EngageFlow AI and its Instagram automation features.",
};

function TermsSection({
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

export default function TermsOfServicePage() {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-8">
        <p className="mb-2 text-sm font-medium text-primary">Legal</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Terms of Service
        </h1>
        <p className="mt-3 text-muted-foreground">
          These terms describe the basic conditions for using EngageFlow AI.
        </p>
      </header>

      <div className="rounded-xl border border-border bg-card px-5 sm:px-7">
        <TermsSection title="Service description">
          <p>
            EngageFlow AI provides tools to connect Instagram professional
            accounts, configure keyword-based rules, and send user-written
            replies to eligible Instagram interactions through Meta’s
            interfaces. Features depend on account eligibility, granted
            permissions, platform availability, and configuration.
          </p>
        </TermsSection>

        <TermsSection title="Account responsibilities">
          <p>
            You must use an account you control, keep your sign-in credentials
            secure, provide accurate account information, and promptly notify
            the operator if you suspect unauthorized use. You are responsible
            for actions taken through your account and for reviewing
            automations before enabling them.
          </p>
        </TermsSection>

        <TermsSection title="Authorized Instagram accounts">
          <p>
            Connect only Instagram accounts and business assets you own or are
            authorized to administer. You are responsible for obtaining any
            necessary permissions from the account owner and for maintaining
            the Meta authorization required for the service to operate.
          </p>
        </TermsSection>

        <TermsSection title="Acceptable use and messaging">
          <p>
            Do not use the service for unlawful, deceptive, abusive, harassing,
            or otherwise harmful activity. Do not send spam, unsolicited
            messages, or messages to people without a valid basis to contact
            them. Do not attempt to bypass rate limits, platform safeguards,
            access controls, or applicable messaging windows.
          </p>
          <p>
            You are responsible for message content, audience selection, and
            ensuring that each automation is appropriate for its context.
            Keyword matching does not guarantee that a recipient expects or
            wants a reply.
          </p>
        </TermsSection>

        <TermsSection title="Meta platform requirements">
          <p>
            Your use of Instagram through EngageFlow AI must comply with
            applicable Meta terms, developer policies, Instagram Community
            Guidelines, privacy obligations, and other laws that apply to you.
            Meta is a separate platform provider and may change, restrict, or
            discontinue APIs, permissions, or account access. No Meta
            endorsement or approval is implied by these terms.
          </p>
        </TermsSection>

        <TermsSection title="Automation limitations">
          <p>
            Automations operate only when their configured conditions match
            and Meta allows the requested operation. Delivery, timing, account
            access, and availability are not guaranteed. You must monitor
            results, pause or disconnect automations when appropriate, and
            promptly correct rules that produce unwanted or inaccurate
            messages.
          </p>
        </TermsSection>

        <TermsSection title="Suspension and termination">
          <p>
            The operator may suspend or terminate access when reasonably
            necessary to address suspected abuse, security risks, unlawful
            activity, violations of these terms or platform policies, or
            operational requirements. You may stop using the service and
            disconnect Instagram from the Instagram Accounts page. See the{" "}
            <Link
              href="/data-deletion"
              className="font-medium text-primary underline underline-offset-4"
            >
              data deletion instructions
            </Link>{" "}
            for the limitations of disconnection and data removal.
          </p>
        </TermsSection>

        <TermsSection title="Availability and changes">
          <p>
            The service is provided subject to maintenance, outages, network
            conditions, third-party changes, and other limitations. The
            operator may modify or discontinue features. No uninterrupted or
            error-free availability is promised.
          </p>
        </TermsSection>

        <TermsSection title="Disclaimer and liability">
          <p>
            To the extent permitted by applicable law, the service is provided
            on an “as available” basis without a promise that it will meet
            every business need or achieve a particular result. Nothing in
            these terms excludes liability that cannot lawfully be excluded.
            Any further liability allocation must be reviewed and completed
            by the service operator for the applicable jurisdiction.
          </p>
        </TermsSection>

        <TermsSection title="Governing law and operator contact">
          <p>
            The responsible legal operator, governing law, and dispute venue
            have not been identified in the project information available for
            this page. The operator must complete those details before using
            these terms as an enforceable customer agreement.
          </p>
          <p>
            A verified support/legal contact has not been published. The
            operator must add a working contact method for notices and
            customer requests.
          </p>
        </TermsSection>
      </div>

      {/* TODO(owner): Confirm the legal operator, liability terms, governing law, dispute venue, and support contact. */}
    </article>
  );
}
