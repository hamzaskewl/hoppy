"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

// Create Solana wallet connectors (Phantom, Solflare, etc.)
const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "placeholder-app-id";

  return (
    <div suppressHydrationWarning>
      <PrivyProvider
        appId={appId}
        config={{
        // Solana external wallets (Phantom, Solflare, Backpack)
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },
        // Embedded wallets - CORRECT structure per Privy docs
        // https://docs.privy.io/basics/react/advanced/automatic-wallet-creation
        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
        } as any,
        loginMethods: ["wallet", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#22c55e",
        },
      }}
      >
        {children}
      </PrivyProvider>
    </div>
  );
}
