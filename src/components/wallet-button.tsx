"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LogOut, User, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortenAddress } from "@/lib/utils";
import { useEffect, useState } from "react";

export function WalletButton() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const [copied, setCopied] = useState(false);

  // Debug: Log all wallet info when user changes
  useEffect(() => {
    if (user) {
      console.log("[WalletButton] User object:", {
        wallet: user.wallet,
        linkedAccounts: user.linkedAccounts?.map((a: any) => ({
          type: a.type,
          address: a.address,
          chainType: a.chainType,
          chainId: a.chainId,
          walletClientType: a.walletClientType,
        })),
      });
    }
  }, [user]);

  // Get Solana wallet address - look for chainType: 'solana'
  const getSolanaAddress = (): string | null => {
    // 1. Check linkedAccounts for Solana wallet by chainType
    const solanaWallet = user?.linkedAccounts?.find((a) => 
      (a as any).type === 'wallet' && (a as any).chainType === 'solana'
    ) as { address?: string } | undefined;
    
    if (solanaWallet?.address) {
      return solanaWallet.address;
    }
    
    // 2. Check if main wallet is Solana (not starting with 0x)
    const mainAddress = user?.wallet?.address;
    if (mainAddress && !mainAddress.startsWith('0x')) {
      return mainAddress;
    }
    
    return null;
  };

  const handleCopy = async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!ready) return null;

  if (!authenticated) {
    return (
      <Button onClick={login} size="sm" variant="outline">
        <User className="w-4 h-4 mr-2" />
        Connect
      </Button>
    );
  }
  
  const solanaAddress = getSolanaAddress();
  const evmAddress = user?.wallet?.address?.startsWith('0x') ? user.wallet.address : null;

  return (
    <div className="flex items-center gap-2">
      {/* Show Solana address if available */}
      {solanaAddress ? (
        <button
          onClick={() => handleCopy(solanaAddress)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-hop-100 dark:bg-hop-900/30 border border-hop-200 dark:border-hop-800 hover:bg-hop-200 dark:hover:bg-hop-800/50 transition-colors cursor-pointer"
          title={`Click to copy: ${solanaAddress}`}
        >
          <span className="text-xs font-mono text-hop-700 dark:text-hop-300">
            {shortenAddress(solanaAddress, 4)}
          </span>
          {copied ? (
            <Check className="w-3 h-3 text-hop-600 dark:text-hop-400" />
          ) : (
            <Copy className="w-3 h-3 text-hop-500" />
          )}
        </button>
      ) : evmAddress ? (
        // Show EVM address with warning
        <button
          onClick={() => handleCopy(evmAddress)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors cursor-pointer"
          title={`Click to copy: ${evmAddress}`}
        >
          <span className="text-xs font-mono text-yellow-400">
            ⚠️ {shortenAddress(evmAddress, 4)}
          </span>
          {copied ? (
            <Check className="w-3 h-3 text-yellow-400" />
          ) : (
            <Copy className="w-3 h-3 text-yellow-400/60" />
          )}
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">No wallet</span>
      )}
      <Button onClick={logout} size="sm" variant="ghost">
        <LogOut className="w-4 h-4" />
      </Button>
    </div>
  );
}
