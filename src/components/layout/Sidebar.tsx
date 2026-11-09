"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Zap,
  Activity,
  Settings,
  LogOut,
} from "lucide-react";
import { Instagram } from "@/components/icons/Instagram";
import { signOut } from "@/app/(auth)/actions";

const navItems = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/automations", label: "Automations", Icon: Zap },
  { href: "/activity", label: "Activity Logs", Icon: Activity },
  { href: "/instagram", label: "Instagram Account", Icon: Instagram },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-card min-h-screen">
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold text-lg">
          <Zap className="h-5 w-5 text-primary" />
          EngageFlow AI
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 flex flex-col gap-1">
        {navItems.map(({ href, label, Icon }) => {
          const isActive =
            href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
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
      </nav>

      {/* Bottom: sign out */}
      <form action={signOut} className="p-2 border-t border-border">
        <button
          type="submit"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </form>
    </aside>
  );
}
