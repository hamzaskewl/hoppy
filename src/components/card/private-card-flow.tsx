"use client";

import { useState, useEffect, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  Check,
  Copy,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Shield,
  Gift,
  Link as LinkIcon,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn, solToLamports, lamportsToSol } from "@/lib/utils";
import { Connection, Transaction, Keypair, PublicKey } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";

type CardType = "visa" | "mastercard";
type FlowStep = "configure" | "depositing" | "withdrawing" | "waiting" | "complete" | "error";

interface OrderData {
  orderId: string;
  payment: {
    address: string;
    amountSol: number;
    solPrice: number;
  };
  pricing: {
    cardValue: number;
    starpayFeePercent: number;
    starpayFee: number;
    total: number;
  };
  expiresAt: string;
  claimLink?: string;
}

export function PrivateCardFlow() {
  const { authenticated, login, user } = usePrivy();

  // Form state
  const [amount, setAmount] = useState<number>(50);
  const [amountInput, setAmountInput] = useState<string>("50");
  const [cardType, setCardType] = useState<CardType>("visa");

  // Flow state
  const [step, setStep] = useState<FlowStep>("configure");
  const [order, setOrder] = useState<OrderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState("");

  // Get user's Solana wallet
  const getSolanaWallet = useCallback(() => {
    const solanaWallet = user?.linkedAccounts?.find(
      (a: any) => a.type === "wallet" && a.chainType === "solana"
    );
    if (solanaWallet?.address) return solanaWallet.address;
    
    const mainAddress = user?.wallet?.address;
    if (mainAddress && !mainAddress.startsWith("0x")) return mainAddress;
    
    return null;
  }, [user]);

  // Poll for order status
  useEffect(() => {
    if (!order || step !== "waiting") return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/card/status?orderId=${order.orderId}`);
        const data = await res.json();

        if (data.status === "ready" && data.claimLink) {
          setOrder((prev) => prev ? { ...prev, claimLink: data.claimLink } : prev);
          setStep("complete");
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error("Status poll error:", err);
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [order, step]);

  const handleCreateOrder = async () => {
    if (!authenticated) {
      login();
      return;
    }

    const walletAddress = getSolanaWallet();
    if (!walletAddress) {
      setError("Please connect a Solana wallet");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Create gift card order (server creates Starpay order with proxy email)
      setProgress("Creating order...");
      const res = await fetch("/api/card/gift-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, cardType }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create order");
      
      setOrder(data);
      setStep("depositing");

      // 2. Deposit to Privacy Cash pool
      setProgress("Depositing to privacy pool...");
      
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      
      // Get the Solana provider from Privy
      const solanaProvider = await (window as any).solana;
      if (!solanaProvider) {
        throw new Error("Solana wallet not found. Please use Phantom or similar.");
      }

      // Create ephemeral keypair for the deposit
      const ephemeralKeypair = Keypair.generate();
      
      // Calculate deposit amount (Starpay amount + Privacy Cash fees)
      const starpayAmountLamports = solToLamports(data.payment.amountSol);
      const PRIVACY_CASH_FEE = 6_000_000; // 0.006 SOL flat
      const PRIVACY_CASH_PERCENT = 0.0035; // 0.35%
      const withdrawFee = Math.ceil(starpayAmountLamports * PRIVACY_CASH_PERCENT) + PRIVACY_CASH_FEE;
      const depositAmount = starpayAmountLamports + withdrawFee + 2_000_000; // Extra buffer
      
      // Fund ephemeral wallet
      const connection = new Connection(rpcUrl, "confirmed");
      const fundingTx = new Transaction();
      const { SystemProgram } = await import("@solana/web3.js");
      
      fundingTx.add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(walletAddress),
          toPubkey: ephemeralKeypair.publicKey,
          lamports: depositAmount,
        })
      );
      
      const { blockhash } = await connection.getLatestBlockhash();
      fundingTx.recentBlockhash = blockhash;
      fundingTx.feePayer = new PublicKey(walletAddress);
      
      // Sign with user's wallet
      const signedFundingTx = await solanaProvider.signTransaction(fundingTx);
      const fundingTxHash = await connection.sendRawTransaction(signedFundingTx.serialize());
      await connection.confirmTransaction(fundingTxHash, "confirmed");
      
      console.log("[PrivateCard] Funded ephemeral:", fundingTxHash);

      // Wait for balance
      await new Promise(r => setTimeout(r, 2000));
      
      // Deposit to Privacy Cash
      const privacyCash = new PrivacyCash({
        RPC_url: rpcUrl,
        owner: ephemeralKeypair,
        enableDebug: true,
      });

      const depositResult = await privacyCash.deposit({
        lamports: depositAmount - 2_000_000, // Leave some for withdraw tx
      });
      
      console.log("[PrivateCard] Deposited to pool:", depositResult.tx);
      setStep("withdrawing");

      // 3. Withdraw to Starpay payment address (PRIVATE!)
      setProgress("Withdrawing to card provider...");
      
      const withdrawResult = await privacyCash.withdraw({
        lamports: starpayAmountLamports,
        recipientAddress: data.payment.address,
      });
      
      console.log("[PrivateCard] Withdrew to Starpay:", withdrawResult.tx);

      // 4. Confirm payment with server
      await fetch("/api/card/confirm-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: data.orderId,
          depositTxHash: depositResult.tx,
          withdrawTxHash: withdrawResult.tx,
        }),
      });

      // 5. Wait for card to be ready
      setStep("waiting");
      setProgress("Waiting for card delivery...");
      
    } catch (err) {
      console.error("Private card error:", err);
      setError(err instanceof Error ? err.message : "Failed to purchase card");
      setStep("error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (order?.claimLink) {
      navigator.clipboard.writeText(order.claimLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const resetFlow = () => {
    setStep("configure");
    setOrder(null);
    setError(null);
    setProgress("");
  };

  return (
    <div className="max-w-2xl mx-auto">
      <AnimatePresence mode="wait">
        {/* Step 1: Configure */}
        {step === "configure" && (
          <motion.div
            key="configure"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-hop-500 border-2 border-hop-600 flex items-center justify-center">
                    <Gift className="w-5 h-5 text-white" />
                  </div>
                  Private Gift Card
                </CardTitle>
                <CardDescription>
                  Create a virtual card using Privacy Cash. No email required - you&apos;ll receive a private claim link.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Privacy Badge */}
                <div className="p-3 rounded-xl bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400 flex items-center gap-3">
                  <Shield className="w-5 h-5 text-hop-600 dark:text-hop-400" />
                  <div>
                    <p className="text-sm font-medium text-hop-700 dark:text-hop-300">Maximum Privacy</p>
                    <p className="text-xs text-muted-foreground">Card provider cannot trace your wallet</p>
                  </div>
                </div>

                {/* Amount selection */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Card Value (USD)</label>
                  <div className="grid grid-cols-5 gap-2">
                    {[25, 50, 100, 250].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setAmount(value);
                          setAmountInput(value.toString());
                        }}
                        className={cn(
                          "py-3 rounded-xl font-medium transition-all border-2",
                          amount === value && amountInput === value.toString()
                            ? "bg-hop-500 text-white border-hop-600"
                            : "bg-card border-border hover:border-hop-400"
                        )}
                      >
                        ${value}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById("custom-amount") as HTMLInputElement;
                        input?.focus();
                      }}
                      className={cn(
                        "py-3 rounded-xl font-medium transition-all border-2",
                        ![25, 50, 100, 250].includes(amount)
                          ? "bg-hop-500 text-white border-hop-600"
                          : "bg-card border-border hover:border-hop-400"
                      )}
                    >
                      Custom
                    </button>
                  </div>
                  <Input
                    id="custom-amount"
                    type="text"
                    inputMode="numeric"
                    value={amountInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^\d+$/.test(v)) {
                        setAmountInput(v);
                        const num = v === "" ? 0 : Number(v);
                        if (num >= 5 && num <= 10000) setAmount(num);
                      }
                    }}
                    onBlur={() => {
                      if (amountInput === "" || amount < 5) {
                        setAmount(50);
                        setAmountInput("50");
                      }
                    }}
                    className="bg-card border-2 border-border"
                    placeholder="5 - 10,000"
                  />
                </div>

                {/* Card type */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Card Type</label>
                  <div className="grid grid-cols-2 gap-3">
                    {(["visa", "mastercard"] as CardType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setCardType(type)}
                        className={cn(
                          "py-4 rounded-xl font-medium transition-all capitalize border-2",
                          cardType === type
                            ? "bg-hop-500 text-white border-hop-600"
                            : "bg-card border-border hover:border-hop-400"
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-red-100 dark:bg-red-500/10 border-2 border-red-400 text-red-700 dark:text-red-200 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleCreateOrder}
                  disabled={isLoading || amount < 5}
                  className="w-full py-6 text-lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      {progress || "Processing..."}
                    </>
                  ) : !authenticated ? (
                    "Connect Wallet"
                  ) : (
                    <>
                      Get Private Card
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  You&apos;ll receive a claim link. Share it with anyone - only link holders can see the card.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Processing States */}
        {(step === "depositing" || step === "withdrawing" || step === "waiting") && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card>
              <CardContent className="py-16 text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-hop-500 border-2 border-hop-600 mx-auto flex items-center justify-center animate-pulse">
                  {step === "depositing" && <Shield className="w-8 h-8 text-white" />}
                  {step === "withdrawing" && <CreditCard className="w-8 h-8 text-white" />}
                  {step === "waiting" && <Gift className="w-8 h-8 text-white" />}
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">
                    {step === "depositing" && "Depositing to Privacy Pool"}
                    {step === "withdrawing" && "Sending Private Payment"}
                    {step === "waiting" && "Waiting for Card"}
                  </h3>
                  <p className="text-muted-foreground">
                    {step === "depositing" && "Your funds are being shielded..."}
                    {step === "withdrawing" && "Paying card provider privately..."}
                    {step === "waiting" && "Card provider is processing your order..."}
                  </p>
                </div>
                <Loader2 className="w-8 h-8 mx-auto text-hop-600 dark:text-hop-400 animate-spin" />
                
                {step === "waiting" && (
                  <p className="text-xs text-muted-foreground">
                    This usually takes 1-5 minutes. Don&apos;t close this page.
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Complete - Show Claim Link */}
        {step === "complete" && order?.claimLink && (
          <motion.div
            key="complete"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <Card className="border-2 border-hop-400">
              <CardHeader className="text-center">
                <div className="w-12 h-12 rounded-full bg-hop-200 dark:bg-hop-500/20 border-2 border-hop-500 mx-auto flex items-center justify-center mb-2">
                  <Check className="w-6 h-6 text-hop-600 dark:text-hop-400" />
                </div>
                <CardTitle>Gift Card Ready!</CardTitle>
                <CardDescription>
                  Your ${amount} {cardType.toUpperCase()} card is ready
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-4 rounded-xl bg-secondary border-2 border-border">
                  <p className="text-sm text-muted-foreground mb-2">Claim Link</p>
                  <div className="flex items-center gap-2">
                    <Input
                      value={order.claimLink}
                      readOnly
                      className="bg-card border-2 border-border font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopy}
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-hop-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <Button onClick={handleCopy} className="w-full">
                  <LinkIcon className="w-4 h-4 mr-2" />
                  {copied ? "Copied!" : "Copy Claim Link"}
                </Button>

                <div className="p-3 rounded-xl bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400">
                  <p className="text-xs text-hop-700 dark:text-hop-300">
                    <strong>Privacy Protected:</strong> This card was purchased anonymously. 
                    Share this link with anyone - only link holders can see the card details.
                  </p>
                </div>

                <Button variant="outline" onClick={resetFlow} className="w-full">
                  Get Another Card
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Error State */}
        {step === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card className="border-2 border-red-400">
              <CardContent className="py-12 text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/20 border-2 border-red-400 mx-auto flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Something went wrong</h3>
                  <p className="text-muted-foreground">{error}</p>
                </div>
                <Button onClick={resetFlow}>Try Again</Button>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
