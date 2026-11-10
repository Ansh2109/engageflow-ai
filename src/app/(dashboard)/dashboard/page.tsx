import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  Zap,
  Pause,
  CheckCircle,
  XCircle,
  Plus,
  ArrowRight,
} from "lucide-react";
import { Instagram } from "@/components/icons/Instagram";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard",
};

async function InstagramConnectionBanner() {
  await connection();
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;

  const { data: accounts, error } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("owner_id", authData.user.id)
    .eq("connection_status", "CONNECTED");
  if (error) throw new Error("Unable to load Instagram connection status.");

  const count = accounts.length;
  return count > 0 ? (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/30 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <Instagram className="h-5 w-5 shrink-0 text-green-700 dark:text-green-300" />
        <div>
          <p className="text-sm font-medium text-green-900 dark:text-green-200">
            {count} Instagram {count === 1 ? "account" : "accounts"} connected
          </p>
          <p className="text-xs text-green-700 dark:text-green-400">
            Your connected professional accounts are ready to manage.
          </p>
        </div>
      </div>
      <Link
        href="/instagram"
        className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800"
      >
        Manage accounts
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  ) : (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <Instagram className="h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            No Instagram account connected
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Connect your Instagram Professional account to start automating.
          </p>
        </div>
      </div>
      <Link
        href="/instagram"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
      >
        Connect account
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/** Stat card displayed on the dashboard overview */
function StatCard({
  label,
  value,
  Icon,
  className = "",
}: {
  label: string;
  value: string | number;
  Icon: React.ElementType;
  className?: string;
}) {
  return (
    <div className={`bg-card border border-border rounded-xl p-5 flex flex-col gap-3 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground font-medium">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
      <span className="text-3xl font-bold">{value}</span>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview of your automations and recent activity
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

      <Suspense fallback={<div className="h-20 animate-pulse rounded-xl bg-muted" />}>
        <InstagramConnectionBanner />
      </Suspense>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active automations" value={0} Icon={Zap} />
        <StatCard label="Paused automations" value={0} Icon={Pause} />
        <StatCard label="Successful sends" value={0} Icon={CheckCircle} />
        <StatCard label="Failed sends" value={0} Icon={XCircle} />
      </div>

      {/* Recent activity */}
      <div className="bg-card border border-border rounded-xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">Recent activity</h2>
          <Link
            href="/activity"
            className="text-sm text-primary hover:underline"
          >
            View all
          </Link>
        </div>
        {/* Empty state */}
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Zap className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="font-medium mb-1">No activity yet</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Once your automations start running, execution results will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
