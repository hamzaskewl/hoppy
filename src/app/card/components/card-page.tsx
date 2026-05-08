"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { NavHeader } from "@/components/nav-header";
import { CardPurchaseFlow } from "@/app/card/components/card-purchase-flow";
import { Mail, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// Dynamic import for the private card flow (server-side libs)
const PrivateCardFlow = dynamic(
  () => import("@/app/card/components/private-card-flow").then((mod) => ({ default: mod.PrivateCardFlow })),
  { ssr: false }
);

type CardMode = "standard" | "private";

export function CardPage() {
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
          {/* Paused Warning Banner */}
          <div className="max-w-2xl mx-auto mb-6">
            <div className="rounded-xl bg-amber-50 dark:bg-amber-400/50 border border-amber-300 dark:border-amber-400 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-900 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className=" text-amber-800 dark:text-gray-900">
                  Virtual Cards Temporarily Paused
                </p>
                <p className="text-amber-700 dark:text-gray-800 mt-1">
                  Starpay has stopped issuing cards during the hackathon and we&apos;ve paused our implementation. We&apos;ll bring this feature back once Starpay resumes their services. Check back soon!
                </p>
              </div>
            </div>
          </div>

          {/* Header - card style with hoppy image */}
          <div className="rounded-2xl bg-card border-2 border-border p-6 md:p-8 shadow-lg mb-8 max-w-2xl mx-auto">
            <div className="flex items-center gap-6 md:gap-8">
              {/* Hoppy CC Image - Circular */}
              <div className="flex-shrink-0">
                <div className="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden border-4 border-hop-400 shadow-lg bg-[#1a1a1a]">
                  <Image
                    src="/hoppycc.png"
                    alt="Hoppy with credit card"
                    width={128}
                    height={128}
                    className="object-cover w-full h-full"
                  />
                </div>
              </div>

              {/* Text Content */}
              <div className="flex-1 space-y-2">
                <h1 className="text-xl md:text-2xl  tracking-tight">
                  Private Virtual Cards
                </h1>
                <p className="text-sm text-muted-foreground">
                  Instant virtual Visa/Mastercard. Pay with SOL privately via Umbra — no KYC, no trace.
                </p>
              </div>
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
                <Image src="/bunnypriv.png" alt="Private" width={28} height={28} className="w-7 h-7" />
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
              {mode === "private" ? <PrivateCardFlow disabled /> : <CardPurchaseFlow disabled />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
