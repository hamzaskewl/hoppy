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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CardType = "visa" | "mastercard";

type OrderStatus = "pending" | "processing" | "completed" | "failed" | "expired";

interface OrderData {
  orderId: string;
  status: OrderStatus;
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
  card?: {
    number: string;
    expiry: string;
    cvv: string;
  };
}

type FlowStep = "configure" | "payment" | "processing" | "complete" | "error";

export function CardPurchaseFlow() {
  const { authenticated, login } = usePrivy();

  // Form state
  const [amount, setAmount] = useState<number>(50);
  const [amountInput, setAmountInput] = useState<string>("50");
  const [cardType, setCardType] = useState<CardType>("visa");
  const [email, setEmail] = useState("");

  // Flow state
  const [step, setStep] = useState<FlowStep>("configure");
  const [order, setOrder] = useState<OrderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Poll for order status
  useEffect(() => {
    if (!order || step !== "payment") return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/starpay/status?orderId=${order.orderId}`);
        const data = await res.json();

        if (data.status === "processing") {
          setStep("processing");
        } else if (data.status === "completed") {
          setOrder((prev) => (prev ? { ...prev, ...data } : data));
          setStep("complete");
          clearInterval(pollInterval);
        } else if (data.status === "failed" || data.status === "expired") {
          setError(
            data.status === "expired"
              ? "Order expired. Please try again."
              : "Card issuance failed. Please contact support."
          );
          setStep("error");
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error("Status poll error:", err);
      }
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(pollInterval);
  }, [order, step]);

  const handleCreateOrder = async () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/starpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, cardType, email }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create order");
      }

      setOrder(data);
      setStep("payment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const resetFlow = () => {
    setStep("configure");
    setOrder(null);
    setError(null);
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
                    <CreditCard className="w-5 h-5 text-white" />
                  </div>
                  Get a Virtual Card
                </CardTitle>
                <CardDescription>
                  Create a virtual Visa or Mastercard. Pay with SOL, receive your card instantly.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Amount selection */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Card Value (USD)</label>
                  <div className="grid grid-cols-5 gap-2">
                    {[25, 50, 100, 250].map((value) => (
                      <button
                        key={value}
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
                      onClick={() => {
                        const input = document.getElementById("custom-amount-input") as HTMLInputElement;
                        input?.focus();
                        input?.select();
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
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      id="custom-amount-input"
                      type="text"
                      inputMode="numeric"
                      value={amountInput}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Allow empty string or valid numbers
                        if (value === "" || /^\d+$/.test(value)) {
                          setAmountInput(value);
                          const numValue = value === "" ? 0 : Number(value);
                          if (numValue >= 5 && numValue <= 10000) {
                            setAmount(numValue);
                          }
                          // Allow empty input while typing
                        }
                      }}
                      onBlur={() => {
                        // If empty or invalid, reset to 50
                        if (amountInput === "" || amount < 5 || amount > 10000) {
                          const validAmount = 50;
                          setAmount(validAmount);
                          setAmountInput(validAmount.toString());
                        }
                      }}
                      className="bg-card border-2 border-border pl-7 pr-3"
                      placeholder="5 - 10,000"
                    />
                  </div>
                </div>

                {/* Card type selection */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Card Type</label>
                  <div className="grid grid-cols-2 gap-3">
                    {(["visa", "mastercard"] as CardType[]).map((type) => (
                      <button
                        key={type}
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

                {/* Email */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Email (for card delivery)</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-card border-2 border-border"
                    placeholder="you@example.com"
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-red-100 dark:bg-red-500/10 border-2 border-red-400 text-red-700 dark:text-red-200 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleCreateOrder}
                  disabled={isLoading || amount < 5 || amount > 10000}
                  className="w-full py-6 text-lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Creating order...
                    </>
                  ) : (
                    <>
                      Continue to Payment
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Your card will be delivered to your email after payment is confirmed.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Step 2: Payment */}
        {step === "payment" && order && (
          <motion.div
            key="payment"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-honey-100 dark:bg-amber-500/20 border-2 border-honey-400 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-honey-600 dark:text-amber-400 animate-spin" />
                  </div>
                  Awaiting Payment
                </CardTitle>
                <CardDescription>
                  Send exactly {order.payment.amountSol} SOL to the address below
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-4 rounded-xl bg-secondary border-2 border-border space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Card Value</span>
                    <span className="font-medium">${order.pricing.cardValue}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Fee ({order.pricing.starpayFeePercent}%)</span>
                    <span className="font-medium">${order.pricing.starpayFee.toFixed(2)}</span>
                  </div>
                  <div className="border-t-2 border-border pt-3 flex justify-between">
                    <span className="font-medium">Total</span>
                    <span className="font-semibold text-lg">${order.pricing.total.toFixed(2)}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium">Send SOL to this address</label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={order.payment.address}
                      readOnly
                      className="bg-card border-2 border-border font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCopy(order.payment.address, "address")}
                      className="shrink-0"
                    >
                      {copied === "address" ? (
                        <Check className="w-4 h-4 text-hop-600 dark:text-hop-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-hop-100 dark:bg-hop-500/20 border-2 border-hop-400">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Amount to send</span>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-hop-700 dark:text-hop-300">{order.payment.amountSol} SOL</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(order.payment.amountSol.toString(), "amount")}
                        className="shrink-0"
                      >
                        {copied === "amount" ? (
                          <Check className="w-4 h-4 text-hop-600 dark:text-hop-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    SOL price: ${order.payment.solPrice.toFixed(2)}
                  </p>
                </div>

                <div className="text-sm text-muted-foreground text-center space-y-1">
                  <p>Waiting for payment confirmation...</p>
                  <p className="text-xs">
                    Order expires at {new Date(order.expiresAt).toLocaleTimeString()}
                  </p>
                </div>

                <Button variant="ghost" onClick={resetFlow} className="w-full">
                  Cancel and start over
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Step 3: Processing */}
        {step === "processing" && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card>
              <CardContent className="py-16 text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-hop-500 border-2 border-hop-600 mx-auto flex items-center justify-center animate-pulse">
                  <CreditCard className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Issuing Your Card</h3>
                  <p className="text-muted-foreground">
                    Payment received! Your virtual card is being created...
                  </p>
                </div>
                <Loader2 className="w-8 h-8 mx-auto text-hop-600 dark:text-hop-400 animate-spin" />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Step 4: Complete */}
        {step === "complete" && order && (
          <motion.div
            key="complete"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card className="border-2 border-hop-400">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-hop-200 dark:bg-hop-500/20 border-2 border-hop-500 flex items-center justify-center">
                    <Check className="w-5 h-5 text-hop-600 dark:text-hop-400" />
                  </div>
                  Card Issued!
                </CardTitle>
                <CardDescription>
                  Your ${order.pricing.cardValue} {cardType.toUpperCase()} card is ready
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {order.card ? (
                  <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-600 space-y-4 text-white">
                    <div className="flex justify-between items-start">
                      <span className="text-xs text-slate-400 uppercase">{cardType}</span>
                      <span className="text-lg font-bold">${order.pricing.cardValue}</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-slate-400">Card Number</p>
                      <p className="font-mono text-lg tracking-wider">{order.card.number}</p>
                    </div>
                    <div className="flex gap-8">
                      <div>
                        <p className="text-xs text-slate-400">Expiry</p>
                        <p className="font-mono">{order.card.expiry}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">CVV</p>
                        <p className="font-mono">{order.card.cvv}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400 text-center">
                    <p className="text-hop-700 dark:text-hop-200">
                      Card details have been sent to <strong>{email}</strong>
                    </p>
                  </div>
                )}

                <Button onClick={resetFlow} className="w-full">
                  Get Another Card
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Error state */}
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
                <Button onClick={resetFlow}>
                  Try Again
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
