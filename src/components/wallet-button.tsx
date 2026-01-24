"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortenAddress } from "@/lib/utils";
import { useEffect } from "react";

export function WalletButton() {
  const { login, logout, authenticated, ready, user } = usePrivy();

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

  if (!ready) return null;

  if (!authenticated) {
    return (
      <Button onClick={login} size="sm" variant="outline">
        <User className="w-4 h-4 mr-2" />
        Connect
      </Button>
    );
  }

  // Get Solana wallet address - look for chainType: 'solana'
  const getSolanaAddress = (): string | null => {
    // 1. Check linkedAccounts for Solana wallet by chainType
    const solanaWallet = user?.linkedAccounts?.find((a: any) => 
      a.type === 'wallet' && a.chainType === 'solana'
    );
    
    if (solanaWallet?.address) {
      console.log("[WalletButton] Found Solana wallet:", solanaWallet.address);
      return solanaWallet.address;
    }
    
    // 2. Check if main wallet is Solana (not starting with 0x)
    const mainAddress = user?.wallet?.address;
    if (mainAddress && !mainAddress.startsWith('0x')) {
      console.log("[WalletButton] Main wallet is Solana:", mainAddress);
      return mainAddress;
    }
    
    // 3. No Solana wallet found
    console.warn("[WalletButton] No Solana wallet found. Available wallets:", 
      user?.linkedAccounts?.filter((a: any) => a.type === 'wallet')
    );
    return null;
  };
  
  const solanaAddress = getSolanaAddress();
  const evmAddress = user?.wallet?.address?.startsWith('0x') ? user.wallet.address : null;

  return (
    <div className="flex items-center gap-2">
      {/* Show Solana address if available */}
      {solanaAddress ? (
        <div className="px-3 py-1.5 rounded-lg bg-moss-500/10 border border-moss-500/20">
          <span className="text-xs font-mono text-moss-400">
            {shortenAddress(solanaAddress, 4)}
          </span>
        </div>
      ) : evmAddress ? (
        // Show EVM address with warning
        <div className="px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <span className="text-xs font-mono text-yellow-400" title="EVM address - configure Solana in Privy Dashboard">
            ⚠️ {shortenAddress(evmAddress, 4)}
          </span>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">No wallet</span>
      )}
      <Button onClick={logout} size="sm" variant="ghost">
        <LogOut className="w-4 h-4" />
      </Button>
    </div>
  );
}
