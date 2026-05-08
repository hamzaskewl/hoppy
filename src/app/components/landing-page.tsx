import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  CreditCard,
  Sparkles,
  Users,
  Link2,
} from "lucide-react";
import { NavHeader } from "@/components/nav-header";
import { FeaturesShowcase } from "@/app/components/features-showcase";
import { PoweredByCarousel } from "@/app/components/powered-by-carousel";

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

export function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <NavHeader />

      {/* New Feature Banner */}
      <div className="bg-gradient-to-r from-hop-500 to-hop-600 text-white py-3 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-3 text-sm md:text-base">
          <Sparkles className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium">
            New: Run private payroll. Upload a CSV, send everyone a claim link in one tx.
          </span>
          <Link
            href="/payroll"
            className="inline-flex items-center gap-1 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-full text-sm  transition-colors"
          >
            Try it
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Hero Section */}
      <div
        className="flex flex-col items-center justify-center px-4 py-20 min-h-[90vh] relative bg-cover bg-center"
        style={{ backgroundImage: "url('/landing-page-bg.jpg')" }}
      >
        <div className="absolute inset-0 bg-background/50 z-0" aria-hidden />
        <div className="max-w-4xl mx-auto text-center space-y-6 relative z-10">
          <div className="flex items-center justify-center mb-4">
            <HoppyLogo size={108} />
          </div>

          <div className="inline-block px-6 py-4 rounded-xl dark:border-2 dark:border-hop-500 dark:bg-hop-900/30 dark:shadow-lg dark:shadow-hop-500/20">
            <p className="text-5xl md:text-6xl  tracking-tight">
              <span className="text-hop-800 dark:text-white">Load. Redeem. Privately.</span>
            </p>
          </div>

          <p className="text-xl text-hop-700/80 dark:text-white/90 max-w-2xl mx-auto">
            Send private payments on Solana. Share a claim link; recipients withdraw via
            stealth addresses so the on-chain trail breaks at deposit.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Link
              href="/create"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-hop-500 hover:bg-hop-600 text-white  text-lg transition-all hover:scale-105 shadow-lg shadow-hop-500/30 border-2 border-hop-600"
            >
              Send Payments
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/card"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-card border-2 border-border text-foreground  text-lg transition-all hover:border-honey-500 hover:bg-honey-50 dark:hover:bg-honey-900/20"
            >
              <CreditCard className="w-5 h-5 text-honey-500" />
              Virtual Cards
            </Link>
          </div>

          <div className="flex items-center justify-center gap-2 pt-2 text-sm text-hop-700/70 dark:text-white/70">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live on Solana devnet
          </div>
        </div>
      </div>

      {/* Use Cases */}
      <div className="relative py-20 px-4 border-t-2 border-border overflow-hidden">
        {/* Scattered hoppy bunnies */}
        <div className="absolute top-[6%] left-[3%] w-24 h-24 opacity-80 rotate-[-12deg] -z-0">
          <Image src="/hopbunny.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[38%] left-[1%] w-20 h-20 opacity-75 rotate-[10deg] -z-0">
          <Image src="/bunnyspin.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute bottom-[6%] left-[7%] w-28 h-28 opacity-85 rotate-[-6deg] -z-0">
          <Image src="/bunnypriv.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[8%] right-[4%] w-28 h-28 opacity-85 rotate-[14deg] -z-0">
          <Image src="/bunnyqr.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[48%] right-[2%] w-20 h-20 opacity-75 rotate-[-18deg] -z-0">
          <Image src="/bunnyspin.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute bottom-[8%] right-[9%] w-24 h-24 opacity-80 rotate-[8deg] -z-0">
          <Image src="/hopbunny.png" alt="" fill className="object-contain" />
        </div>
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl  tracking-tight mb-3">
              One platform, three private flows
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Whether you&apos;re sending a tip, paying a team, or buying a virtual card — the on-chain
              trail breaks the moment funds enter Umbra.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Link
              href="/create"
              className="group p-8 rounded-2xl bg-card border-2 border-border transition-all duration-300 hover:border-hop-400 hover:shadow-xl hover:shadow-hop-500/10 hover:-translate-y-1"
            >
              <div className="w-14 h-14 rounded-2xl bg-hop-100 dark:bg-hop-900/40 border-2 border-hop-300 dark:border-hop-700 flex items-center justify-center mb-5">
                <Link2 className="w-7 h-7 text-hop-600 dark:text-hop-400" />
              </div>
              <h3 className="text-xl  mb-2 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
                Send Payments
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Deposit SOL, USDC, or USDT and share the claim link. No address required.
                Recipients claim with any wallet — or just an email.
              </p>
              <span className="inline-flex items-center gap-1 text-sm  text-hop-600 dark:text-hop-400">
                Create a link
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>

            <Link
              href="/payroll"
              className="group p-8 rounded-2xl bg-card border-2 border-border transition-all duration-300 hover:border-hop-400 hover:shadow-xl hover:shadow-hop-500/10 hover:-translate-y-1 relative"
            >
              <div className="absolute top-4 right-4 text-[10px]  uppercase tracking-wider text-hop-700 dark:text-hop-300 bg-hop-100 dark:bg-hop-900/40 px-2 py-1 rounded-full">
                New
              </div>
              <div className="w-14 h-14 rounded-2xl bg-hop-100 dark:bg-hop-900/40 border-2 border-hop-300 dark:border-hop-700 flex items-center justify-center mb-5">
                <Users className="w-7 h-7 text-hop-600 dark:text-hop-400" />
              </div>
              <h3 className="text-xl  mb-2 group-hover:text-hop-600 dark:group-hover:text-hop-400 transition-colors">
                Run Payroll
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Upload a CSV, sign one bulk deposit, mint a private claim link per employee.
                Refund anything left unclaimed.
              </p>
              <span className="inline-flex items-center gap-1 text-sm  text-hop-600 dark:text-hop-400">
                Open dashboard
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>

            <Link
              href="/card"
              className="group p-8 rounded-2xl bg-card border-2 border-border transition-all duration-300 hover:border-honey-500 hover:shadow-xl hover:shadow-honey-500/10 hover:-translate-y-1"
            >
              <div className="w-14 h-14 rounded-2xl bg-honey-100 dark:bg-honey-900/40 border-2 border-honey-300 dark:border-honey-700 flex items-center justify-center mb-5">
                <CreditCard className="w-7 h-7 text-honey-600 dark:text-honey-400" />
              </div>
              <h3 className="text-xl  mb-2 group-hover:text-honey-600 dark:group-hover:text-honey-400 transition-colors">
                Virtual Cards
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Convert encrypted balance into a Visa or Mastercard. Spend anywhere, no KYC,
                no on-chain trail back to the deposit.
              </p>
              <span className="inline-flex items-center gap-1 text-sm  text-honey-600 dark:text-honey-400">
                Buy a card
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>
          </div>
        </div>
      </div>

      {/* How It Works mini-section */}
      <div className="relative py-20 px-4 bg-card/50 border-y-2 border-border overflow-hidden">
        {/* Dotted grid backdrop */}
        <div
          className="absolute inset-0 -z-0 opacity-60 dark:opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(135, 221, 141, 0.35) 1.5px, transparent 1.5px)",
            backgroundSize: "28px 28px",
          }}
        />
        {/* Soft radial highlight behind the headline */}
        <div
          aria-hidden
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[280px] -z-0 opacity-70 dark:opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(135, 221, 141, 0.25), transparent 70%)",
          }}
        />
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl  tracking-tight mb-3">
              How it works
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Three steps. No address swaps, no awkward setup.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <div className="text-center p-6">
              <div className="w-12 h-12 rounded-full bg-hop-500 text-white  text-lg flex items-center justify-center mx-auto mb-4">
                1
              </div>
              <h3 className=" mb-2">Deposit into Umbra</h3>
              <p className="text-sm text-muted-foreground">
                Funds become an encrypted UTXO bound to a one-time keypair. Amount and
                destination are ciphertext on-chain.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-12 h-12 rounded-full bg-hop-500 text-white  text-lg flex items-center justify-center mx-auto mb-4">
                2
              </div>
              <h3 className=" mb-2">Share the link</h3>
              <p className="text-sm text-muted-foreground">
                The keypair lives in the URL hash. Send it via text, email, QR, or
                whatever. Only link holders can claim.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-12 h-12 rounded-full bg-hop-500 text-white  text-lg flex items-center justify-center mx-auto mb-4">
                3
              </div>
              <h3 className=" mb-2">Claim via stealth address</h3>
              <p className="text-sm text-muted-foreground">
                Funds route to a fresh address — no on-chain edge to the deposit.
                Relayer pays gas, so recipients need zero SOL.
              </p>
            </div>
          </div>

          <div className="text-center">
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-card border-2 border-border text-foreground  transition-all hover:border-hop-400 hover:bg-hop-50 dark:hover:bg-hop-900/20"
            >
              See the full breakdown
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      <FeaturesShowcase />

      <div className="pb-20 px-4 -mt-8 text-center">
        <Link
          href="/roadmap"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-card border-2 border-border text-foreground transition-all hover:border-hop-400 hover:bg-hop-50 dark:hover:bg-hop-900/20"
        >
          See what&apos;s shipping next
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Powered By Section */}
      <div className="py-24 bg-card border-y-2 border-border relative overflow-hidden">
        {/* Decorative tophats */}
        <div className="absolute top-[8%] left-4 w-24 h-24 opacity-80 rotate-[-10deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[38%] left-6 w-20 h-20 opacity-80 rotate-[15deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[68%] left-3 w-22 h-22 opacity-80 rotate-[-5deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[12%] right-4 w-22 h-22 opacity-80 rotate-[12deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[42%] right-6 w-20 h-20 opacity-80 rotate-[-8deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[72%] right-3 w-24 h-24 opacity-80 rotate-[18deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-4 left-[12%] w-20 h-20 opacity-80 rotate-[8deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-6 right-[12%] w-22 h-22 opacity-80 rotate-[-12deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute bottom-4 left-[10%] w-22 h-22 opacity-80 rotate-[-15deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute bottom-6 right-[10%] w-20 h-20 opacity-80 rotate-[10deg] -z-0">
          <Image src="/tophat.png" alt="" fill className="object-contain" />
        </div>

        <div className="relative z-10">
          <h2 className="text-center text-3xl uppercase tracking-[0.2em] text-muted-foreground/60 mb-12">
            Powered By
          </h2>

          <PoweredByCarousel />
        </div>
      </div>

      {/* Final CTA */}
      <div className="relative py-24 px-4 bg-gradient-to-b from-background to-hop-50 dark:to-hop-900/20 overflow-hidden">
        {/* Bunny chorus flanking the CTA */}
        <div className="absolute top-[12%] left-[5%] w-24 h-24 opacity-85 rotate-[-12deg] -z-0">
          <Image src="/bunnyspin.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute bottom-[10%] left-[10%] w-20 h-20 opacity-80 rotate-[8deg] -z-0">
          <Image src="/hopbunny.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute top-[16%] right-[6%] w-24 h-24 opacity-85 rotate-[14deg] -z-0">
          <Image src="/bunnypriv.png" alt="" fill className="object-contain" />
        </div>
        <div className="absolute bottom-[14%] right-[4%] w-20 h-20 opacity-80 rotate-[-18deg] -z-0">
          <Image src="/bunnyqr.png" alt="" fill className="object-contain" />
        </div>
        {/* Soft pulse glow behind the CTA */}
        <div
          aria-hidden
          className="absolute inset-0 -z-0 flex items-center justify-center"
        >
          <div
            className="w-[500px] h-[500px] rounded-full blur-3xl opacity-40 dark:opacity-25"
            style={{
              background:
                "radial-gradient(circle, rgba(135, 221, 141, 0.4), transparent 70%)",
            }}
          />
        </div>
        <div className="max-w-3xl mx-auto text-center space-y-6 relative z-10">
          <h2 className="text-3xl md:text-5xl  tracking-tight">
            Ready to send privately?
          </h2>
          <p className="text-lg text-muted-foreground">
            No signups, no waitlist. Connect a wallet — or sign in with email — and your
            first claim link is sixty seconds away.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Link
              href="/create"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-hop-500 hover:bg-hop-600 text-white  text-lg transition-all hover:scale-105 shadow-lg shadow-hop-500/30 border-2 border-hop-600"
            >
              Send a Payment
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/payroll"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-card border-2 border-border text-foreground  text-lg transition-all hover:border-hop-400 hover:bg-hop-50 dark:hover:bg-hop-900/20"
            >
              <Users className="w-5 h-5 text-hop-500" />
              Run Payroll
            </Link>
          </div>
        </div>
      </div>

    </div>
  );
}
