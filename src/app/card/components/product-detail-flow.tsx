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
  ExternalLink,
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
import {
  colorForSlug,
  shortLabelFor,
  domainForSlug,
  logoUrlForDomain,
} from "@/lib/card/featured-products";
import { upsertEntry } from "@/lib/card/local-history";

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
  payment: {
    /** Where the user signs to send. For private flow this is the escrow. */
    address: string;
    amount: number;
    /** Exact integer lamports — preferred for the wallet transfer. */
    amountAtomic?: number;
    currency: string;
    /** True when the address is a Hoppy escrow that mixes through Umbra. */
    privateFlow?: boolean;
    /** Bitrefill payout address — only shown for transparency. */
    bitrefillAddress?: string;
    bitrefillAmount?: number;
    bitrefillAmountAtomic?: number;
    escrowAddress?: string;
  };
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

/**
 * Resolve the active Solana cluster from the env var. Defaults to
 * mainnet so production deploys with NEXT_PUBLIC_SOLANA_NETWORK unset
 * don't display 'devnet' alongside real mainnet transactions.
 */
function clusterName(): "mainnet-beta" | "devnet" {
  const v = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || "").trim().toLowerCase();
  return v === "devnet" ? "devnet" : "mainnet-beta";
}

function solscanCluster(): "" | "?cluster=devnet" {
  return clusterName() === "devnet" ? "?cluster=devnet" : "";
}

function networkLabel(): string {
  return clusterName() === "devnet" ? "devnet" : "mainnet";
}

interface Stage {
  id: string;
  label: string;
  description: string;
  /** Approximate elapsed time when this stage typically completes. */
  expectedDuration: string;
}

const PROGRESS_STAGES: Stage[] = [
  {
    id: "depositing",
    label: "Deposit",
    description: "Confirming your SOL hit the per-order escrow",
    expectedDuration: "~10s",
  },
  {
    id: "mixing",
    label: "Mix",
    description: "Encrypting balance + creating receiver-claimable UTXO",
    expectedDuration: "~60s",
  },
  {
    id: "withdrawing",
    label: "Withdraw",
    description: "Stealth address claims the UTXO and unwraps to SOL",
    expectedDuration: "~90s",
  },
  {
    id: "paying",
    label: "Pay",
    description: "Stealth sends the exact amount to the card provider",
    expectedDuration: "~10s",
  },
  {
    id: "paid",
    label: "Confirm",
    description: "Card provider received payment, processing your card",
    expectedDuration: "~1-5min",
  },
  {
    id: "ready",
    label: "Ready",
    description: "Claim link generated and shown below",
    expectedDuration: "—",
  },
];

function stageIndex(status: string | null): number {
  if (!status) return 0;
  const i = PROGRESS_STAGES.findIndex((s) => s.id === status);
  return i < 0 ? 0 : i;
}

function DetailRow({
  label,
  value,
  subtitle,
  mono,
  truncate,
  link,
  accent,
}: {
  label: string;
  value: string;
  subtitle?: string;
  mono?: boolean;
  truncate?: boolean;
  link?: string;
  accent?: boolean;
}) {
  const display = (
    <span
      className={cn(
        mono && "font-mono",
        truncate && "truncate",
        accent && "text-hop-700 dark:text-hop-300 font-medium"
      )}
    >
      {value}
    </span>
  );
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1 min-w-0">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate underline hover:text-hop-700 dark:hover:text-hop-300 transition-colors"
          >
            {display}
          </a>
        ) : (
          display
        )}
      </div>
      {subtitle && (
        <p className="text-[10px] text-muted-foreground/70">{subtitle}</p>
      )}
    </div>
  );
}

