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
    <div className="min-h-screen flex flex-col relative">
      {/* Blurred tiled background */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage: "url('/hoppy-bg-tile.png')",
          backgroundRepeat: "repeat",
          filter: "blur(6px)",
        }}
      />
      <NavHeader />

      <main className="flex-1 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Header - card only around title and description */}
          <div className="rounded-2xl bg-card border-2 border-border p-6 md:p-8 shadow-lg mb-8 max-w-2xl mx-auto">
            <div className="text-center space-y-4">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Send Private Payments
              </h1>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                Deposit to a shielded pool and share a claim link. The recipient withdraws with no
                on-chain trace back to you.
              </p>
            </div>
          </div>

          {/* Layout: Centered form */}
          <div className="flex justify-center">
            <div className="w-full max-w-xl">
              <CreateLinkForm />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
