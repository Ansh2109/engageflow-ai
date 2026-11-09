import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Zap } from "lucide-react";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-muted/40">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 font-bold text-xl mb-8">
          <Zap className="h-6 w-6 text-primary" />
          EngageFlow AI
        </Link>

        {/* Card */}
        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <h1 className="text-2xl font-bold mb-1">Welcome back</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Sign in to your EngageFlow AI account
          </p>

          <Suspense fallback={<div className="h-12" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Sign in securely with your Google account
        </p>
      </div>
    </div>
  );
}
