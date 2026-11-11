import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Zap } from "lucide-react";
import { redirect } from "next/navigation";
import { CommentToDmBuilder } from "./comment-to-dm-builder";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Create automation",
};

export const instant = false;

type AutomationType = "comment_to_dm" | "dm_keyword";

const automationTypes: Record<
  AutomationType,
  { title: string; description: string }
> = {
  comment_to_dm: {
    title: "Comment-to-DM",
    description:
      "When someone comments a keyword on your post, automatically send them a private DM reply.",
  },
  dm_keyword: {
    title: "DM keyword reply",
    description:
      "When someone sends you a DM containing a keyword, automatically reply with your predefined message.",
  },
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
      className="group flex cursor-pointer flex-col gap-4 rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
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

export default async function NewAutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  if (type === "comment_to_dm") {
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      redirect("/login?redirectTo=%2Fautomations%2Fnew%3Ftype%3Dcomment_to_dm");
    }

    const { data: accounts, error: accountsError } = await supabase
      .from("instagram_accounts")
      .select("id, username, name, profile_picture_url")
      .eq("owner_id", authData.user.id)
      .eq("connection_status", "CONNECTED")
      .order("created_at", { ascending: true });

    if (accountsError) {
      throw new Error("Unable to load connected Instagram accounts.");
    }

    return <CommentToDmBuilder accounts={accounts ?? []} />;
  }

  if (type === "dm_keyword") {
    const selectedType = automationTypes[type];

    return (
      <div className="flex max-w-2xl flex-col gap-8">
        <Link
          href="/automations/new"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to automation types
        </Link>

        <div>
          <h1 className="text-2xl font-bold">
            Create {selectedType.title} automation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedType.description}
          </p>
        </div>

        <div
          role="status"
          className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
        >
          Automation setup is not available yet. No automation will be saved
          or activated from this page.
        </div>
      </div>
    );
  }

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
          description={automationTypes.comment_to_dm.description}
        />
        <TypeCard
          href="/automations/new?type=dm_keyword"
          Icon={Zap}
          title="DM keyword reply"
          description={automationTypes.dm_keyword.description}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        All automations use the official Meta Instagram API and respect applicable
        messaging windows and policy restrictions.
      </p>
    </div>
  );
}
