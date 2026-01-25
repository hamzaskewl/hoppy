import { CreateLinkForm } from "@/components/create/create-link-form";
import { NavHeader } from "@/components/nav-header";

export default function CreatePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <NavHeader />

      <main className="flex-1 py-12 px-4">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Send Private Payments
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Deposit to a shielded pool and share a claim link. The recipient withdraws with no
              on-chain trace back to you.
            </p>
          </div>

          {/* Main Content */}
          <CreateLinkForm />

          {/* Info Section */}
          <div className="max-w-md mx-auto mt-8 p-6 rounded-2xl glass">
            <h3 className="font-semibold mb-3">How it works</h3>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Connect your wallet and enter the amount</li>
              <li>Deposit directly into the shielded pool</li>
              <li>Receive a private claim link with your secret note</li>
              <li>Share the link - only the holder can claim the funds</li>
            </ol>
          </div>
        </div>
      </main>
    </div>
  );
}
