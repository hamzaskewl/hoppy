"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Shield, Wallet, ArrowRight, Lock } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  createShieldedPoolAdapter, 
  type ClaimNote,
  createClaimUrl,
} from "@/lib/privacy";
import { shortenAddress, solToLamports, lamportsToSol } from "@/lib/utils";
import { Keypair } from "@solana/web3.js";

type Step = "connect" | "amount" | "depositing" | "complete";

export function CreateLinkForm() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const [step, setStep] = useState<Step>("connect");
  const [amount, setAmount] = useState<string>("0.1");
  const [isDepositing, setIsDepositing] = useState(false);
  const [claimNote, setClaimNote] = useState<ClaimNote | null>(null);
  const [claimUrl, setClaimUrl] = useState<string>("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get Solana wallet address - look for chainType: 'solana'
  const getSolanaAddress = (): string | null => {
    // 1. Check linkedAccounts for Solana wallet by chainType
    const solanaWallet = user?.linkedAccounts?.find((a) => {
      const account = a as any;
      return account.type === 'wallet' && account.chainType === 'solana';
    }) as any;
    
    if (solanaWallet?.address) {
      return solanaWallet.address as string;
    }
    
    // 2. Check if main wallet is Solana (not starting with 0x)
    const mainAddress = user?.wallet?.address;
    if (mainAddress && !mainAddress.startsWith('0x')) {
      return mainAddress;
    }
    
    return null;
  };

  // Move to amount step when authenticated
  const handleContinue = () => {
    if (authenticated) {
      setStep("amount");
    } else {
      login();
    }
  };

  // Handle shielded deposit
  const handleDeposit = async () => {
    const lamports = solToLamports(parseFloat(amount));
    if (isNaN(lamports) || lamports <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    setError(null);
    setIsDepositing(true);
    setStep("depositing");

    try {
      // In production, this would use the user's actual wallet via Privy
      // For the mock, we create a temporary keypair to simulate the deposit
      const mockSigner = Keypair.generate();
      
      console.log("[Create] Starting shielded deposit...");
      console.log("[Create] Amount:", amount, "SOL");

      const adapter = createShieldedPoolAdapter();
      const result = await adapter.shieldedDeposit({
        signer: mockSigner,
        amount: lamports,
        network: "devnet",
      });

      if (!result.success || !result.note) {
        throw new Error(result.error || "Deposit failed");
      }

      // Generate claim URL
      const url = createClaimUrl(result.note);
      
      setClaimNote(result.note);
      setClaimUrl(url);
      setTxHash(result.txHash || null);
      setStep("complete");

      console.log("[Create] Deposit complete!");
      console.log("[Create] Claim URL:", url);
    } catch (err) {
      console.error("[Create] Deposit error:", err);
      setError(err instanceof Error ? err.message : "Deposit failed");
      setStep("amount");
    } finally {
      setIsDepositing(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setStep("amount");
    setClaimNote(null);
    setClaimUrl("");
    setTxHash(null);
    setAmount("0.1");
    setError(null);
  };

  if (!ready) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-moss-500 mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {step === "connect" && "Create Private Payment"}
          {step === "amount" && "Enter Amount"}
          {step === "depositing" && "Shielding Funds..."}
          {step === "complete" && "Payment Link Ready!"}
        </CardTitle>
        <CardDescription>
          {step === "connect" && "Connect your wallet to create a shielded payment link"}
          {step === "amount" && "Choose how much SOL to send privately"}
          {step === "depositing" && "Depositing funds into the shielded pool"}
          {step === "complete" && "Share this link with the recipient"}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Step 1: Connect Wallet */}
        {step === "connect" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-moss-500/10 border border-moss-500/20">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-moss-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-moss-300">Full Privacy</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your deposit goes through a shielded pool. No one can link your wallet to the recipient.
                  </p>
                </div>
              </div>
            </div>

            {authenticated ? (
              getSolanaAddress() ? (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-background border border-border">
                    <p className="text-xs text-muted-foreground mb-1">Connected Wallet (Solana)</p>
                    <p className="font-mono text-sm">
                      {shortenAddress(getSolanaAddress()!, 6)}
                    </p>
                  </div>
                  <Button onClick={handleContinue} className="w-full" size="lg">
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                    <p className="text-xs text-yellow-400 font-medium mb-1">⚠️ No Solana Wallet</p>
                    <p className="text-xs text-muted-foreground">
                      You're connected with an EVM wallet. Please logout and connect with <strong>Phantom</strong> or another Solana wallet.
                    </p>
                  </div>
                  <Button onClick={logout} className="w-full" variant="outline">
                    Logout & Connect Solana Wallet
                  </Button>
                </div>
              )
            ) : (
              <Button onClick={login} className="w-full" size="lg">
                <Wallet className="w-4 h-4 mr-2" />
                Connect Wallet
              </Button>
            )}
          </div>
        )}

        {/* Step 2: Enter Amount */}
        {step === "amount" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Amount (SOL)</label>
              <Input
                type="number"
                step="0.01"
                min="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.1"
                className="text-lg"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="p-4 rounded-xl bg-background border border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">You send</span>
                <span className="font-semibold">{amount || "0"} SOL</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">Recipient gets</span>
                <span className="font-semibold text-moss-400">{amount || "0"} SOL</span>
              </div>
            </div>

            <Button
              onClick={handleDeposit}
              loading={isDepositing}
              className="w-full"
              size="lg"
            >
              <Lock className="w-4 h-4 mr-2" />
              Shield & Create Link
            </Button>
          </div>
        )}

        {/* Step 3: Depositing */}
        {step === "depositing" && (
          <div className="py-8 text-center">
            <div className="relative w-24 h-24 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-moss-500/30 animate-ping" />
              <div className="absolute inset-2 rounded-full border-4 border-moss-500/50 animate-pulse" />
              <div className="absolute inset-4 rounded-full bg-moss-500/20 flex items-center justify-center">
                <Shield className="w-8 h-8 text-moss-400 animate-pulse" />
              </div>
            </div>
            <h3 className="mt-6 text-lg font-semibold">Shielding {amount} SOL</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Depositing into the privacy pool...
            </p>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === "complete" && claimNote && (
          <div className="space-y-4">
            {/* QR Code */}
            <div className="flex justify-center">
              <div className="p-4 bg-white rounded-2xl">
                <QRCodeSVG
                  value={claimUrl}
                  size={180}
                  level="H"
                  includeMargin={false}
                />
              </div>
            </div>

            {/* Amount */}
            <div className="p-4 rounded-xl bg-moss-500/10 border border-moss-500/20 text-center">
              <p className="text-sm text-muted-foreground">Shielded Amount</p>
              <p className="text-2xl font-bold text-moss-400">
                {lamportsToSol(claimNote.amount).toFixed(4)} SOL
              </p>
            </div>

            {/* Claim URL */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Claim Link</label>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-background border border-border">
                <code className="flex-1 text-xs font-mono truncate">
                  {claimUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopy(claimUrl)}
                  className="h-8 w-8 flex-shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-moss-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Transaction Hash */}
            {txHash && (
              <div className="p-3 rounded-xl bg-background border border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Deposit Tx</span>
                  <button
                    onClick={() => handleCopy(txHash)}
                    className="flex items-center gap-1 text-xs font-mono text-moss-400 hover:text-moss-300"
                  >
                    {shortenAddress(txHash, 6)}
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            )}

            {/* Note Status Info */}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-200/80">
                You can check if this note has been claimed by visiting the link yourself.
                Per the privacy model, you'll be able to see the recipient's address once claimed.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleCopy(claimUrl)}
                className="flex-1"
              >
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                Copy Link
              </Button>
              <Button variant="outline" onClick={handleReset}>
                Create Another
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
