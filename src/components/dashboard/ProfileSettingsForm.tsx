"use client";

import { useActionState } from "react";
import { updateProfile, type AuthActionResult } from "@/app/(auth)/actions";
import { Loader2, CheckCircle2 } from "lucide-react";

interface ProfileSettingsFormProps {
  initialFullName: string;
  email: string;
}

export function ProfileSettingsForm({
  initialFullName,
  email,
}: ProfileSettingsFormProps) {
  const [state, formAction, isPending] = useActionState<AuthActionResult | null, FormData>(
    updateProfile,
    null
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded-lg">
          {state.error}
        </div>
      )}

      {state?.success && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-sm p-3 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {state.message}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fullName" className="text-sm font-medium">
          Full name
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          defaultValue={initialFullName}
          placeholder="Your name"
          className="border border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          type="email"
          disabled
          value={email}
          className="border border-input rounded-lg px-3 py-2 text-sm bg-muted text-muted-foreground cursor-not-allowed"
        />
        <p className="text-xs text-muted-foreground">
          Email address changes must be requested through account security.
        </p>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="self-start inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          "Save changes"
        )}
      </button>
    </form>
  );
}
