"use client";

import dynamic from "next/dynamic";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

// Create Solana wallet connectors (Phantom, Solflare, etc.)
const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true,
});

function Providers({ children }: { children: React.ReactNode }) {
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

// Export client-only version to avoid SSR issues during build
export const ClientProviders = dynamic(
  () => Promise.resolve(Providers),
  { ssr: false }
);
