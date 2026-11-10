
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { User, Bell, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProfileSettingsForm } from "@/components/dashboard/ProfileSettingsForm";

export const metadata: Metadata = {
  title: "Settings",
};

async function ProfileData() {
  // Wait for the incoming request before initializing Supabase Auth.
  await connection();

  let userEmail = "";
  let userFullName = "";

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();

    userEmail = data.user?.email ?? "";
    userFullName =
      (data.user?.user_metadata?.full_name as string) ?? "";
  } catch {
    // Graceful fallback if profile data cannot be loaded.
  }

  return (
    <ProfileSettingsForm
      initialFullName={userFullName}
      email={userEmail}
    />
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="h-10 bg-muted rounded-lg" />
      <div className="h-10 bg-muted rounded-lg" />
      <div className="h-9 w-28 bg-muted rounded-lg" />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account and notification preferences
        </p>
      </div>

      {/* Profile section */}
      <section className="bg-card border border-border rounded-xl">
        <div className="flex items-center gap-2 p-5 border-b border-border font-semibold">
          <User className="h-4 w-4 text-primary" />
          Profile
        </div>

        <div className="p-5">
          <Suspense fallback={<ProfileSkeleton />}>
            <ProfileData />
          </Suspense>
        </div>
      </section>

      {/* Notifications section */}
      <section className="bg-card border border-border rounded-xl">
        <div className="flex items-center gap-2 p-5 border-b border-border font-semibold">
          <Bell className="h-4 w-4 text-primary" />
          Notifications
        </div>

        <div className="p-5">
          <p className="text-sm text-muted-foreground">
            Notification preferences will be available in a future phase.
          </p>
        </div>
      </section>

      {/* Danger zone */}
      <section className="bg-card border border-destructive/40 rounded-xl">
        <div className="flex items-center gap-2 p-5 border-b border-destructive/40 font-semibold text-destructive">
          <Trash2 className="h-4 w-4" />
          Danger zone
        </div>

        <div className="p-5 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account and all associated data. This action cannot
            be undone.
          </p>

          <button
            disabled
            className="self-start border border-destructive text-destructive text-sm font-medium px-4 py-2 rounded-lg hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete account
          </button>
        </div>
      </section>
    </div>
  );
}
