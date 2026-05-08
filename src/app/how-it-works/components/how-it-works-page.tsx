import Image from "next/image";
import { NavHeader } from "@/components/nav-header";

export function HowItWorksPage() {
  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Blurred tiled background - light mode */}
      <div
        className="absolute inset-0 -z-10 dark:hidden"
        style={{
          backgroundImage: "url('/hoppy-bg-tile.png')",
          backgroundRepeat: "repeat",
          filter: "blur(6px)",
        }}
      />
      {/* Blurred tiled background - dark mode */}
      <div
        className="absolute inset-0 -z-10 hidden dark:block"
        style={{
          backgroundImage: "url('/hoppy-bgblack.png')",
          backgroundRepeat: "repeat",
          filter: "blur(6px)",
        }}
      />
      <NavHeader />

      <main className="flex-1 py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl md:text-4xl  tracking-tight mb-4 text-center">
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
                <div className="w-10 h-10 rounded-full bg-hop-500 text-white flex items-center justify-center  text-lg">
                  1
                </div>
                <h2 className="text-xl ">Sending Money</h2>
              </div>
              <div className="space-y-4 text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">You deposit SOL</span> into an
                  encrypted Umbra UTXO bound to a one-time keypair. The deposit lands as
                  ciphertext on-chain — the amount and destination aren&apos;t visible to outside observers.
                </p>
                <p>
                  You get a <span className="font-medium text-foreground">secret claim link</span> with
                  the UTXO seed embedded in the URL fragment. Share it via text, email, or any
                  messaging app. Only someone with this link can claim the funds.
                </p>
              </div>
            </div>

            {/* For Recipients */}
            <div className="p-6 md:p-8 rounded-2xl bg-card border-2 border-border shadow-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-honey-500 text-white flex items-center justify-center  text-lg">
                  2
                </div>
                <h2 className="text-xl ">Claiming Money</h2>
              </div>
              <div className="space-y-4 text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Got a link?</span> Paste it and connect your wallet.
                  We unlock the encrypted UTXO and route the funds to your wallet via a
                  <span className="font-medium text-foreground"> stealth address</span> — our relayer covers
                  gas, so you don&apos;t need any SOL to claim.
                </p>
                <p>
                  The cool part? <span className="font-medium text-foreground">Nobody can trace it back</span> to whoever sent it.
                  On-chain, the sender deposited into encrypted state and you withdrew from a
                  fresh stealth address. There&apos;s no direct edge between the two wallets.
                </p>
              </div>
            </div>
          </div>

          {/* Payroll */}
          <div className="mt-8 p-6 md:p-8 rounded-2xl bg-card border-2 border-border shadow-lg">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-hop-500 text-white flex items-center justify-center  text-lg">
                3
              </div>
              <h2 className="text-xl ">Run Private Payroll</h2>
            </div>
            <div className="space-y-4 text-muted-foreground">
              <p>
                Need to pay everyone at once? Upload a CSV with names and amounts.
                We compute a single bulk deposit into a deterministic Umbra escrow tied to your
                wallet — <span className="font-medium text-foreground">you sign one transaction</span>,
                not one per employee.
              </p>
              <p>
                Behind the scenes, we mint a self-claimable UTXO for each recipient.
                Every employee gets a private claim link they redeem through the same flow above.
                If anyone doesn&apos;t claim, the remaining escrow balance
                <span className="font-medium text-foreground"> refunds back to your wallet</span>.
              </p>
            </div>
          </div>

          {/* The Privacy Magic */}
          <div className="mt-8 p-6 md:p-8 rounded-2xl bg-hop-50 dark:bg-hop-900/20 border-2 border-hop-200 dark:border-hop-800">
            <h3 className="text-lg  mb-4 text-hop-700 dark:text-hop-300">
              Why is this private?
            </h3>
            <p className="text-muted-foreground">
              Traditional crypto payments are like writing a check — everyone can see who paid whom.
              Hoppy breaks that link with{" "}
              <span className="font-medium text-foreground">stealth addresses</span> and{" "}
              <span className="font-medium text-foreground">encrypted UTXOs</span>. The on-chain
              record is a deposit into ciphertext and a withdrawal to a fresh address — there&apos;s
              no direct edge connecting sender and recipient. ZK proofs guarantee the math works
              without revealing who&apos;s involved.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
