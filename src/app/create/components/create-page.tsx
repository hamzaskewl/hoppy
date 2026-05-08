"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { NavHeader } from "@/components/nav-header";

// Disable SSR for CreateLinkForm to avoid @solana/web3.js CURVE bundling issues
const CreateLinkForm = dynamic(
  () => import("@/app/create/components/create-link-form").then((mod) => ({ default: mod.CreateLinkForm })),
  { ssr: false }
);

export function CreatePage() {
  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Blurred tiled background - light mode */}
      <div
        className="absolute inset-0 -z-10 dark:hidden"
        style={{
          backgroundImage: "url('/hoppy-bg-tile.png')",
          backgroundRepeat: "repeat",
          filter: "blur(6px)",
        }}
      />
      {/* Blurred tiled background - dark mode */}
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
          {/* Header - card style with hoppy bunny image */}
          <div className="rounded-2xl bg-card border-2 border-border p-6 md:p-8 shadow-lg mb-8 max-w-2xl mx-auto">
            <div className="flex items-center gap-6 md:gap-8">
              {/* Hoppy Bunny Image - Circular */}
              <div className="flex-shrink-0">
                <div className="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden border-4 border-hop-400 shadow-lg bg-hop-100 dark:bg-hop-900">
                  <Image
                    src="/hopbunny.png"
                    alt="Hoppy bunny"
                    width={128}
                    height={128}
                    className="object-cover w-full h-full"
                  />
                </div>
              </div>

              {/* Text Content */}
              <div className="flex-1 space-y-2">
                <h1 className="text-xl md:text-2xl  tracking-tight">
                  Send Private Payments
                </h1>
                <p className="text-sm text-muted-foreground">
                  Create a claim link and share it. Enable privacy shielding to break the on-chain connection.
                </p>
              </div>
            </div>
          </div>

          {/* Layout: Centered form */}
          <div className="flex justify-center">
            <div className="w-full max-w-2xl">
              <CreateLinkForm />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
