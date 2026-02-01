import Image from "next/image";
import { NavHeader } from "@/components/nav-header";

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <NavHeader />

      <main className="flex-1 py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 text-center">
            How Hoppy Works
          </h1>
          <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
            Sending private payments is easier than you think. Here&apos;s the magic behind the scenes.
          </p>

          {/* Flow Diagram */}
          <div className="mb-12 rounded-3xl overflow-hidden border-2 border-border shadow-lg">
            <Image
              src="/howitworks.svg"
              alt="How Hoppy works - flow diagram"
              width={1200}
              height={400}
              className="w-full h-auto scale-110"
            />
          </div>

          {/* Simple Explanation */}
          <div className="grid md:grid-cols-2 gap-8">
            {/* For Senders */}
            <div className="p-6 md:p-8 rounded-2xl bg-card border-2 border-border shadow-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-hop-500 text-white flex items-center justify-center font-bold text-lg">
                  1
                </div>
                <h2 className="text-xl font-semibold">Sending Money</h2>
              </div>
              <div className="space-y-4 text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">You deposit SOL</span> into a temporary wallet we create for you. 
                  This wallet then moves your funds into a privacy pool - think of it like a mixer where everyone&apos;s money gets shuffled together.
                </p>
                <p>
                  Once deposited, you get a <span className="font-medium text-foreground">secret claim link</span>. 
                  Share it via text, email, or any messaging app. Only someone with this link can claim the funds.
                </p>
              </div>
            </div>

            {/* For Recipients */}
            <div className="p-6 md:p-8 rounded-2xl bg-card border-2 border-border shadow-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-honey-500 text-white flex items-center justify-center font-bold text-lg">
                  2
                </div>
                <h2 className="text-xl font-semibold">Claiming Money</h2>
              </div>
              <div className="space-y-4 text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Got a link?</span> Just paste it and connect your wallet. 
                  We&apos;ll pull the funds from the privacy pool into another temporary wallet, then send it straight to you.
                </p>
                <p>
                  The cool part? <span className="font-medium text-foreground">Nobody can trace it back</span> to whoever sent it. 
                  The blockchain just sees money coming out of the pool - not who put it in.
                </p>
              </div>
            </div>
          </div>

          {/* The Privacy Magic */}
          <div className="mt-8 p-6 md:p-8 rounded-2xl bg-hop-50 dark:bg-hop-900/20 border-2 border-hop-200 dark:border-hop-800">
            <h3 className="text-lg font-semibold mb-4 text-hop-700 dark:text-hop-300">
              Why is this private?
            </h3>
            <p className="text-muted-foreground">
              Traditional crypto payments are like writing a check - everyone can see who paid whom. 
              Hoppy breaks that link by using <span className="font-medium text-foreground">temporary wallets</span> and 
              <span className="font-medium text-foreground"> optional privacy shielding</span>. 
              When enabled, your funds move through separate wallets so there's no direct connection between sender and recipient on-chain.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
