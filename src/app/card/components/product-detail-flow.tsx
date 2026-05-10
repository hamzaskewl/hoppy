"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  CreditCard,
  Gift,
  Link as LinkIcon,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { colorForSlug, shortLabelFor } from "@/lib/card/featured-products";

type FlowStep = "configure" | "paying" | "waiting" | "complete" | "error";

interface PrepaymentField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  max_length?: number | null;
}

interface ProductDetail {
  slug: string;
  name: string;
  country?: string;
  currency?: string;
  categories?: string[];
  range: { min: number; max: number; step: number; currency: string } | null;
  packages: { package_value: string }[];
  subtitle?: string | null;
  description?: string | null;
  prepayment: { first_form: PrepaymentField[]; instructions?: string } | null;
}

interface OrderResponse {
  orderId: string;
  productName: string;
  payment: { address: string; amount: number; currency: string };
  pricing: { cardValue: number; total: number };
  expiresAt: string;
}

interface OrderState extends OrderResponse {
  claimLink?: string;
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function ProductDetailFlow({
  productSlug,
  initialAmount,
  onBack,
}: {
  productSlug: string;
  initialAmount?: number;
  onBack: () => void;
}) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [productLoading, setProductLoading] = useState(true);

  const [amount, setAmount] = useState<number>(initialAmount ?? 25);
  const [amountInput, setAmountInput] = useState<string>(String(initialAmount ?? 25));
  const [prepaymentForm, setPrepaymentForm] = useState<Record<string, string>>({});
  const [extraFields, setExtraFields] = useState<PrepaymentField[]>([]);

  const [step, setStep] = useState<FlowStep>("configure");
  const [order, setOrder] = useState<OrderState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [copied, setCopied] = useState(false);

  // Load product details on mount.
  useEffect(() => {
    let cancelled = false;
    setProductLoading(true);
    fetch(`/api/card/product-details?slug=${encodeURIComponent(productSlug)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load product");
        return data as ProductDetail;
      })
      .then((p) => {
        if (cancelled) return;
        setProduct(p);
        // Snap initialAmount into the valid range if necessary.
        if (p.range) {
          const target = Math.max(p.range.min, Math.min(p.range.max, amount));
          setAmount(target);
          setAmountInput(String(target));
        }
      })
      .catch((e) => !cancelled && setProductError(e.message))
      .finally(() => !cancelled && setProductLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSlug]);

  // Poll for fulfillment once payment sent.
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

  const requiredPrepaymentFields = useMemo<PrepaymentField[]>(() => {
    if (!product?.prepayment) return [];
    return [
      ...product.prepayment.first_form.filter(
        (f) => f.required && f.id !== "bill_amount" && f.id !== "amount"
      ),
      ...extraFields,
    ];
  }, [product, extraFields]);

  const quickAmounts = useMemo(() => {
    if (!product?.range) return [25, 50, 100, 250];
    const { min, max } = product.range;
    const candidates = [5, 10, 25, 50, 100, 250].filter((v) => v >= min && v <= max);
    if (candidates.length === 0) return [min, Math.round((min + max) / 2), max];
    return candidates.slice(0, 4);
  }, [product]);

  const handlePrepaymentChange = (id: string, value: string) => {
    setPrepaymentForm((prev) => ({ ...prev, [id]: value }));
  };

  const handleCreateOrder = async () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!publicKey || !product) {
      setError("Please connect a Solana wallet");
      return;
    }

    const missing = requiredPrepaymentFields.filter(
      (f) => !prepaymentForm[f.id] || prepaymentForm[f.id].trim() === ""
    );
    if (missing.length) {
      setError(`Missing required field: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      setProgress("Creating order...");
      const res = await fetch("/api/card/gift-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          productSlug: product.slug,
          productName: product.name,
          prepaymentFormData: prepaymentForm,
        }),
      });
      const data = await res.json();

      if (res.status === 422 && data.needsForm?.fields) {
        setExtraFields(data.needsForm.fields as PrepaymentField[]);
        setError("Please fill in the additional fields above.");
        setIsLoading(false);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to create order");

      setOrder(data);
      setStep("paying");
      setProgress("Sending payment...");

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
    setExtraFields([]);
  };

