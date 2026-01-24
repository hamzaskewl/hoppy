import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { CreateLinkForm } from "@/components/create/create-link-form";
import { WalletButton } from "@/components/wallet-button";

export default function CreatePage() {
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
            <p className="text-sm text-muted-foreground">Create Payment Link</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <CreateLinkForm />

      {/* Info Section */}
      <div className="max-w-md mx-auto mt-8 p-4 rounded-xl glass">
        <h3 className="font-semibold mb-2">How it works</h3>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Connect your wallet and enter the amount</li>
          <li>Deposit directly into the shielded pool</li>
          <li>Receive a private claim link with your secret note</li>
          <li>Share the link - only the holder can claim the funds</li>
        </ol>
      </div>
    </div>
  );
}
