"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { NavHeader } from "@/components/nav-header";

const PrivateCardFlow = dynamic(
  () => import("@/app/card/components/private-card-flow").then((mod) => ({ default: mod.PrivateCardFlow })),
  { ssr: false }
);

export function CardPage() {
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
          {/* Header */}
          <div className="rounded-2xl bg-card border-2 border-border p-6 md:p-8 shadow-lg mb-8 max-w-2xl mx-auto">
            <div className="flex items-center gap-6 md:gap-8">
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

              <div className="flex-1 space-y-2">
                <h1 className="text-xl md:text-2xl tracking-tight">Private Virtual Cards</h1>
                <p className="text-sm text-muted-foreground">
                  Buy a virtual Visa or Mastercard with SOL via Bitrefill. Get a private claim link to share or keep.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-center">
            <div className="w-full max-w-xl">
              <PrivateCardFlow />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
