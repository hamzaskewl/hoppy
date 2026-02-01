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
    <div className="min-h-screen flex flex-col bg-background">
      <NavHeader />

      <main className="flex-1 px-4 py-12">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center space-y-2 mb-8">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Virtual Cards
            </h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              Instant virtual Visa/Mastercard. Pay with SOL, no KYC required.
            </p>
          </div>

          {/* Mode Toggle */}
          <div className="max-w-md mx-auto mb-8">
            <div className="grid grid-cols-2 gap-2 p-1 bg-secondary rounded-xl border-2 border-border">
              <button
                onClick={() => setMode("private")}
                className={cn(
                  "flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-all",
                  mode === "private"
                    ? "bg-hop-500 text-white shadow-md"
                    : "hover:bg-card"
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
                    : "hover:bg-card"
                )}
              >
                <Mail className="w-4 h-4" />
                Standard (Email)
              </button>
            </div>
          </div>

          {/* Layout: Centered flow with right sidebar */}
          <div className="relative flex justify-center">
            {/* Main flow - Centered */}
            <div className="w-full max-w-3xl">
              {mode === "private" ? <PrivateCardFlow /> : <CardPurchaseFlow />}
            </div>

            {/* Info section - Positioned to the right of center (hidden on smaller screens) */}
            <div className="hidden xl:block absolute left-[calc(50%+400px)] top-0 w-72 space-y-4">
              <div className="p-4 rounded-xl bg-card border-2 border-border space-y-2 sticky top-4">
                <h3 className="font-semibold text-sm">
                  {mode === "private" ? "Private Mode" : "Standard Mode"}
                </h3>
                <ol className="space-y-1 text-xs text-muted-foreground list-decimal list-inside">
                  {mode === "private" ? (
                    <>
                      <li>Choose card value and type</li>
                      <li>Pay via Privacy Cash pool</li>
                      <li>Receive a shareable claim link</li>
                      <li>Share link - only holders can view card</li>
                    </>
                  ) : (
                    <>
                      <li>Choose card value and type</li>
                      <li>Enter your email address</li>
                      <li>Pay SOL to the provided address</li>
                      <li>Receive card details via email</li>
                    </>
                  )}
                </ol>
              </div>
              <div className="p-4 rounded-xl bg-card border-2 border-border space-y-2">
                <h3 className="font-semibold text-sm">Privacy Level</h3>
                {mode === "private" ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-hop-600 dark:text-hop-400">
                      <Shield className="w-4 h-4" />
                      <span className="text-xs font-medium">Maximum Privacy</span>
                    </div>
                    <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
                      <li>No email required</li>
                      <li>Payment via Privacy Cash</li>
                      <li>Card provider can&apos;t trace you</li>
                      <li>Shareable gift link</li>
                    </ul>
                  </div>
                ) : (
                  <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
                    <li>Email required for delivery</li>
                    <li>Direct SOL payment</li>
                    <li>Card not linked to identity</li>
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
