import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { ClaimFlow } from "@/components/claim/claim-flow";
import { WalletButton } from "@/components/wallet-button";

export default function ClaimPage() {
  return (
    <div className="min-h-screen py-12 px-4">
      {/* Header */}
      <header className="max-w-md mx-auto mb-8">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
          <WalletButton />
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl gradient-moss flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">mosskey</h1>
            <p className="text-sm text-muted-foreground">Claim Private Payment</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <ClaimFlow />

      {/* Privacy Notice */}
      <div className="max-w-md mx-auto mt-8 p-4 rounded-xl glass">
        <h3 className="font-semibold mb-2">How It Works</h3>
        <p className="text-sm text-muted-foreground">
          These funds are in a shielded pool. Your claim note proves ownership.
          Connect your wallet and the funds will be sent directly to you.
          Only you and the sender can see your destination address.
        </p>
      </div>
    </div>
  );
}
