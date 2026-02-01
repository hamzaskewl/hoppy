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

      {/* Why Hoppy Section */}
      <div className="py-16 px-4 bg-card border-y-2 border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-semibold mb-3">Why use Hoppy?</h2>
          <p className="text-muted-foreground mb-10">Because your money, your business.</p>
          <div className="grid md:grid-cols-4 gap-8">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-hop-500/10 text-hop-600 dark:text-hop-400 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <p className="font-semibold">Actually Private</p>
              <p className="text-sm text-muted-foreground">No one can trace your payment back to you. Like, actually.</p>
            </div>
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-hop-500/10 text-hop-600 dark:text-hop-400 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="font-semibold">Zero KYC</p>
              <p className="text-sm text-muted-foreground">No selfies, no ID uploads. Just connect and send.</p>
            </div>
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-hop-500/10 text-hop-600 dark:text-hop-400 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <p className="font-semibold">Stupid Fast</p>
              <p className="text-sm text-muted-foreground">Solana speed. Blink and it&apos;s done.</p>
            </div>
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-hop-500/10 text-hop-600 dark:text-hop-400 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-semibold">Cheap AF</p>
              <p className="text-sm text-muted-foreground">Pennies per transaction. Keep your stack.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Powered By Section */}
      <div className="py-24 bg-card/50 border-y-2 border-border relative overflow-hidden">
        {/* Background decorative tophats - visible on edges */}
        {/* Left side */}
        <div className="absolute top-[8%] left-4 w-24 h-24 opacity-15 rotate-[-10deg]">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[38%] left-6 w-20 h-20 opacity-12 rotate-[15deg]">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[68%] left-3 w-22 h-22 opacity-15 rotate-[-5deg]">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        
        {/* Right side */}
        <div className="absolute top-[12%] right-4 w-22 h-22 opacity-12 rotate-[12deg]">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[42%] right-6 w-20 h-20 opacity-15 rotate-[-8deg]">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[72%] right-3 w-24 h-24 opacity-12 rotate-[18deg]">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        
        {/* Top corners */}
        <div className="absolute top-4 left-[12%] w-20 h-20 opacity-12 rotate-[8deg]">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-6 right-[12%] w-22 h-22 opacity-15 rotate-[-12deg]">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        
        {/* Bottom corners */}
        <div className="absolute bottom-4 left-[10%] w-22 h-22 opacity-15 rotate-[-15deg]">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute bottom-6 right-[10%] w-20 h-20 opacity-12 rotate-[10deg]">
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

      {/* Footer */}
      <footer className="border-t-2 border-border py-8 px-4 bg-card">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© 2026 Hoppy. Built with privacy in mind.</p>
          <div className="flex gap-6">
            <Link href="/how-it-works" className="hover:text-foreground transition-colors">How it works</Link>
            <a href="https://x.com/hoppyprivacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Twitter / X</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
