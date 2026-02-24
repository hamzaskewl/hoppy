"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

// Create Solana wallet connectors with Phantom first
const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false, // Disable auto-connect to prevent stale session issues
});

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmkrr3rdw00dzl00c4te3gzfo";

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Solana external wallets (Phantom, Solflare, Backpack)
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },
        // Embedded wallets - creates Solana wallet for email users
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
          walletList: ["phantom", "detected_solana_wallets"],
        } as any,
      }}
    >
      {children}
    </PrivyProvider>
  );
}
