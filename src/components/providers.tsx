"use client";

import { useEffect, useState, useCallback } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true,
});

function clearPrivyStorage() {
  try {
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
  } catch {
    // Ignore storage errors
  }
}

function SessionErrorHandler({ children }: { children: React.ReactNode }) {
  const [hasCleared, setHasCleared] = useState(false);

  const handleAuthError = useCallback(() => {
    if (hasCleared) return;
    console.log("[Privy] Auth error detected, clearing session and reloading");
    clearPrivyStorage();
    setHasCleared(true);
    // Reload once to get a fresh session
    window.location.reload();
  }, [hasCleared]);

  useEffect(() => {
    // Catch "Error authenticating session" from Privy's minified code
    const handleError = (event: ErrorEvent) => {
      if (event.message?.includes("authenticating session") ||
          event.message?.includes("_authenticate")) {
        event.preventDefault();
        handleAuthError();
      }
    };

    // Also catch unhandled promise rejections from Privy
    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message || String(event.reason || "");
      if (msg.includes("authenticating session") ||
          msg.includes("_authenticate") ||
          msg.includes("Failed to fetch") && msg.includes("privy")) {
        event.preventDefault();
        handleAuthError();
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [handleAuthError]);

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
