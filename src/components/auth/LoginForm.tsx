"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInWithGoogle, type AuthActionResult } from "@/app/(auth)/actions";
import { Loader2 } from "lucide-react";
import { safeInternalRedirect, type OAuthFailure } from "@/lib/auth/flow";

const AUTH_ERROR_MESSAGES: Record<OAuthFailure, string> = {
  oauth_failed: "Google sign-in could not be completed. Please try again.",
  oauth_cancelled: "Google sign-in was cancelled.",
  profile_missing:
    "Your account profile could not be initialized. Please try again or contact support.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = safeInternalRedirect(searchParams.get("redirectTo"));
  const errorCode = searchParams.get("error");
  const initialError =
    errorCode && errorCode in AUTH_ERROR_MESSAGES
      ? AUTH_ERROR_MESSAGES[errorCode as OAuthFailure]
      : undefined;
  const [state, formAction, isPending] = useActionState<AuthActionResult | null, FormData>(
    signInWithGoogle,
    initialError ? { error: initialError } : null
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      {state?.error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded-lg">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center justify-center gap-3 border border-border bg-background text-foreground font-semibold py-3 rounded-lg text-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Connecting to Google...
          </>
        ) : (
          <>
            <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.73 7.18l7.64 5.93c4.46-4.13 7.13-10.2 7.13-17.58Z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.64-5.93C30.13 37.75 27.42 38.6 24 38.6c-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
              <path fill="#FBBC05" d="M10.53 28.69a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" />
            </svg>
            Continue with Google
          </>
        )}
      </button>
    </form>
  );
}
