"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

// Create Solana wallet connectors with Phantom first
const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "clzne91y501b62a3w90qwfwq1";

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
        // Login methods - wallet first, then email
        loginMethods: ["wallet", "email"],
        appearance: {
          theme: "light",
          accentColor: "#22c55e",
          // Show Phantom first in the wallet list
          walletList: ["phantom", "detected_solana_wallets"],
        } as any,
      }}
      >
        {children}
      </PrivyProvider>
    </div>
  );
}
