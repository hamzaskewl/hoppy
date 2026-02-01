"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { CreditCard, Send, Sun, Moon, HelpCircle } from "lucide-react";
import { WalletButton } from "./wallet-button";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/create", label: "Send Payments", icon: Send },
  { href: "/card", label: "Virtual Cards", icon: CreditCard },
  { href: "/how-it-works", label: "How it works", icon: HelpCircle },
];

// Hoppy Logo Component - Uses the bunny image
function HoppyLogo({ size = 36 }: { size?: number }) {
  return (
    <div 
      className="rounded-full overflow-hidden bg-hop-200 dark:bg-hop-800 border-2 border-hop-400 dark:border-hop-600 shadow-sm"
      style={{ width: size, height: size }}
    >
      <Image
        src="/hoppy-logo.png"
        alt="hoppy"
        width={size}
        height={size}
        className="object-cover"
        priority
      />
    </div>
  );
}

export function NavHeader() {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState(false);

  // Check for stored preference on mount, default to light mode
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const shouldBeDark = stored === "dark";
    setIsDark(shouldBeDark);
    document.documentElement.classList.toggle("dark", shouldBeDark);
  }, []);

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    document.documentElement.classList.toggle("dark", newIsDark);
    localStorage.setItem("theme", newIsDark ? "dark" : "light");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <HoppyLogo size={36} />
            <span className="font-semibold text-lg">hoppy</span>
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
                      ? "bg-hop-400/20 text-hop-600 dark:text-hop-300"
                      : "text-muted-foreground hover:text-foreground hover:bg-hop-100 dark:hover:bg-hop-900/30"
                  )}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://x.com/hoppyprivacy"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="Follow us on X"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="Toggle theme"
          >
            {isDark ? (
              <Sun className="w-5 h-5 text-honey-500" />
            ) : (
              <Moon className="w-5 h-5 text-hop-600" />
            )}
          </button>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
