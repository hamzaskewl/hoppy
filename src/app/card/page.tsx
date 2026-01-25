import { CardPurchaseFlow } from "@/components/card/card-purchase-flow";
import { NavHeader } from "@/components/nav-header";
import { CreditCard, ShieldCheck, Zap } from "lucide-react";

export default function CardPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <NavHeader />

      <main className="flex-1 px-4 py-12">
        <div className="max-w-5xl mx-auto space-y-12">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Private Virtual Cards
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Get instant virtual Visa or Mastercard cards. Pay with SOL from any wallet.
            </p>
          </div>

          {/* Features row */}
          <div className="grid sm:grid-cols-3 gap-4">
            <FeatureChip
              icon={<CreditCard className="w-4 h-4" />}
              text="Instant issuance"
            />
            <FeatureChip
              icon={<ShieldCheck className="w-4 h-4" />}
              text="Privacy-first"
            />
            <FeatureChip
              icon={<Zap className="w-4 h-4" />}
              text="Pay with SOL"
            />
          </div>

          {/* Main flow */}
          <CardPurchaseFlow />

          {/* Info section */}
          <div className="grid md:grid-cols-2 gap-6 mt-12">
            <div className="p-6 rounded-2xl glass space-y-3">
              <h3 className="font-semibold">How it works</h3>
              <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                <li>Choose your card value and type</li>
                <li>Pay the SOL amount to the provided address</li>
                <li>Receive your virtual card details via email</li>
                <li>Use it anywhere Visa/Mastercard is accepted online</li>
              </ol>
            </div>
            <div className="p-6 rounded-2xl glass space-y-3">
              <h3 className="font-semibold">Privacy benefits</h3>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>No KYC required for virtual cards</li>
                <li>Pay from any Solana wallet</li>
                <li>Card is not linked to your identity</li>
                <li>Use shielded funds for maximum privacy</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function FeatureChip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl glass text-sm">
      <span className="text-moss-400">{icon}</span>
      <span>{text}</span>
    </div>
  );
}
