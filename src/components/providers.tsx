"use client";

import { useEffect } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

// Create Solana wallet connectors with Phantom first
const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
});

// Clear stale Privy sessions on load to prevent auth errors
function clearStalePrivySessions() {
  if (typeof window === "undefined") return;
  
  try {
    // Check if we have a stale session marker
    const lastAuthError = sessionStorage.getItem("privy_auth_error");
    if (lastAuthError) {
      // Had an error last time - clear everything
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith("privy:") || key.includes("privy")) {
          localStorage.removeItem(key);
        }
      });
      Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith("privy:") || key.includes("privy")) {
          sessionStorage.removeItem(key);
        }
      });
      sessionStorage.removeItem("privy_auth_error");
      console.log("[Privy] Cleared stale session after previous auth error");
    }
  } catch (e) {
    // Ignore storage errors
  }
}

// Wrapper to catch auth errors and mark for clearing on next load
function SessionErrorHandler({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Clear stale sessions on mount
    clearStalePrivySessions();
    
    // Listen for Privy auth errors
    const handleError = (event: ErrorEvent) => {
      if (event.message?.includes("authenticating session") || 
          event.message?.includes("_authenticate")) {
        console.log("[Privy] Auth error detected, marking for session clear");
        sessionStorage.setItem("privy_auth_error", "true");
      }
    };
    
    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);
  
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmkrr3rdw00dzl00c4te3gzfo";

  return (
    <PrivyProvider
      appId={appId}
      config={{
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },
        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
        } as any,
        loginMethods: ["wallet", "email"],
        appearance: {
          theme: "light",
          accentColor: "#22c55e",
          walletList: ["phantom", "detected_solana_wallets"],
        } as any,
      }}
    >
      <SessionErrorHandler>
        {children}
      </SessionErrorHandler>
    </PrivyProvider>
  );
}
