"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  Check,
  Copy,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Gift,
  Link as LinkIcon,
} from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

type CardType = "visa" | "mastercard";
type FlowStep = "configure" | "paying" | "waiting" | "complete" | "error";

interface OrderData {
  orderId: string;
  productSlug: string;
  productName: string;
  payment: {
    address: string;
    amount: number;
    currency: string;
  };
  pricing: {
    cardValue: number;
    total: number;
  };
  expiresAt: string;
  claimLink?: string;
}

export function PrivateCardFlow({ disabled = false }: { disabled?: boolean }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const [amount, setAmount] = useState<number>(50);
  const [amountInput, setAmountInput] = useState<string>("50");
  const [cardType, setCardType] = useState<CardType>("visa");

  const [step, setStep] = useState<FlowStep>("configure");
  const [order, setOrder] = useState<OrderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState("");

  // Poll for fulfillment once payment is sent
  useEffect(() => {
    if (!order || step !== "waiting") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/card/status?orderId=${order.orderId}`);
        const data = await res.json();

        if (data.status === "ready" && data.claimLink) {
          setOrder((prev) => (prev ? { ...prev, claimLink: data.claimLink } : prev));
          setStep("complete");
          clearInterval(interval);
        } else if (data.status === "failed" || data.status === "expired") {
          setError(
            data.status === "expired"
              ? "Order expired before fulfillment. Contact support if you sent payment."
              : "Card provider rejected the order. Contact support."
          );
          setStep("error");
          clearInterval(interval);
        }
      } catch (err) {
        console.error("Status poll error:", err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [order, step]);

  const handleCreateOrder = async () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!publicKey) {
      setError("Please connect a Solana wallet");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      setProgress("Creating order...");
      const res = await fetch("/api/card/gift-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, cardType }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create order");

      setOrder(data);
      setStep("paying");
      setProgress("Sending payment...");

      // Send SOL directly from the user's wallet to Bitrefill's address.
      // (Privacy via Umbra is a follow-up — direct send is the working MVP.)
      const lamports = Math.round(data.payment.amount * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(data.payment.address),
          lamports,
        })
      );

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setStep("waiting");
      setProgress("Waiting for card provider...");
    } catch (err) {
      console.error("Card order error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.includes("not been authorized") || msg.includes("cancelled")) {
        setError("Transaction cancelled. Approve in your wallet to continue.");
        setStep("configure");
      } else {
        setError(msg || "Failed to purchase card");
        setStep("error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = useCallback(() => {
    if (order?.claimLink) {
      navigator.clipboard.writeText(order.claimLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [order]);

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
                  Buy a virtual card with SOL. You&apos;ll get a claim link to share or keep.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-3 rounded-xl bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400 flex items-center gap-3">
                  <Image src="/bunnypriv.png" alt="Privacy" width={28} height={28} className="w-7 h-7" />
                  <div>
                    <p className="text-sm font-medium text-hop-700 dark:text-hop-300">Powered by Bitrefill</p>
                    <p className="text-xs text-muted-foreground">Pay in SOL — card delivered as a private claim link</p>
                  </div>
                </div>

                {/* Amount */}
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
                  onClick={disabled ? undefined : handleCreateOrder}
                  disabled={isLoading || amount < 5 || disabled}
                  className="w-full py-6 text-lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      {progress || "Processing..."}
                    </>
                  ) : !connected ? (
                    "Connect Wallet"
                  ) : disabled ? (
                    "Temporarily Unavailable"
                  ) : (
                    <>
                      Get Card
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  After payment, you get a claim link. Share it with anyone — only link holders see the card.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Processing */}
        {(step === "paying" || step === "waiting") && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card>
              <CardContent className="py-16 text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-hop-500 border-2 border-hop-600 mx-auto flex items-center justify-center animate-pulse">
                  {step === "paying" && <CreditCard className="w-8 h-8 text-white" />}
                  {step === "waiting" && <Gift className="w-8 h-8 text-white" />}
                </div>
                <div>
                  <h3 className="text-xl mb-2">
                    {step === "paying" && "Sending Payment"}
                    {step === "waiting" && "Waiting for Card"}
                  </h3>
                  <p className="text-muted-foreground">
                    {step === "paying" && "Confirm in your wallet..."}
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

        {/* Complete */}
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
                  Your ${amount} {order.productName} is ready
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
                    <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0">
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
                    Share this link with anyone — the card details are encrypted, only link holders can see them.
                  </p>
                </div>

                <Button variant="outline" onClick={resetFlow} className="w-full">
                  Get Another Card
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Error */}
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
                  <h3 className="text-xl mb-2">Something went wrong</h3>
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
