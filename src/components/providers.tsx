"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

// Create Solana wallet connectors with Phantom first
const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true,
});

// Build Solana RPC config from env
const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
// Derive WSS URL from HTTPS URL for subscriptions
const wssUrl = rpcUrl.replace(/^https:\/\//, "wss://");

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "clzne91y501b62a3w90qwfwq1";

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Solana RPC config - uses your Helius RPC from .env
        solana: {
          rpcs: {
            "solana:mainnet": {
              rpc: createSolanaRpc(rpcUrl as Parameters<typeof createSolanaRpc>[0]),
              rpcSubscriptions: createSolanaRpcSubscriptions(wssUrl as Parameters<typeof createSolanaRpcSubscriptions>[0]),
            },
          } as any,
        },
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
