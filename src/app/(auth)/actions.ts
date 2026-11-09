"use server";

import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/auth/site-url";
import {
  getLogoutRedirect,
  safeInternalRedirect,
  signOutSession,
} from "@/lib/auth/flow";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export interface AuthActionResult {
  error?: string;
  success?: boolean;
  message?: string;
}

export async function signInWithGoogle(
  _prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  let oauthUrl: string;
  try {
    const supabase = await createClient();
    const next = safeInternalRedirect(formData.get("redirectTo")?.toString());
    const callbackUrl = new URL("/api/auth/callback", getSiteUrl());
    callbackUrl.searchParams.set("next", next);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl.toString() },
    });

    if (error || !data.url) {
      console.error("[Auth] Unable to start Google OAuth.", error?.message);
      return {
        error: "Unable to start Google sign-in. Please try again.",
      };
    }

    oauthUrl = data.url;
  } catch (error) {
    console.error(
      "[Auth] Unable to start Google OAuth.",
      error instanceof Error ? error.message : "Unknown server error"
    );
    return {
      error: "Unable to start Google sign-in. Please try again.",
    };
  }

  redirect(oauthUrl);
}

/**
 * Server Action for Updating Profile (e.g. Full Name).
 */
export async function updateProfile(
  _prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const fullName = formData.get("fullName")?.toString().trim();
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: {
      full_name: fullName || "",
    },
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/settings");
  return { success: true, message: "Profile updated successfully." };
}

/**
 * Server Action for User Sign Out.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await signOutSession(() => supabase.auth.signOut());
  revalidatePath("/", "layout");
  redirect(getLogoutRedirect(getSiteUrl()).toString());
}
