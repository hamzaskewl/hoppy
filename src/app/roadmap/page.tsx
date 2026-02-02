"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useInView } from "framer-motion";
import { Zap, Clock, Sparkles } from "lucide-react";
import { NavHeader } from "@/components/nav-header";

// Animated Card Component
function RoadmapCard({ 
  title, 
  description, 
  index,
}: { 
  title: string; 
  description: string; 
  index: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ 
        duration: 0.5, 
        delay: index * 0.1,
        ease: "easeOut"
      }}
      className="group"
    >
      <div className="bg-card border-2 border-border rounded-xl p-5 h-full transition-all duration-300 hover:border-hop-400 hover:shadow-lg hover:shadow-hop-500/10 hover:-translate-y-1">
        <h4 className="font-bold text-foreground mb-2 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
          {title}
        </h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
    </motion.div>
  );
}

// Column Header Component
function ColumnHeader({ 
  icon: Icon, 
  title, 
  variant 
}: { 
  icon: React.ElementType; 
  title: string; 
  variant: "active" | "upcoming" | "future";
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const styles = {
    active: {
      border: "border-hop-500",
      iconBg: "bg-hop-500 text-white",
      text: "text-hop-600 dark:text-hop-400",
    },
    upcoming: {
      border: "border-amber-500",
      iconBg: "bg-amber-500 text-white",
      text: "text-amber-600 dark:text-amber-400",
    },
    future: {
      border: "border-purple-500",
      iconBg: "bg-purple-500 text-white",
      text: "text-purple-600 dark:text-purple-400",
    },
  };

  const style = styles[variant];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4 }}
      className={`flex items-center gap-3 mb-6 pb-4 border-b-2 ${style.border}`}
    >
      <div className={`p-2.5 rounded-xl ${style.iconBg}`}>
        <Icon className="w-5 h-5" />
      </div>
      <h3 className={`text-lg font-bold ${style.text}`}>
        {title}
      </h3>
    </motion.div>
  );
}

export default function RoadmapPage() {
  const headerRef = useRef(null);
  const headerInView = useInView(headerRef, { once: true });

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Carrot background - light mode */}
      <div
        className="fixed inset-0 -z-10 dark:hidden"
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
        className="fixed inset-0 -z-10 hidden dark:block"
        style={{
          backgroundImage: "url('/hoppy-bgblack.png')",
          backgroundRepeat: "repeat",
          filter: "blur(6px)",
        }}
      />

      <NavHeader />

      <main className="flex-1 py-12 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Header with decorative tophats */}
          <motion.div
            ref={headerRef}
            initial={{ opacity: 0, y: 20 }}
            animate={headerInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.6 }}
            className="relative text-center mb-16 bg-card/90 dark:bg-card/95 backdrop-blur-md rounded-2xl border-2 border-border dark:border-hop-500/50 p-8 shadow-lg overflow-hidden"
          >
            {/* Decorative tophats - low opacity background */}
            <div className="absolute top-2 left-4 w-16 h-16 opacity-20 rotate-[-15deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            <div className="absolute top-2 right-4 w-14 h-14 opacity-20 rotate-[12deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            <div className="absolute bottom-2 left-8 w-12 h-12 opacity-20 rotate-[8deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            <div className="absolute bottom-2 right-8 w-14 h-14 opacity-20 rotate-[-10deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            <div className="absolute top-1/2 -translate-y-1/2 left-2 w-10 h-10 opacity-15 rotate-[20deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            <div className="absolute top-1/2 -translate-y-1/2 right-2 w-10 h-10 opacity-15 rotate-[-18deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>

            {/* Content */}
            <div className="relative z-10">
              <div className="inline-flex items-center gap-3 mb-4">
                <div className="w-16 h-16 rounded-full overflow-hidden border-3 border-hop-400 shadow-lg">
                  <Image
                    src="/hoppy-logo.png"
                    alt="hoppy"
                    width={64}
                    height={64}
                    className="object-cover"
                  />
                </div>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold mb-4 text-foreground">
                Roadmap
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                What we&apos;re building and where we&apos;re headed
              </p>
            </div>
          </motion.div>

          {/* Kanban Board */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* In Progress Column */}
            <div className="bg-card/95 backdrop-blur-md rounded-2xl border-2 border-hop-500 p-5 shadow-xl">
              <ColumnHeader icon={Zap} title="In Progress" variant="active" />
              <div className="space-y-4">
                <RoadmapCard 
                  title="Partial Withdrawals" 
                  description="Claim only a portion of funds, leave the rest for later"
                  index={0}
                />
                <RoadmapCard 
                  title="Multi-Token Support" 
                  description="USDC, USDT, BONK, and more SPL tokens"
                  index={1}
                />
                <RoadmapCard 
                  title="Virtual Debit Cards" 
                  description="Convert shielded crypto to Visa/Mastercard"
                  index={2}
                />
                <RoadmapCard 
                  title="Gift Card Payouts" 
                  description="Redeem to Amazon, Uber, DoorDash, and more"
                  index={3}
                />
                <RoadmapCard 
                  title="Claim Expiration" 
                  description="Auto-expire unclaimed links, refund sender"
                  index={4}
                />
              </div>
            </div>

            {/* Up Next Column */}
            <div className="bg-card/95 backdrop-blur-md rounded-2xl border-2 border-amber-500/50 p-5 shadow-xl">
              <ColumnHeader icon={Clock} title="Up Next" variant="upcoming" />
              <div className="space-y-4">
                <RoadmapCard 
                  title="Split Claims" 
                  description="One deposit → multiple claim links"
                  index={0}
                />
                <RoadmapCard 
                  title="Stealth Addresses" 
                  description="One-time recipient addresses for extra privacy"
                  index={1}
                />
                <RoadmapCard 
                  title="Recall Payments" 
                  description="Cancel unclaimed payments, get your funds back"
                  index={2}
                />
                <RoadmapCard 
                  title="Viewing Keys" 
                  description="Optional compliance without breaking privacy"
                  index={3}
                />
                <RoadmapCard 
                  title="Conditional Release" 
                  description="Release funds when specific conditions are met"
                  index={4}
                />
              </div>
            </div>

            {/* Future Column */}
            <div className="bg-card/95 backdrop-blur-md rounded-2xl border-2 border-purple-500/50 p-5 shadow-xl">
              <ColumnHeader icon={Sparkles} title="Future" variant="future" />
              <div className="space-y-4">
                <RoadmapCard 
                  title="x402 Protocol" 
                  description="HTTP 402 payments for AI agents"
                  index={0}
                />
                <RoadmapCard 
                  title="Agent Wallets" 
                  description="AI agents with autonomous spending capabilities"
                  index={1}
                />
                <RoadmapCard 
                  title="EVM Support" 
                  description="Ethereum, Base, Arbitrum, Polygon"
                  index={2}
                />
                <RoadmapCard 
                  title="Cross-Chain Swaps" 
                  description="Swap + shield in one transaction"
                  index={3}
                />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-4 bg-card/50 backdrop-blur-sm mt-16">
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
