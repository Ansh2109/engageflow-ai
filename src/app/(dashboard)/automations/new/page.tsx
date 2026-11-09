import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "Create automation",
};

/** Automation type selector card */
function TypeCard({
  href,
  Icon,
  title,
  description,
}: {
  href: string;
  Icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4 hover:border-primary/50 hover:bg-muted/30 transition-colors group"
    >
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </Link>
  );
}

export default function NewAutomationPage() {
  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      {/* Back link */}
      <Link
        href="/automations"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to automations
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Choose automation type</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select the type of automation you want to create.
        </p>
      </div>

      {/* Type cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TypeCard
          href="/automations/new?type=comment_to_dm"
          Icon={MessageSquare}
          title="Comment-to-DM"
          description="When someone comments a keyword on your post, automatically send them a private DM reply."
        />
        <TypeCard
          href="/automations/new?type=dm_keyword"
          Icon={Zap}
          title="DM keyword reply"
          description="When someone sends you a DM containing a keyword, automatically reply with your predefined message."
        />
      </div>

      <p className="text-xs text-muted-foreground">
        All automations use the official Meta Instagram API and respect applicable
        messaging windows and policy restrictions.
      </p>
    </div>
  );
}
