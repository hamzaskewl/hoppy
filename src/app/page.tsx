import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CreditCard } from "lucide-react";
import { NavHeader } from "@/components/nav-header";

// Hoppy Logo Component - Uses the bunny image
function HoppyLogo({ size = 64 }: { size?: number }) {
  return (
    <div 
      className="rounded-full overflow-hidden bg-hop-200 dark:bg-hop-800 border-3 border-hop-400 dark:border-hop-500 shadow-lg"
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

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <NavHeader />

      {/* Hero Section */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-4 py-20 min-h-[90vh] relative bg-cover bg-center"
        style={{ backgroundImage: "url('/landing-page-bg.jpg')" }}
      >
        <div className="absolute inset-0 bg-background/50 z-0" aria-hidden />
        <div className="max-w-4xl mx-auto text-center space-y-8 relative z-10">
          {/* Logo */}
          <div className="flex items-center justify-center mb-8">
            <HoppyLogo size={72} />
          </div>

          {/* Tagline */}
          <p className="text-5xl md:text-6xl font-bold tracking-tight">
            <span className="text-hop-700 dark:text-hop-300">Load. Redeem. Privately.</span>
          </p>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Send private payments on Solana. Deposit to a shielded pool, share the claim link,
            and let the recipient withdraw with no on-chain trace back to you.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Link
              href="/create"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-hop-500 hover:bg-hop-600 text-white font-semibold text-lg transition-all hover:scale-105 shadow-lg shadow-hop-500/30 border-2 border-hop-600"
            >
              Send Payments
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/card"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-card border-2 border-border text-foreground font-semibold text-lg transition-all hover:border-honey-500 hover:bg-honey-50 dark:hover:bg-honey-900/20"
            >
              <CreditCard className="w-5 h-5 text-honey-500" />
              Virtual Cards
            </Link>
          </div>
        </div>
      </div>

      {/* How it Works - Simple */}
      <div className="py-16 px-4 bg-card border-y-2 border-border">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-semibold mb-8">How it works</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-full bg-hop-500 text-white flex items-center justify-center mx-auto font-bold">1</div>
              <p className="font-medium">Create Link</p>
              <p className="text-sm text-muted-foreground">Deposit SOL into a shielded pool</p>
            </div>
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-full bg-hop-500 text-white flex items-center justify-center mx-auto font-bold">2</div>
              <p className="font-medium">Share</p>
              <p className="text-sm text-muted-foreground">Send the claim link to anyone</p>
            </div>
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-full bg-hop-500 text-white flex items-center justify-center mx-auto font-bold">3</div>
              <p className="font-medium">Claim</p>
              <p className="text-sm text-muted-foreground">Recipient withdraws privately</p>
            </div>
          </div>
        </div>
      </div>

      {/* Virtual Cards Section - Simplified */}
      <div className="py-16 px-4 bg-secondary">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-honey-200 dark:bg-honey-900/30 text-xs text-honey-700 dark:text-honey-400 font-medium">
            Powered by Starpay
          </div>
          <h2 className="text-2xl md:text-3xl font-semibold">
            Private Virtual Cards
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Instant virtual Visa/Mastercard. Pay with SOL, no KYC required.
          </p>
          <Link
            href="/card"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-honey-500 hover:bg-honey-600 text-white font-semibold transition-all hover:scale-105 border-2 border-honey-600"
          >
            <CreditCard className="w-4 h-4" />
            Get a Virtual Card
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t-2 border-border py-6 px-4 bg-card">
        <div className="max-w-3xl mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <p>Built with privacy in mind</p>
          <p>Powered by Solana</p>
        </div>
      </footer>
    </div>
  );
}
