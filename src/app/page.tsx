import Link from "next/link";
import { Shield, ArrowRight, Lock, Zap, CreditCard } from "lucide-react";
import { NavHeader } from "@/components/nav-header";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <NavHeader />

      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-20">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl gradient-moss flex items-center justify-center glow">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">mosskey</h1>
          </div>

          {/* Tagline */}
          <p className="text-5xl md:text-6xl font-bold tracking-tight">
            <span className="gradient-text">Load. Redeem. Privately.</span>
          </p>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Send private payments on Solana. Deposit to a shielded pool, share the claim link,
            and let the recipient withdraw with no on-chain trace back to you.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Link
              href="/create"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl gradient-moss text-white font-semibold text-lg transition-all hover:scale-105 glow"
            >
              Send Payments
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/card"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl glass text-white font-semibold text-lg transition-all hover:bg-white/10"
            >
              <CreditCard className="w-5 h-5" />
              Virtual Cards
            </Link>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="border-t border-border py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Zap className="w-6 h-6" />}
              title="Shielded Deposits"
              description="Funds go directly into a privacy pool. No public trail."
            />
            <FeatureCard
              icon={<Shield className="w-6 h-6" />}
              title="Claim Notes"
              description="Cryptographic secrets prove ownership. Only you can claim."
            />
            <FeatureCard
              icon={<Lock className="w-6 h-6" />}
              title="Unlinkable Transfers"
              description="On-chain observers cannot connect sender to recipient."
            />
          </div>
        </div>
      </div>

      {/* Virtual Cards Section */}
      <div className="border-t border-border py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass text-sm text-moss-200">
                Powered by Starpay
              </div>
              <h2 className="text-3xl md:text-4xl font-semibold">
                Private Virtual Cards
              </h2>
              <p className="text-muted-foreground text-lg">
                Get instant virtual Visa or Mastercard cards. Pay with SOL, use anywhere online.
                No KYC required for virtual cards.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/card"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl gradient-moss text-white font-semibold transition-all hover:scale-105 glow-sm"
                >
                  Get a Virtual Card
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="p-8 rounded-2xl glass">
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-moss-500/20 flex items-center justify-center">
                    <CreditCard className="w-6 h-6 text-moss-400" />
                  </div>
                  <div>
                    <p className="font-semibold">Instant Issuance</p>
                    <p className="text-sm text-muted-foreground">Card ready in seconds</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-moss-500/20 flex items-center justify-center">
                    <Shield className="w-6 h-6 text-moss-400" />
                  </div>
                  <div>
                    <p className="font-semibold">Privacy First</p>
                    <p className="text-sm text-muted-foreground">No identity linked to card</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-moss-500/20 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-moss-400" />
                  </div>
                  <div>
                    <p className="font-semibold">Pay with SOL</p>
                    <p className="text-sm text-muted-foreground">From any Solana wallet</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <p>Built with privacy in mind</p>
          <p>Powered by Solana</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-2xl glass">
      <div className="w-12 h-12 rounded-xl bg-moss-500/20 flex items-center justify-center text-moss-400 mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
