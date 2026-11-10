
import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Activity Logs",
};

export const instant = false;

const statusStyles: Record<string, string> = {
  received: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  processing: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  matched: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  sent: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  skipped: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function formatEventType(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function ActivityPage() {
  // Ensure request-time rendering before Supabase Auth loads the session.
  await connection();

  const supabase = await createClient();

  const { data: authData, error: authError } =
    await supabase.auth.getUser();

  if (authError || !authData.user) {
    redirect("/login?redirectTo=%2Factivity");
  }

  const { data: entries, error } = await supabase
    .from("activity_logs")
    .select("id, event_type, action_type, status, created_at")
    .eq("owner_id", authData.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error("Unable to load activity logs.");
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Activity Logs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A record of every webhook event received and automation execution
        </p>
      </div>

      {/* Table shell */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Time
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Event type
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Action
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Keyword
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>

            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Activity className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="mb-1 font-medium">
                        No events recorded yet
                      </p>
                      <p className="max-w-xs text-sm text-muted-foreground">
                        Connection events and future automation activity will
                        appear here.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>

                    <td className="px-4 py-3 font-medium">
                      {formatEventType(entry.event_type)}
                    </td>

                    <td className="px-4 py-3 text-muted-foreground">
                      {formatEventType(entry.action_type)}
                    </td>

                    <td className="px-4 py-3 text-muted-foreground">—</td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                          statusStyles[entry.status.toLowerCase()] ??
                          "bg-muted text-muted-foreground"
                        }`}
                      >
                        {entry.status.toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(statusStyles).map(([status, cls]) => (
          <span
            key={status}
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}
          >
            {status}
          </span>
        ))}
      </div>
    </div>
  );
}