function MixingTimeline({ status }: { status: string | null }) {
  const activeIdx = stageIndex(status);

  return (
    <ol className="relative space-y-1">
      {PROGRESS_STAGES.map((stage, i) => {
        const isDone = i < activeIdx;
        const isActive = i === activeIdx;
        const isLast = i === PROGRESS_STAGES.length - 1;

        return (
          <li key={stage.id} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Vertical connector line */}
            {!isLast && (
              <div
                aria-hidden
                className={cn(
                  "absolute left-[15px] top-8 bottom-0 w-px transition-colors",
                  isDone ? "bg-hop-500" : "bg-border"
                )}
              />
            )}

            {/* Status dot/icon */}
            <div className="relative z-10 flex-shrink-0">
              <motion.div
                initial={false}
                animate={{
                  scale: isActive ? [1, 1.08, 1] : 1,
                }}
                transition={{
                  duration: 1.4,
                  repeat: isActive ? Infinity : 0,
                  ease: "easeInOut",
                }}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors",
                  isDone && "bg-hop-500 border-hop-600",
                  isActive && "bg-hop-500 border-hop-600 shadow-lg shadow-hop-500/40",
                  !isDone && !isActive && "bg-card border-border"
                )}
              >
                {isDone ? (
                  <Check className="w-4 h-4 text-white" />
                ) : isActive ? (
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                )}
              </motion.div>
            </div>

            {/* Stage label + description */}
            <div className="flex-1 pt-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={cn(
                    "text-sm font-medium transition-colors",
                    (isDone || isActive) ? "text-foreground" : "text-muted-foreground/60"
                  )}
                >
                  {stage.label}
                </p>
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wide font-medium shrink-0",
                    isActive ? "text-hop-600 dark:text-hop-400" : "text-muted-foreground/50"
                  )}
                >
                  {isDone ? "✓ done" : isActive ? "in progress" : stage.expectedDuration}
                </span>
              </div>
              <AnimatePresence mode="wait">
                {(isActive || isDone) && (
                  <motion.p
                    key={`${stage.id}-desc`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      "text-xs leading-relaxed mt-0.5",
                      isActive ? "text-foreground/80" : "text-muted-foreground/70"
                    )}
                  >
                    {stage.description}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function DetailAvatar({
  logoUrl,
  color,
  label,
  alt,
}: {
  logoUrl: string | null;
  color: string;
  label: string;
  alt: string;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  if (logoUrl && !logoFailed) {
    return (
      <div className="w-14 h-14 rounded-xl bg-white flex items-center justify-center border-2 border-border shrink-0 p-2 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={alt}
          className="max-w-full max-h-full object-contain"
          onError={() => setLogoFailed(true)}
        />
      </div>
    );
  }
  return (
    <div
      className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold border-2 border-border shrink-0"
      style={{ backgroundColor: color }}
    >
      {label}
    </div>
  );
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
  const { publicKey, connected, sendTransaction, signMessage } = useWallet();
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
        // Belt-and-suspenders: if the upstream lost the slug, restore it from
        // the prop so we don't end up sending productSlug:undefined later.
        const safe: ProductDetail = { ...p, slug: p.slug || productSlug };
        setProduct(safe);
        // Snap initialAmount into the valid range if necessary.
        if (safe.range) {
          const target = Math.max(safe.range.min, Math.min(safe.range.max, amount));
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

  const [orderStatus, setOrderStatus] = useState<string | null>(null);

  // Poll for fulfillment once payment sent. Surfaces orchestration progress
  // (depositing → mixing → withdrawing → paying → paid → ready) so the UI
  // can show the user where in the flow we are.
  useEffect(() => {
    if (!order || step !== "waiting") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/card/status?orderId=${order.orderId}`);
        const data = await res.json();
        if (data.status) setOrderStatus(data.status);
        if (data.status === "ready" && data.claimLink) {
          setOrder((prev) => (prev ? { ...prev, claimLink: data.claimLink } : prev));
          setStep("complete");
          clearInterval(interval);
          if (publicKey) {
            upsertEntry(
              { orderId: order.orderId, status: "ready", claimLink: data.claimLink },
              publicKey.toBase58(),
            ).catch((e) => console.warn("[card-history] update failed:", e));
          }
        } else if (data.status === "failed" || data.status === "expired") {
          setError(
            data.status === "expired"
              ? "Order expired before fulfillment. Try a refund if you sent payment."
              : "Something went wrong while processing. Try a refund — your funds are still in the escrow."
          );
          setStep("error");
          clearInterval(interval);
          if (publicKey) {
            upsertEntry(
              { orderId: order.orderId, status: data.status as "failed" | "expired" },
              publicKey.toBase58(),
            ).catch((e) => console.warn("[card-history] update failed:", e));
          }
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
          userAddress: publicKey.toBase58(),
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
      if (!res.ok) {
        // Bitrefill returns error_code: "not_available" for products that
        // require partner approval the account doesn't have (e.g. Amazon).
        const code = data?.details?.error_code;
        if (code === "not_available") {
          setError(
            "This brand isn't available on our gift card account yet. Try a different one — most brands work fine."
          );
          setIsLoading(false);
          return;
        }
        throw new Error(data.error || "Failed to create order");
      }

      setOrder(data);
      setStep("paying");
      setProgress("Sending payment...");

      // Persist to encrypted local history immediately so the buyer can find
      // this order even after a refresh / new tab / wallet reconnect.
      if (publicKey) {
        upsertEntry(
          {
            orderId: data.orderId,
            productSlug: product.slug,
            productName: product.name,
            amount,
            currency: product.currency || "USD",
            status: "pending",
            createdAt: new Date().toISOString(),
          },
          publicKey.toBase58(),
        ).catch((e) => console.warn("[card-history] save failed:", e));
      }

      // Prefer the exact integer lamports the API gives us. Only fall back to
      // the float roundtrip if a legacy response somehow lacks it.
      const lamports =
        typeof data.payment.amountAtomic === "number"
          ? data.payment.amountAtomic
          : Math.round(data.payment.amount * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(data.payment.address),
          lamports,
        })
      );

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      // For the private flow, kick off the Umbra orchestration. The server
      // takes 3-5 minutes to mix and pay Bitrefill — we fire-and-forget here
      // and the polling effect picks up status updates.
      if (data.payment.privateFlow) {
        setProgress("Starting private mix...");
        const exec = await fetch("/api/card/private-execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: data.orderId, depositTxHash: sig }),
        });
        if (!exec.ok && exec.status !== 202) {
          const execData = await exec.json().catch(() => ({}));
          throw new Error(execData.error || "Failed to start private mix");
        }
      }

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

  const [refundState, setRefundState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "ok"; refundedSol: number; sig?: string }
    | { kind: "noop" }
    | { kind: "fail"; msg: string }
  >({ kind: "idle" });

  const handleRefund = async () => {
    if (!order || !publicKey) {
      setRefundState({ kind: "fail", msg: "Connect the same wallet that placed the order" });
      return;
    }
    if (!signMessage) {
      setRefundState({
        kind: "fail",
        msg: "Your wallet doesn't support signMessage. Try Phantom or Solflare.",
      });
      return;
    }
    setRefundState({ kind: "running" });
    try {
      const challenge = `hoppy-card-refund:${order.orderId}:${publicKey.toBase58()}`;
      const encoded = new TextEncoder().encode(challenge);
      const signatureBytes = await signMessage(encoded);
      const { default: bs58 } = await import("bs58");
      const sigB58 = bs58.encode(signatureBytes);

      const res = await fetch("/api/card/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          userAddress: publicKey.toBase58(),
          challenge,
          signature: sigB58,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refund failed");
      if (data.noop) {
        setRefundState({ kind: "noop" });
      } else {
        const refundedSol = (data.nativeRefunded ?? 0) / 1e9;
        setRefundState({ kind: "ok", refundedSol, sig: data.refundTxHash });
        upsertEntry(
          {
            orderId: order.orderId,
            status: "refunded",
            refundTxHash: data.refundTxHash,
          },
          publicKey.toBase58(),
        ).catch((e) => console.warn("[card-history] refund-update failed:", e));
      }
    } catch (err) {
      setRefundState({ kind: "fail", msg: err instanceof Error ? err.message : String(err) });
    }
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
  const logoUrl = logoUrlForDomain(domainForSlug(product.slug));
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
                  <DetailAvatar logoUrl={logoUrl} color={color} label={label} alt={product.name} />
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

        {step === "paying" && (
          <motion.div
            key="paying"
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
                  <h3 className="text-xl mb-2">Sending Payment</h3>
                  <p className="text-muted-foreground">Confirm in your wallet...</p>
                </div>
                <Loader2 className="w-8 h-8 mx-auto text-hop-600 dark:text-hop-400 animate-spin" />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === "waiting" && (
          <motion.div
            key="waiting"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card>
              <CardContent className="py-8 space-y-6">
                {/* Hero header */}
                <div className="text-center space-y-2 pb-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-hop-100 dark:bg-hop-500/10 border border-hop-400">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-hop-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-hop-500" />
                    </span>
                    <span className="text-xs font-medium text-hop-700 dark:text-hop-300">
                      Privacy mixing in progress
                    </span>
                  </div>
                  <h3 className="text-lg">Your card is being prepared privately</h3>
                  <p className="text-xs text-muted-foreground">
                    Routing through Umbra so the on-chain trail can&apos;t link
                    your wallet to the merchant. Safe to leave the page.
                  </p>
                </div>

                {/* Stage timeline */}
                <div className="px-2">
                  <MixingTimeline status={orderStatus} />
                </div>

                {/* On-chain destination card so the user can watch on Solscan */}
                {order?.payment?.bitrefillAddress &&
                  order.payment.bitrefillAmountAtomic != null && (
                    <div className="rounded-xl bg-gradient-to-br from-secondary to-secondary/70 border-2 border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                          On-chain endpoints
                        </p>
                        <span className="text-[10px] text-muted-foreground">{networkLabel()}</span>
                      </div>

                      <div className="space-y-2.5 text-xs">
                        <DetailRow
                          label="Final amount → merchant"
                          mono
                          value={`${(order.payment.bitrefillAmountAtomic / 1e9).toFixed(9)} SOL`}
                          subtitle={`${order.payment.bitrefillAmountAtomic.toLocaleString()} lamports`}
                          accent
                        />
                        <DetailRow
                          label="Bitrefill address"
                          mono
                          truncate
                          link={`https://solscan.io/account/${order.payment.bitrefillAddress}${solscanCluster()}`}
                          value={order.payment.bitrefillAddress}
                        />
                        {order.payment.escrowAddress && (
                          <DetailRow
                            label="Escrow (your deposit)"
                            mono
                            truncate
                            link={`https://solscan.io/account/${order.payment.escrowAddress}${solscanCluster()}`}
                            value={order.payment.escrowAddress}
                          />
                        )}
                      </div>
                    </div>
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
                    <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0" title="Copy link">
                      {copied ? <Check className="w-4 h-4 text-hop-600" /> : <Copy className="w-4 h-4" />}
                    </Button>
                    <a
                      href={order.claimLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center shrink-0 h-9 w-9 rounded-md border-2 border-border bg-background hover:bg-muted transition-colors"
                      title="Open in new tab"
                      aria-label="Open in new tab"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleCopy} className="flex-1">
                    <LinkIcon className="w-4 h-4 mr-2" />
                    {copied ? "Copied!" : "Copy Claim Link"}
                  </Button>
                  <a
                    href={order.claimLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-4 h-10 rounded-md border-2 border-hop-400 bg-card hover:bg-hop-50 dark:hover:bg-hop-900/30 text-foreground font-medium text-sm transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open
                  </a>
                </div>
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

                {/* Refund flow — only relevant if the user actually sent funds. */}
                {order?.payment?.privateFlow && (
                  <div className="space-y-3 text-left p-4 rounded-xl bg-secondary border-2 border-border">
                    <p className="text-sm font-medium text-foreground">Recover your funds</p>
                    <p className="text-xs text-muted-foreground">
                      Your SOL is in the per-order escrow ({order.payment.escrowAddress?.slice(0, 8)}…).
                      Sign a refund request and we&apos;ll drain it back to your wallet.
                    </p>
                    {refundState.kind === "idle" && (
                      <Button onClick={handleRefund} className="w-full" variant="outline">
                        Refund my SOL
                      </Button>
                    )}
                    {refundState.kind === "running" && (
                      <Button disabled className="w-full">
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing refund…
                      </Button>
                    )}
                    {refundState.kind === "ok" && (
                      <p className="text-xs text-hop-700 dark:text-hop-300">
                        ✓ Refunded {refundState.refundedSol.toFixed(6)} SOL{" "}
                        {refundState.sig && (
                          <a
                            href={`https://solscan.io/tx/${refundState.sig}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            view tx
                          </a>
                        )}
                      </p>
                    )}
                    {refundState.kind === "noop" && (
                      <p className="text-xs text-muted-foreground">
                        Escrow is empty — nothing to refund.
                      </p>
                    )}
                    {refundState.kind === "fail" && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        Refund failed: {refundState.msg}
                      </p>
                    )}
                  </div>
                )}

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
