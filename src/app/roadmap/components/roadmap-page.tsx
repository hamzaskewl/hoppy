"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useInView } from "framer-motion";
import {
  Zap,
  Clock,
  Sparkles,
  Check,
  Shield,
  Users,
  Globe,
  Coins,
  Scissors,
  RefreshCw,
  Wifi,
  Gift,
  Inbox,
} from "lucide-react";
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
        <h4 className=" text-foreground mb-2 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
          {title}
        </h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
    </motion.div>
  );
}

// Completed Card Component (green with checkmark)
function CompletedCard({ 
  title, 
  description, 
  index,
  progress,
}: { 
  title: string; 
  description: string; 
  index: number;
  progress?: string; // e.g., "2/3"
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
      <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-500 rounded-xl p-5 h-full transition-all duration-300 hover:shadow-lg hover:shadow-green-500/20">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h4 className=" text-green-700 dark:text-green-400 mb-1">
              {title}
            </h4>
            <p className="text-sm text-green-600/80 dark:text-green-300/70 leading-relaxed">
              {description}
            </p>
            <span className="inline-block mt-2 text-xs  text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded-full">
              {progress ? `COMPLETED ${progress}` : "COMPLETED"}
            </span>
          </div>
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
            <Check className="w-4 h-4 text-white" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Live Now Highlight Card
function LiveNowCard({
  icon: Icon,
  title,
  description,
  index,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  index: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: "easeOut" }}
      className="group p-5 rounded-xl bg-card border-2 border-green-500/40 hover:border-green-500 transition-all duration-300 hover:shadow-lg hover:shadow-green-500/10 hover:-translate-y-1"
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Icon className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className=" text-foreground text-sm">{title}</h4>
          <span className="inline-flex items-center gap-1 text-[10px]  uppercase tracking-wider text-green-600 dark:text-green-400 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
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
      <h3 className={`text-lg  ${style.text}`}>
        {title}
      </h3>
    </motion.div>
  );
}

export function RoadmapPage() {
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
            {/* Decorative tophats - random scattered placement */}
            {/* Left side - 3 random */}
            <div className="absolute top-3 left-6 w-14 h-14 opacity-20 rotate-[-12deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            <div className="absolute top-[45%] left-2 w-11 h-11 opacity-15 rotate-[22deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            <div className="absolute bottom-4 left-10 w-12 h-12 opacity-18 rotate-[-5deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            
            {/* Right side - 3 random */}
            <div className="absolute top-5 right-3 w-12 h-12 opacity-18 rotate-[15deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            <div className="absolute top-[60%] right-6 w-10 h-10 opacity-15 rotate-[-20deg]">
              <Image src="/tophat.png" alt="" fill className="object-contain" />
            </div>
            <div className="absolute bottom-2 right-14 w-13 h-13 opacity-20 rotate-[8deg]">
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
              <h1 className="text-4xl md:text-5xl  mb-4 text-foreground">
                Roadmap
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                What we&apos;re building and where we&apos;re headed
              </p>
            </div>
          </motion.div>

          {/* Live Now Strip */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-green-500 text-white">
                <Check className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl  text-green-600 dark:text-green-400">Live Now</h2>
                <p className="text-xs text-muted-foreground">Shipped and running on devnet</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <LiveNowCard
                icon={Shield}
                title="Stealth-Address Privacy"
                description="Migrated to Umbra v4. Encrypted UTXOs + stealth addresses replace the old shielded-pool model."
                index={0}
              />
              <LiveNowCard
                icon={Users}
                title="Private Payroll"
                description="CSV bulk issuance, deterministic escrow, refund mechanism for unclaimed funds."
                index={1}
              />
              <LiveNowCard
                icon={Wifi}
                title="Network-Aware Claims"
                description="Claim links carry their own network so deposits resolve correctly across mainnet and devnet."
                index={2}
              />
              <LiveNowCard
                icon={Scissors}
                title="Partial Claims"
                description="Take only what you need; the remainder lives in a fresh link you can share or save."
                index={3}
              />
              <LiveNowCard
                icon={RefreshCw}
                title="Cancel & Recall"
                description="Reclaim unclaimed personal sends back to your wallet, or to any address you specify."
                index={4}
              />
              <LiveNowCard
                icon={Coins}
                title="Multi-Token + Gasless"
                description="SOL, USDC, and USDT on devnet. Stablecoin claims auto-subsidize SOL gas via the relayer."
                index={5}
              />
              <LiveNowCard
                icon={Globe}
                title="Live on Devnet"
                description="Running on Solana devnet today — battle-testing the full flow before mainnet."
                index={6}
              />
              <LiveNowCard
                icon={Gift}
                title="Gift Card Payouts"
                description="Spend encrypted balance directly on Bitrefill gift cards — Amazon, Uber, DoorDash, and 4,000+ more."
                index={7}
              />
              <LiveNowCard
                icon={Inbox}
                title="Receiver-Claimable UTXOs"
                description="Payroll links land in a receiver-claimable UTXO at a stealth address — no intermediate ephemeral wallet."
                index={8}
              />
            </div>
          </div>

          {/* Kanban Board */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* In Progress Column */}
            <div className="bg-card/95 backdrop-blur-md rounded-2xl border-2 border-hop-500 p-5 shadow-xl">
              <ColumnHeader icon={Zap} title="In Progress" variant="active" />
              <div className="space-y-4">
                <RoadmapCard
                  title="Virtual Debit Cards"
                  description="Convert encrypted balance to a Visa/Mastercard you can use anywhere online."
                  index={0}
                />
                <RoadmapCard
                  title="Faster Payroll Proofs"
                  description="Trim server-side Groth16 proof time so large payrolls issue in seconds, not minutes."
                  index={1}
                />
                <RoadmapCard
                  title="Mainnet Launch"
                  description="Move off devnet with audited deploys, hardened relayer fees, and production indexer SLAs."
                  index={2}
                />
              </div>
            </div>

            {/* Up Next Column */}
            <div className="bg-card/95 backdrop-blur-md rounded-2xl border-2 border-amber-500/50 p-5 shadow-xl">
              <ColumnHeader icon={Clock} title="Up Next" variant="upcoming" />
              <div className="space-y-4">
                <RoadmapCard 
                  title="Claim Expiration" 
                  description="Auto-expire unclaimed links, refund sender"
                  index={0}
                />
                <RoadmapCard 
                  title="Split Claims" 
                  description="One deposit → multiple claim links"
                  index={1}
                />
                <RoadmapCard 
                  title="Viewing Keys" 
                  description="Optional compliance - share read-only access for audits"
                  index={2}
                />
                <RoadmapCard 
                  title="Conditional Release" 
                  description="Release funds when specific conditions are met"
                  index={3}
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
                  title="Cross-Chain Swaps" 
                  description="Swap + shield across EVM and Solana"
                  index={2}
                />
              </div>
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}
