"use client";

import { motion } from "framer-motion";
import { Shield, Users, Zap, Coins, Mail, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const marqueeItems = [
  "Partial claims",
  "QR sharing",
  "Quick or private claim",
  "Refund unclaimed funds",
  "Live on devnet",
  "Virtual cards · soon",
  "Gift cards · soon",
  "Viewing keys · soon",
];

type BentoCardProps = {
  icon: React.ElementType;
  title: string;
  description: string;
  index: number;
  span?: 1 | 2;
  featured?: boolean;
  badge?: string;
};

function BentoCard({
  icon: Icon,
  title,
  description,
  index,
  span = 1,
  featured = false,
  badge,
}: BentoCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.05 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: "easeOut" }}
      whileHover={{ y: -4 }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border-2 border-border bg-card p-6 md:p-8 transition-colors duration-300 hover:border-hop-400",
        span === 2 ? "md:col-span-2" : "md:col-span-1",
        featured && "md:row-span-1"
      )}
    >
      {featured && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 w-56 h-56 rounded-full bg-hop-500/5 dark:bg-hop-400/10 blur-2xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {badge && (
        <span className="absolute top-4 right-4 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-hop-700 dark:text-hop-300 bg-hop-100 dark:bg-hop-900/40 px-2.5 py-1 rounded-full">
          <Sparkles className="w-3 h-3" />
          {badge}
        </span>
      )}

      <div className="relative">
        <motion.div
          className={cn(
            "inline-flex items-center justify-center rounded-xl border transition-colors duration-300 mb-5",
            featured
              ? "w-14 h-14 bg-hop-100 dark:bg-hop-900/40 border-hop-300 dark:border-hop-700"
              : "w-11 h-11 bg-hop-50 dark:bg-hop-900/30 border-hop-200/70 dark:border-hop-800"
          )}
          animate={{ y: [0, -3, 0] }}
          transition={{
            duration: 4 + index * 0.3,
            repeat: Infinity,
            ease: "easeInOut",
            delay: index * 0.2,
          }}
        >
          <Icon
            className={cn(
              "text-hop-600 dark:text-hop-400",
              featured ? "w-7 h-7" : "w-5 h-5"
            )}
          />
        </motion.div>

        <h3
          className={cn(
            "text-foreground group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors mb-2",
            featured ? "text-2xl md:text-3xl tracking-tight" : "text-lg"
          )}
        >
          {title}
        </h3>
        <p
          className={cn(
            "text-muted-foreground leading-relaxed",
            featured ? "text-base max-w-md" : "text-sm"
          )}
        >
          {description}
        </p>
      </div>
    </motion.div>
  );
}

export function FeaturesShowcase() {
  return (
    <section className="relative py-24 px-4 overflow-hidden">
      {/* Diagonal speed-stripe backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 -z-0 opacity-40 dark:opacity-20"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(135, 221, 141, 0.10) 0px, rgba(135, 221, 141, 0.10) 2px, transparent 2px, transparent 28px)",
        }}
      />
      {/* Two soft radial blobs anchoring corners */}
      <div
        aria-hidden
        className="absolute -top-32 -left-32 w-[480px] h-[480px] -z-0 rounded-full blur-3xl opacity-50 dark:opacity-30"
        style={{
          background:
            "radial-gradient(circle, rgba(135, 221, 141, 0.35), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -right-32 w-[480px] h-[480px] -z-0 rounded-full blur-3xl opacity-50 dark:opacity-30"
        style={{
          background:
            "radial-gradient(circle, rgba(242, 171, 64, 0.25), transparent 70%)",
        }}
      />
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-14">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-3xl md:text-5xl tracking-tight mb-4"
          >
            Built for actually using
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-muted-foreground max-w-2xl mx-auto"
          >
            Privacy, ergonomics, and recovery — fused into one product.
          </motion.p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 auto-rows-fr gap-5 mb-14">
          <BentoCard
            index={0}
            span={2}
            featured
            icon={Shield}
            title="Stealth-address privacy"
            description="Funds withdraw to a fresh address derived from the recipient's viewing key. No on-chain edge connects the deposit to the claim."
          />
          <BentoCard
            index={1}
            span={2}
            featured
            icon={Users}
            title="Run payroll privately"
            description="Upload a CSV, sign one bulk deposit, mint a self-claimable link per employee. Refund anything left unclaimed."
            badge="New"
          />
          <BentoCard
            index={2}
            icon={Zap}
            title="Gasless claims"
            description="Recipients claim with zero SOL. The relayer covers transaction fees."
          />
          <BentoCard
            index={3}
            icon={Coins}
            title="SOL · USDC · USDT"
            description="Multi-token on Solana devnet. Stablecoin claims auto-subsidize SOL gas."
          />
          <BentoCard
            index={4}
            icon={Mail}
            title="No wallet required"
            description="Sign in with email and we'll spin up a wallet for you. Crypto without the friction."
          />
          <BentoCard
            index={5}
            icon={RotateCcw}
            title="Cancel & recall"
            description="Reclaim unclaimed sends back to your wallet — or any address you specify."
          />
        </div>

        {/* Marquee */}
        <div className="relative overflow-hidden border-y-2 border-border bg-card py-5">
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-card via-card to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-card via-card to-transparent z-10 pointer-events-none" />
          <motion.div
            className="flex whitespace-nowrap"
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          >
            {[...marqueeItems, ...marqueeItems, ...marqueeItems, ...marqueeItems].map(
              (item, i) => (
                <span
                  key={i}
                  className="inline-flex items-center text-sm uppercase tracking-[0.18em] text-muted-foreground/80 px-8"
                >
                  {item}
                  <span className="ml-8 text-hop-500/70">✦</span>
                </span>
              )
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
