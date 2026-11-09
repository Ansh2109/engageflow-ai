"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Zap, Menu, X, LayoutDashboard, Activity, Settings, LogOut } from "lucide-react";
import { Instagram } from "@/components/icons/Instagram";
import { signOut } from "@/app/(auth)/actions";

const navItems = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/automations", label: "Automations", Icon: Zap },
  { href: "/activity", label: "Activity Logs", Icon: Activity },
  { href: "/instagram", label: "Instagram Account", Icon: Instagram },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="md:hidden">
      {/* Top bar */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border bg-card">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold">
          <Zap className="h-5 w-5 text-primary" />
          EngageFlow AI
        </Link>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <nav
            className="absolute left-0 top-14 w-64 bg-card border-r border-border h-screen py-4 px-2 flex flex-col gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {navItems.map(({ href, label, Icon }) => {
              const isActive =
                href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              );
            })}
            <div className="pt-2 mt-auto border-t border-border">
              <form action={signOut}>
                <button
                  type="submit"
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  Sign out
                </button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
