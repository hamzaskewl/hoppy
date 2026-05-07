"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LogOut, User, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortenAddress } from "@/lib/utils";
import { useState } from "react";

export function WalletButton() {
  const { publicKey, connected, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!connected || !publicKey) {
    return (
      <Button onClick={() => setVisible(true)} size="sm" variant="outline">
        <User className="w-4 h-4 mr-2" />
        Connect
      </Button>
    );
  }

  const address = publicKey.toBase58();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => handleCopy(address)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-hop-100 dark:bg-hop-900/30 border border-hop-200 dark:border-hop-800 hover:bg-hop-200 dark:hover:bg-hop-800/50 transition-colors cursor-pointer"
        title={`Click to copy: ${address}`}
      >
        {wallet?.adapter.icon && (
          <img src={wallet.adapter.icon} alt="" className="w-4 h-4" />
        )}
        <span className="text-xs font-mono text-hop-700 dark:text-hop-300">
          {shortenAddress(address, 4)}
        </span>
        {copied ? (
          <Check className="w-3 h-3 text-hop-600 dark:text-hop-400" />
        ) : (
          <Copy className="w-3 h-3 text-hop-500" />
        )}
      </button>
      <Button onClick={disconnect} size="sm" variant="ghost">
        <LogOut className="w-4 h-4" />
      </Button>
    </div>
  );
}
