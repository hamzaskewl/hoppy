import { NavHeader } from "@/components/nav-header";

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <NavHeader />

      <main className="flex-1 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-8 text-center">
            How it works
          </h1>

          <div className="p-6 md:p-8 rounded-2xl bg-card border-2 border-border shadow-lg">
            <ol className="text-muted-foreground space-y-4 list-decimal list-inside">
              <li className="text-base">
                Connect your wallet and enter the amount
              </li>
              <li className="text-base">
                Deposit directly into the shielded pool
              </li>
              <li className="text-base">
                Receive a private claim link with your secret note
              </li>
              <li className="text-base">
                Share the link - only the holder can claim the funds
              </li>
            </ol>
          </div>
        </div>
      </main>
    </div>
  );
}
