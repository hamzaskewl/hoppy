import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CreditCard, Zap, Clock, Sparkles, Globe } from "lucide-react";
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

// Roadmap Card Component
function RoadmapCard({ 
  title, 
  description, 
  status,
  icon 
}: { 
  title: string; 
  description: string; 
  status: "building" | "planned" | "future";
  icon?: React.ReactNode;
}) {
  const statusStyles = {
    building: "border-l-hop-500 bg-hop-50 dark:bg-hop-900/20",
    planned: "border-l-honey-500 bg-honey-50/50 dark:bg-honey-900/10",
    future: "border-l-muted-foreground/30 bg-muted/30",
  };

  return (
    <div className={`rounded-lg border-l-4 p-3 ${statusStyles[status]}`}>
      <div className="flex items-start gap-2">
        {icon && <span className="text-muted-foreground mt-0.5">{icon}</span>}
        <div>
          <h4 className="font-semibold text-sm text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
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
        <div className="max-w-4xl mx-auto text-center space-y-6 relative z-10">
          {/* Logo */}
          <div className="flex items-center justify-center mb-4">
            <HoppyLogo size={108} />
          </div>

          {/* Tagline */}
          <div className="inline-block px-6 py-4 rounded-xl dark:border-2 dark:border-hop-500 dark:bg-hop-900/30 dark:shadow-lg dark:shadow-hop-500/20">
            <p className="text-5xl md:text-6xl font-bold tracking-tight">
              <span className="text-hop-800 dark:text-white">Load. Redeem. Privately.</span>
            </p>
          </div>

          <p className="text-xl text-hop-700/80 dark:text-white/90 max-w-2xl mx-auto">
            Send private payments on Solana. Share a claim link and let the recipient withdraw - 
            with optional privacy shielding for maximum anonymity.
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

      {/* Powered By Section */}
      <div className="py-24 bg-card/50 border-y-2 border-border relative overflow-hidden">
        {/* Background decorative tophats - low opacity, behind everything */}
        {/* Left side */}
        <div className="absolute top-[8%] left-4 w-24 h-24 opacity-30 rotate-[-10deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[38%] left-6 w-20 h-20 opacity-30 rotate-[15deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[68%] left-3 w-22 h-22 opacity-30 rotate-[-5deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        
        {/* Right side */}
        <div className="absolute top-[12%] right-4 w-22 h-22 opacity-30 rotate-[12deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[42%] right-6 w-20 h-20 opacity-30 rotate-[-8deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[72%] right-3 w-24 h-24 opacity-30 rotate-[18deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        
        {/* Top corners */}
        <div className="absolute top-4 left-[12%] w-20 h-20 opacity-30 rotate-[8deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-6 right-[12%] w-22 h-22 opacity-30 rotate-[-12deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        
        {/* Bottom corners */}
        <div className="absolute bottom-4 left-[10%] w-22 h-22 opacity-30 rotate-[-15deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute bottom-6 right-[10%] w-20 h-20 opacity-30 rotate-[10deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>

        <div className="max-w-5xl mx-auto px-4 relative z-10">
          <h2 className="text-center text-3xl font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-16">
            Powered By
          </h2>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-12 md:gap-8">
            {/* Privacy Cash */}
            <div className="flex flex-col items-center group transition-all duration-300">
              <div className="relative w-24 h-24 mb-6 transition-transform duration-300 group-hover:scale-110">
                <Image
                  src="/pcash.png"
                  alt="Privacy Cash"
                  fill
                  className="object-contain"
                />
              </div>
              <span className="font-bold text-sm tracking-wide text-foreground/70 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
                Privacy Cash
              </span>
            </div>

            {/* Helius */}
            <div className="flex flex-col items-center group transition-all duration-300">
              <div className="relative w-24 h-24 mb-6 transition-transform duration-300 group-hover:scale-110">
                <Image
                  src="/Helius-Vertical-Logo.png"
                  alt="Helius"
                  fill
                  className="object-contain"
                />
              </div>
              <span className="font-bold text-sm tracking-wide text-foreground/70 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
                Helius
              </span>
            </div>

            {/* Solana */}
            <div className="flex flex-col items-center group transition-all duration-300">
              <div className="relative w-24 h-24 mb-6 transition-transform duration-300 group-hover:scale-110">
                <Image
                  src="/sol.svg"
                  alt="Solana"
                  fill
                  className="object-contain"
                />
              </div>
              <span className="font-bold text-sm tracking-wide text-foreground/70 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
                Solana
              </span>
            </div>

            {/* Privy - with dark/light mode support */}
            <div className="flex flex-col items-center group transition-all duration-300">
              <div className="relative w-24 h-24 mb-6 transition-transform duration-300 group-hover:scale-110">
                {/* Light mode: black logo */}
                <Image
                  src="/Privy_Symbol_Black.png"
                  alt="Privy"
                  fill
                  className="object-contain dark:hidden"
                />
                {/* Dark mode: white logo */}
                <Image
                  src="/Privy_Symbol_White.png"
                  alt="Privy"
                  fill
                  className="object-contain hidden dark:block"
                />
              </div>
              <span className="font-bold text-sm tracking-wide text-foreground/70 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
                Privy
              </span>
            </div>

            {/* Starpay - circular cropped */}
            <div className="flex flex-col items-center group transition-all duration-300">
              <div className="relative w-24 h-24 mb-6 transition-transform duration-300 group-hover:scale-110">
                <div className="w-full h-full rounded-full overflow-hidden bg-white dark:bg-gray-100 shadow-md flex items-center justify-center">
                  <Image
                    src="/starpay-logo.png"
                    alt="Starpay"
                    width={80}
                    height={80}
                    className="object-contain scale-110"
                  />
                </div>
              </div>
              <span className="font-bold text-sm tracking-wide text-foreground/70 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
                Starpay
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Roadmap Section */}
      <div className="py-24 bg-background" id="roadmap">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-center text-3xl font-bold mb-4 text-foreground">
            Roadmap
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
            What we&apos;re building and where we&apos;re headed
          </p>

          {/* Kanban Board */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* In Progress Column */}
            <div className="bg-card rounded-2xl border-2 border-hop-500 shadow-lg shadow-hop-500/10 overflow-hidden">
              <div className="bg-hop-500 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-white" />
                  <h3 className="font-bold text-white">In Progress</h3>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <RoadmapCard 
                  title="Partial Withdrawals" 
                  description="Claim only a portion, leave the rest for later"
                  status="building"
                />
                <RoadmapCard 
                  title="Multi-Token Support" 
                  description="USDC, USDT, BONK, and more SPL tokens"
                  status="building"
                />
                <RoadmapCard 
                  title="Virtual Debit Cards" 
                  description="Convert shielded crypto to Visa/Mastercard"
                  status="building"
                />
                <RoadmapCard 
                  title="Gift Card Payouts" 
                  description="Redeem to Amazon, Uber, DoorDash, etc."
                  status="building"
                />
                <RoadmapCard 
                  title="Claim Expiration" 
                  description="Auto-expire unclaimed links, refund sender"
                  status="building"
                />
              </div>
            </div>

            {/* Up Next Column */}
            <div className="bg-card rounded-2xl border-2 border-border overflow-hidden">
              <div className="bg-muted px-4 py-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-muted-foreground" />
                  <h3 className="font-bold text-muted-foreground">Up Next</h3>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <RoadmapCard 
                  title="Split Claims" 
                  description="One deposit → multiple claim links"
                  status="planned"
                />
                <RoadmapCard 
                  title="Stealth Addresses" 
                  description="One-time recipient addresses"
                  status="planned"
                />
                <RoadmapCard 
                  title="Recall Payments" 
                  description="Cancel unclaimed payments, get funds back"
                  status="planned"
                />
                <RoadmapCard 
                  title="Viewing Keys" 
                  description="Optional compliance without breaking privacy"
                  status="planned"
                />
                <RoadmapCard 
                  title="Conditional Release" 
                  description="Release funds when conditions are met"
                  status="planned"
                />
              </div>
            </div>

            {/* Future Column */}
            <div className="bg-card rounded-2xl border-2 border-border overflow-hidden">
              <div className="bg-muted px-4 py-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-muted-foreground" />
                  <h3 className="font-bold text-muted-foreground">Future</h3>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <RoadmapCard 
                  title="x402 Protocol" 
                  description="HTTP 402 payments for AI agents"
                  status="future"
                />
                <RoadmapCard 
                  title="Agent Wallets" 
                  description="AI agents with autonomous spending"
                  status="future"
                />
                <RoadmapCard 
                  title="EVM Support" 
                  description="Ethereum, Base, Arbitrum, Polygon"
                  status="future"
                  icon={<Globe className="w-4 h-4" />}
                />
                <RoadmapCard 
                  title="Cross-Chain Swaps" 
                  description="Swap + shield in one transaction"
                  status="future"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t-2 border-border py-8 px-4 bg-card">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© 2026 Hoppy. Built with privacy in mind.</p>
          <div className="flex gap-6">
            <Link href="/how-it-works" className="hover:text-foreground transition-colors">How it works</Link>
            <a href="#roadmap" className="hover:text-foreground transition-colors">Roadmap</a>
            <a href="https://x.com/hoppyprivacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Twitter / X</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
