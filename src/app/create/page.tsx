"use client";

import dynamic from "next/dynamic";
import { NavHeader } from "@/components/nav-header";

// Disable SSR for CreateLinkForm to avoid @solana/web3.js CURVE bundling issues
const CreateLinkForm = dynamic(
  () => import("@/components/create/create-link-form").then((mod) => ({ default: mod.CreateLinkForm })),
  { ssr: false }
);

export default function CreatePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <NavHeader />

      <main className="flex-1 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center space-y-4 mb-8">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Send Private Payments
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Deposit to a shielded pool and share a claim link. The recipient withdraws with no
              on-chain trace back to you.
            </p>
          </div>

          {/* Layout: Centered form with right sidebar */}
          <div className="relative flex justify-center">
            {/* Main Content - Centered */}
            <div className="w-full max-w-xl">
              <CreateLinkForm />
            </div>

            {/* Info Section - Positioned to the right of center (hidden on smaller screens) */}
            <div className="hidden xl:block absolute left-[calc(50%+320px)] top-0 w-72 space-y-4">
              <div className="p-5 rounded-2xl bg-card border-2 border-border sticky top-4">
                <h3 className="font-semibold mb-3 text-sm">How it works</h3>
                <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>Connect your wallet and enter the amount</li>
                  <li>Deposit directly into the shielded pool</li>
                  <li>Receive a private claim link with your secret note</li>
                  <li>Share the link - only the holder can claim the funds</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
