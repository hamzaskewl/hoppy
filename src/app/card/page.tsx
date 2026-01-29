import { CardPurchaseFlow } from "@/components/card/card-purchase-flow";
import { NavHeader } from "@/components/nav-header";

export default function CardPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <NavHeader />

      <main className="flex-1 px-4 py-12">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center space-y-2 mb-8">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Private Virtual Cards
            </h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              Instant virtual Visa/Mastercard. Pay with SOL, no KYC required.
            </p>
          </div>

          {/* Layout: Centered flow with right sidebar */}
          <div className="relative flex justify-center">
            {/* Main flow - Centered */}
            <div className="w-full max-w-3xl">
              <CardPurchaseFlow />
            </div>

            {/* Info section - Positioned to the right of center (hidden on smaller screens) */}
            <div className="hidden xl:block absolute left-[calc(50%+400px)] top-0 w-72 space-y-4">
              <div className="p-4 rounded-xl bg-card border-2 border-border space-y-2 sticky top-4">
                <h3 className="font-semibold text-sm">How it works</h3>
                <ol className="space-y-1 text-xs text-muted-foreground list-decimal list-inside">
                  <li>Choose card value and type</li>
                  <li>Pay SOL to the provided address</li>
                  <li>Receive card details via email</li>
                </ol>
              </div>
              <div className="p-4 rounded-xl bg-card border-2 border-border space-y-2">
                <h3 className="font-semibold text-sm">Privacy</h3>
                <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
                  <li>No KYC for virtual cards</li>
                  <li>Card not linked to identity</li>
                  <li>Use shielded funds</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
