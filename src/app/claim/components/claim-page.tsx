import Link from "next/link";
import Image from "next/image";
import { Home } from "lucide-react";
import { ClaimFlow } from "@/app/claim/components/claim-flow";
import { WalletButton } from "@/components/wallet-button";

function HoppyLogo({ size = 40 }: { size?: number }) {
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

export function ClaimPage() {
  return (
    <div className="min-h-screen py-12 px-4 relative">
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

      {/* Header */}
      <header className="max-w-md mx-auto mb-8">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground bg-card hover:bg-muted border border-border rounded-full transition-colors"
          >
            <Home className="w-4 h-4" />
            Home
          </Link>
          <WalletButton />
        </div>

        <div className="flex items-center gap-3">
          <HoppyLogo size={40} />
          <div>
            <h1 className="text-xl ">hoppy</h1>
            <p className="text-sm text-muted-foreground">Claim Private Payment</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <ClaimFlow />
    </div>
  );
}
