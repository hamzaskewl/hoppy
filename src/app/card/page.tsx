"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { NavHeader } from "@/components/nav-header";
import { CardPurchaseFlow } from "@/components/card/card-purchase-flow";
import { Shield, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

// Dynamic import for Privacy Cash component (server-side libs)
const PrivateCardFlow = dynamic(
  () => import("@/components/card/private-card-flow").then((mod) => ({ default: mod.PrivateCardFlow })),
  { ssr: false }
);

type CardMode = "standard" | "private";

export default function CardPage() {
  const [mode, setMode] = useState<CardMode>("private");

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Carrot background - light mode */}
      <div
        className="absolute inset-0 -z-10 dark:hidden"
        style={{
          backgroundImage: "url('/hoppy-carrot.png')",
          backgroundRepeat: "repeat",
          backgroundSize: "400px",
          filter: "blur(4px)",
          opacity: 0.7,
        }}
      />
      {/* Dark background - dark mode */}
      <div
        className="absolute inset-0 -z-10 hidden dark:block"
        style={{
          backgroundImage: "url('/hoppy-bgblack.png')",
          backgroundRepeat: "repeat",
          filter: "blur(6px)",
        }}
      />
      <NavHeader />

      <main className="flex-1 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Header - card style like create page */}
          <div className="rounded-2xl bg-card border-2 border-border p-6 md:p-8 shadow-lg mb-8 max-w-2xl mx-auto">
            <div className="text-center space-y-4">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Private Virtual Cards
              </h1>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                Instant virtual Visa/Mastercard. Pay with SOL through Privacy Cash - no KYC, no trace.
              </p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="max-w-md mx-auto mb-8">
            <div className="grid grid-cols-2 gap-2 p-1 bg-card rounded-xl border-2 border-border">
              <button
                onClick={() => setMode("private")}
                className={cn(
                  "flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-all",
                  mode === "private"
                    ? "bg-hop-500 text-white shadow-md"
                    : "hover:bg-secondary"
                )}
              >
                <Shield className="w-4 h-4" />
                Private (Gift Link)
              </button>
              <button
                onClick={() => setMode("standard")}
                className={cn(
                  "flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-all",
                  mode === "standard"
                    ? "bg-hop-500 text-white shadow-md"
                    : "hover:bg-secondary"
                )}
              >
                <Mail className="w-4 h-4" />
                Standard (Email)
              </button>
            </div>
          </div>

          {/* Layout: Centered flow */}
          <div className="flex justify-center">
            <div className="w-full max-w-xl">
              {mode === "private" ? <PrivateCardFlow /> : <CardPurchaseFlow />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
