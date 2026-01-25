"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield, CreditCard, Send } from "lucide-react";
import { WalletButton } from "./wallet-button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/create", label: "Send Payments", icon: Send },
  { href: "/card", label: "Virtual Cards", icon: CreditCard },
];

export function NavHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl gradient-moss flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-lg">mosskey</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-moss-500/20 text-moss-200"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <WalletButton />
      </div>
    </header>
  );
}
