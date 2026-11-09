import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "Automations",
};

export default function AutomationsPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Automations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your keyword-triggered Instagram automations
          </p>
        </div>
        <Link
          href="/automations/new"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-4 py-2.5 rounded-lg text-sm hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          New automation
        </Link>
      </div>

      {/* Empty state */}
      <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-5">
          <Zap className="h-7 w-7 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-2">No automations yet</h2>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          Create your first automation to automatically reply to comments or DMs
          when someone uses a keyword.
        </p>
        <Link
          href="/automations/new"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-5 py-2.5 rounded-lg text-sm hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Create automation
        </Link>
      </div>
    </div>
  );
}
