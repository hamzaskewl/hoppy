"use client";

import { useState, useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Shield, Wallet, ArrowRight, Lock, Info, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  createDoubleHopClaimUrl,
  generateCompositeSecret,
  calculateSenderCost,
  calculateRecipientReceives,
  SENDER_PRIVACY,
  RECIPIENT_PRIVACY,
  type DoubleHopNote,
  type SenderPrivacy,
} from "@/lib/privacy";
import { shortenAddress, solToLamports, lamportsToSol } from "@/lib/utils";
import { Connection, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

type Step = "connect" | "amount" | "depositing" | "complete";

export function CreateLinkForm() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const [step, setStep] = useState<Step>("connect");
  const [amount, setAmount] = useState<string>("0.1");
  const [senderPrivacy, setSenderPrivacy] = useState<SenderPrivacy>("basic");
  const [isDepositing, setIsDepositing] = useState(false);
  const [doubleHopNote, setDoubleHopNote] = useState<DoubleHopNote | null>(null);
  const [claimUrl, setClaimUrl] = useState<string>("");
  const [fundingTxHash, setFundingTxHash] = useState<string | null>(null);
  const [depositTxHash, setDepositTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositProgress, setDepositProgress] = useState<string>("");

  // Calculate costs based on amount and sender privacy
  const costBreakdown = useMemo(() => {
    const amountNum = parseFloat(amount) || 0;
    if (amountNum <= 0) return null;
    
    const recipientAmount = solToLamports(amountNum);
    const senderCost = calculateSenderCost(recipientAmount, senderPrivacy);
    
    // Show recipient preview based on sender privacy + recipient privacy
    // Basic sender: funds in ephemeral
    // Private sender: funds in pool
    const inPool = senderPrivacy === "private";
    
    let recipientQuick, recipientPrivate;
    
    if (inPool) {
      // Funds in pool: recipient pays withdrawal fee
      recipientQuick = calculateRecipientReceives(recipientAmount, "quick");
      recipientPrivate = calculateRecipientReceives(recipientAmount, "private");
    } else {
      // Funds in ephemeral
      // Quick: direct transfer (no fee!)
      // Private: deposit + withdraw (1 hop fee)
      recipientQuick = { recipientReceives: recipientAmount, fee: 0 };
      recipientPrivate = calculateRecipientReceives(recipientAmount, "quick"); // 1 hop
    }
    
    return {
      recipientAmount,
      senderPays: senderCost.senderPays,
      senderFee: senderCost.senderFee,
      senderPrivacyInfo: senderCost.privacyInfo,
      recipientQuick: recipientQuick.recipientReceives,
      recipientPrivate: recipientPrivate.recipientReceives,
    };
  }, [amount, senderPrivacy]);

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

  // Handle double hop deposit
  const handleDeposit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!costBreakdown) {
      setError("Unable to calculate costs");
      return;
    }

    setError(null);
    setIsDepositing(true);
    setStep("depositing");
    setDepositProgress("Initializing...");

    try {
      // Get user's Solana wallet for signing
      const solanaAddress = getSolanaAddress();
      if (!solanaAddress) {
        throw new Error("No Solana wallet connected");
      }

      // Get Solana wallet provider (Phantom, Solflare, etc.)
      // These wallets inject their provider into window
      let solanaProvider: any = null;
      
      if (typeof window !== "undefined") {
        // Check for Phantom
        if ((window as any).phantom?.solana?.isPhantom) {
          solanaProvider = (window as any).phantom.solana;
          console.log("[Create] Found Phantom wallet");
        }
        // Check for Solflare
        else if ((window as any).solflare?.isSolflare) {
          solanaProvider = (window as any).solflare;
          console.log("[Create] Found Solflare wallet");
        }
        // Check for generic Solana provider
        else if ((window as any).solana) {
          solanaProvider = (window as any).solana;
          console.log("[Create] Found generic Solana wallet");
        }
      }
      
      if (!solanaProvider) {
        throw new Error("No Solana wallet found. Please install Phantom or another Solana wallet.");
      }
      
      // Verify the connected address matches
      if (solanaProvider.publicKey?.toBase58() !== solanaAddress) {
        // Try to connect if not connected
        if (!solanaProvider.isConnected) {
          console.log("[Create] Wallet not connected, requesting connection...");
          await solanaProvider.connect();
        }
      }
      
      console.log("[Create] Using wallet:", solanaProvider.publicKey?.toBase58());

      console.log("[Create] Starting deposit with privacy level:", senderPrivacy);
      console.log("[Create] Pool amount:", lamportsToSol(costBreakdown.poolAmount), "SOL");
      console.log("[Create] Sender pays:", lamportsToSol(costBreakdown.senderPays), "SOL");

      setDepositProgress("Generating ephemeral wallet...");
      
      // 1. Generate composite secret (client-side)
      const compositeSecret = generateCompositeSecret();
      const ephemeralAddress = compositeSecret.ephemeralKeypair.publicKey.toBase58();
      
      console.log("[Create] Ephemeral wallet:", ephemeralAddress.slice(0, 8) + "...");

      setDepositProgress("Preparing transaction...");
      
      // 2. Create funding transaction (sender → ephemeral)
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      
      const fundingTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(solanaAddress),
          toPubkey: compositeSecret.ephemeralKeypair.publicKey,
          lamports: costBreakdown.recipientAmount, // Amount for recipient
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      fundingTx.recentBlockhash = blockhash;
      fundingTx.feePayer = new PublicKey(solanaAddress);

      setDepositProgress("Please sign the transaction in your wallet...");
      
      // 3. Sign and send transaction via Solana wallet (Phantom, etc.)
      let fundingTxHash: string;
      
      if (typeof solanaProvider.signAndSendTransaction === "function") {
        // Phantom and most wallets support this
        const result = await solanaProvider.signAndSendTransaction(fundingTx);
        fundingTxHash = result.signature;
      } else if (typeof solanaProvider.signTransaction === "function") {
        // Fallback: sign then send separately
        const signedTx = await solanaProvider.signTransaction(fundingTx);
        fundingTxHash = await connection.sendRawTransaction(signedTx.serialize());
      } else {
        throw new Error("Wallet does not support transaction signing");
      }
      
      console.log("[Create] Funding transaction sent:", fundingTxHash);
      
      setDepositProgress("Waiting for transaction confirmation...");
      
      // Wait for confirmation (use "finalized" for more reliable confirmation)
      const confirmation = await connection.confirmTransaction(fundingTxHash, "finalized");
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log("[Create] Transaction confirmed!");
      
      setDepositProgress("Depositing to Privacy Cash...");
      
      // 4. Send to API to handle Privacy Cash deposit
      const response = await fetch("/api/privacy-cash/create-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: costBreakdown.recipientAmount, // Amount for recipient
          compositeSecret: compositeSecret.full,
          ephemeralAddress,
          fundingTxHash,
          senderPrivacy,
          senderAddress: solanaAddress, // For reclaim feature
        }),
      });

      const result = await response.json();

      if (!result.success || !result.note) {
        throw new Error(result.error || "Failed to create payment link");
      }
      
      // Generate claim URL
      const url = createDoubleHopClaimUrl(result.note);
      
      setDoubleHopNote(result.note);
      setClaimUrl(url);
      setFundingTxHash(result.fundingTxHash || null);
      setDepositTxHash(result.depositTxHash || null);
      setStep("complete");

      console.log("[Create] Double hop complete!");
      console.log("[Create] Claim URL:", url);
    } catch (err) {
      console.error("[Create] Deposit error:", err);
      setError(err instanceof Error ? err.message : "Deposit failed");
      setStep("amount");
    } finally {
      setIsDepositing(false);
      setDepositProgress("");
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setStep("amount");
    setDoubleHopNote(null);
    setClaimUrl("");
    setFundingTxHash(null);
    setDepositTxHash(null);
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
          {step === "depositing" && "Creating Payment Link..."}
          {step === "complete" && "Payment Link Ready!"}
        </CardTitle>
        <CardDescription>
          {step === "connect" && "Connect your wallet to create a shielded payment link"}
          {step === "amount" && "Choose how much SOL to send privately"}
          {step === "depositing" && "Processing double hop for maximum privacy"}
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
                  <p className="text-sm font-medium text-moss-300">Double Hop Privacy</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your payment goes through an ephemeral wallet and Privacy Cash. 
                    No one can link your wallet to the recipient.
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
              <label className="text-sm text-muted-foreground">Amount to Send (SOL)</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.1"
                className="text-lg"
              />
            </div>

            {/* Sender Privacy Selector */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Your Privacy (Sender)</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(SENDER_PRIVACY) as SenderPrivacy[]).map((level) => {
                  const info = SENDER_PRIVACY[level];
                  const isSelected = senderPrivacy === level;
                  return (
                    <button
                      key={level}
                      onClick={() => setSenderPrivacy(level)}
                      className={`p-3 rounded-xl border-2 transition-all text-left ${
                        isSelected
                          ? "border-moss-500 bg-moss-500/10"
                          : "border-border hover:border-moss-500/50 bg-background"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {level === "basic" && <Eye className="w-4 h-4 text-yellow-500" />}
                        {level === "private" && <EyeOff className="w-4 h-4 text-moss-500" />}
                        <span className="text-sm font-semibold">{info.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {info.estimatedCost}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sender Privacy Details */}
            {costBreakdown && (
              <div className={`p-3 rounded-xl border ${
                senderPrivacy === "basic" ? "bg-yellow-500/5 border-yellow-500/20" :
                "bg-moss-500/5 border-moss-500/20"
              }`}>
                <div className="flex items-start gap-2">
                  {senderPrivacy === "basic" && <Eye className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />}
                  {senderPrivacy === "private" && <EyeOff className="w-4 h-4 text-moss-500 mt-0.5 flex-shrink-0" />}
                  <div className="space-y-2 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {costBreakdown.senderPrivacyInfo.description}
                    </p>
                    <div className="flex items-center gap-1 text-xs">
                      {costBreakdown.senderPrivacyInfo.senderHidden ? (
                        <Check className="w-3 h-3 text-moss-500" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-yellow-500" />
                      )}
                      <span className={costBreakdown.senderPrivacyInfo.senderHidden ? "text-moss-400" : "text-yellow-400"}>
                        {costBreakdown.senderPrivacyInfo.senderHidden ? "Your identity is protected" : "Recipient could trace you"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Cost Breakdown */}
            {costBreakdown && (
              <div className="p-4 rounded-xl bg-background border border-border space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Info className="w-4 h-4 text-muted-foreground" />
                  <span>Cost Summary</span>
                </div>
                
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">You send</span>
                    <span className="font-semibold">{lamportsToSol(costBreakdown.senderPays).toFixed(4)} SOL</span>
                  </div>
                  
                  {costBreakdown.senderFee > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Your privacy fee</span>
                      <span className="text-muted-foreground">
                        -{lamportsToSol(costBreakdown.senderFee).toFixed(4)} SOL
                      </span>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Available for recipient {senderPrivacy === "private" ? "(in pool)" : "(in ephemeral)"}
                    </span>
                    <span className="text-muted-foreground">
                      {lamportsToSol(costBreakdown.recipientAmount).toFixed(4)} SOL
                    </span>
                  </div>
                  
                  <div className="border-t border-border my-2" />
                  
                  <p className="text-xs text-muted-foreground mb-2">
                    Recipient chooses their privacy level when claiming:
                  </p>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                      <p className="text-xs text-yellow-400 font-medium">Quick Claim</p>
                      <p className="text-sm font-semibold text-yellow-300">
                        {lamportsToSol(costBreakdown.recipientQuick).toFixed(4)} SOL
                      </p>
                      <p className="text-xs text-muted-foreground">Visible to you</p>
                    </div>
                    <div className="p-2 rounded-lg bg-moss-500/5 border border-moss-500/20">
                      <p className="text-xs text-moss-400 font-medium">Private Claim</p>
                      <p className="text-sm font-semibold text-moss-300">
                        {lamportsToSol(costBreakdown.recipientPrivate).toFixed(4)} SOL
                      </p>
                      <p className="text-xs text-muted-foreground">Hidden from you</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={handleDeposit}
              loading={isDepositing}
              className="w-full"
              size="lg"
              disabled={!costBreakdown || costBreakdown.poolAmount <= 0}
            >
              <Shield className="w-4 h-4 mr-2" />
              Create {senderPrivacy === "private" ? "Private" : ""} Link
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
            <h3 className="mt-6 text-lg font-semibold">Creating Payment Link</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {depositProgress || "Processing..."}
            </p>
            
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-start gap-2 justify-center">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-200/80">
                  Do not close this page. This may take a minute.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === "complete" && doubleHopNote && (
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
              <p className="text-sm text-muted-foreground">Recipient Will Receive</p>
              <p className="text-2xl font-bold text-moss-400">
                {lamportsToSol(doubleHopNote.amount).toFixed(4)} SOL
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

            {/* Transaction Hashes */}
            <div className="space-y-2">
              {fundingTxHash && (
                <div className="p-3 rounded-xl bg-background border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Ephemeral Funding</span>
                    <button
                      onClick={() => handleCopy(fundingTxHash)}
                      className="flex items-center gap-1 text-xs font-mono text-moss-400 hover:text-moss-300"
                    >
                      {shortenAddress(fundingTxHash, 6)}
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              )}
              
              {depositTxHash && (
                <div className="p-3 rounded-xl bg-background border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Privacy Cash Deposit</span>
                    <button
                      onClick={() => handleCopy(depositTxHash)}
                      className="flex items-center gap-1 text-xs font-mono text-moss-400 hover:text-moss-300"
                    >
                      {shortenAddress(depositTxHash, 6)}
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Privacy Notice */}
            <div className="p-3 rounded-lg bg-moss-500/10 border border-moss-500/20">
              <p className="text-xs text-moss-200/80">
                <strong>Privacy enabled:</strong> This payment used the double hop method. 
                There is no on-chain link between your wallet and the recipient.
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