  // ---------- render ----------

  if (productLoading) {
    return (
      <Card>
        <CardContent className="py-16 text-center space-y-4">
          <Loader2 className="w-8 h-8 mx-auto text-hop-600 dark:text-hop-400 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading product...</p>
        </CardContent>
      </Card>
    );
  }

  if (productError || !product) {
    return (
      <Card className="border-2 border-red-400">
        <CardContent className="py-12 text-center space-y-4">
          <AlertTriangle className="w-8 h-8 mx-auto text-red-600 dark:text-red-400" />
          <p className="text-sm">{productError || "Product not found"}</p>
          <Button variant="outline" onClick={onBack}>
            Back to catalog
          </Button>
        </CardContent>
      </Card>
    );
  }

  const color = colorForSlug(product.slug);
  const label = shortLabelFor(product.name);
  const minAmt = product.range?.min ?? 1;
  const maxAmt = product.range?.max ?? 10000;
  const amountInRange = amount >= minAmt && amount <= maxAmt;

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to catalog
      </button>

      <AnimatePresence mode="wait">
        {step === "configure" && (
          <motion.div
            key="configure"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold border-2 border-border shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    {label}
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="truncate">{product.name}</CardTitle>
                    {product.subtitle && (
                      <CardDescription className="truncate">{product.subtitle}</CardDescription>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {product.description && (
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {stripHtml(product.description)}
                  </p>
                )}

                <div className="space-y-3">
                  <label className="text-sm font-medium">
                    Amount ({product.currency || "USD"})
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {quickAmounts.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setAmount(value);
                          setAmountInput(String(value));
                        }}
                        className={cn(
                          "py-3 rounded-xl font-medium transition-all border-2",
                          amount === value && amountInput === String(value)
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
                        !quickAmounts.includes(amount)
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
                    inputMode="decimal"
                    value={amountInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^\d+(\.\d{0,2})?$/.test(v)) {
                        setAmountInput(v);
                        const num = v === "" ? 0 : Number(v);
                        if (num >= minAmt && num <= maxAmt) setAmount(num);
                      }
                    }}
                    onBlur={() => {
                      if (amountInput === "" || amount < minAmt) {
                        const fallback = Math.max(minAmt, 25);
                        setAmount(fallback);
                        setAmountInput(String(fallback));
                      }
                    }}
                    className="bg-card border-2 border-border"
                    placeholder={`${minAmt} - ${maxAmt}`}
                  />
                  {product.range && (
                    <p className="text-xs text-muted-foreground">
                      Range: ${minAmt} – ${maxAmt}
                    </p>
                  )}
                </div>

                {requiredPrepaymentFields.length > 0 && (
                  <div className="space-y-3 p-4 rounded-xl bg-secondary border-2 border-border">
                    <p className="text-sm font-medium">Card details</p>
                    {requiredPrepaymentFields.map((field) => (
                      <div key={field.id} className="space-y-1">
                        <label className="text-xs text-muted-foreground">{field.label}</label>
                        <Input
                          type={field.type === "email" ? "email" : "text"}
                          maxLength={field.max_length || undefined}
                          value={prepaymentForm[field.id] || ""}
                          onChange={(e) => handlePrepaymentChange(field.id, e.target.value)}
                          className="bg-card border-2 border-border"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-xl bg-red-100 dark:bg-red-500/10 border-2 border-red-400 text-red-700 dark:text-red-200 text-sm flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleCreateOrder}
                  disabled={isLoading || !amountInRange}
                  className="w-full py-6 text-lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      {progress || "Processing..."}
                    </>
                  ) : !connected ? (
                    "Connect Wallet"
                  ) : (
                    <>
                      Buy ${amount} {product.name}
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Pay with SOL — you&apos;ll get a private claim link to share or keep.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

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
                      {copied ? <Check className="w-4 h-4 text-hop-600" /> : <Copy className="w-4 h-4" />}
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
                <Button variant="outline" onClick={onBack} className="w-full">
                  Back to catalog
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

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
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={onBack}>
                    Catalog
                  </Button>
                  <Button onClick={resetFlow}>Try Again</Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
