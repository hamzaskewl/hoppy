"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  Check,
  Home,
  AlertTriangle,
  Gift,
  Eye,
  EyeOff,
  ExternalLink,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  parseClaimHash,
  decryptCardDetailsClient,
  CardDetails,
  EncryptedCard,
} from "@/lib/card/client-decryption";

type ClaimStatus = "loading" | "decrypting" | "ready" | "error";

export function CardClaimPage() {
  const [status, setStatus] = useState<ClaimStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<CardDetails | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const claim = async () => {
      try {
        const parsed = parseClaimHash(window.location.hash);
        if (!parsed) {
          setError("Invalid claim link. The link may be corrupted or incomplete.");
          setStatus("error");
          return;
        }

        setOrderId(parsed.orderId);

        const response = await fetch(`/api/card/claim?id=${parsed.orderId}`);
        const data = await response.json();

        if (!response.ok) {
          if (data.status === "pending" || data.status === "paid") {
            setError("Your card is still being processed. Please wait a few minutes and try again.");
          } else {
            setError(data.error || "Failed to fetch card");
          }
          setStatus("error");
          return;
        }

        setStatus("decrypting");

        const decrypted = await decryptCardDetailsClient(
          data.encryptedCard as EncryptedCard,
          parsed.key
        );

        setCard(decrypted);
        setStatus("ready");
      } catch (err) {
        console.error("Claim error:", err);
        setError(err instanceof Error ? err.message : "Failed to claim card");
        setStatus("error");
      }
    };

    claim();
  }, []);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const isLegacyPan = !!card?.number; // Pre-Bitrefill claim links carried raw PAN
  const hasCardArtifact = !!card?.redemptionCode || !!card?.pin;

  return (
    <div className="min-h-screen py-12 px-4 bg-background">
      <header className="max-w-md mx-auto mb-8">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground bg-card hover:bg-muted border border-border rounded-full transition-colors"
          >
            <Home className="w-4 h-4" />
            Home
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-hop-200 dark:bg-hop-800 border-2 border-hop-400">
            <Image src="/hoppy-logo.png" alt="hoppy" width={40} height={40} className="object-cover" />
          </div>
          <div>
            <h1 className="text-xl">hoppy</h1>
            <p className="text-sm text-muted-foreground">Gift Card Claim</p>
          </div>
        </div>
      </header>

      <Card className="max-w-md mx-auto">
        <AnimatePresence mode="wait">
          {(status === "loading" || status === "decrypting") && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <CardContent className="py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-hop-100 dark:bg-hop-500/20 border-2 border-hop-400 mx-auto flex items-center justify-center mb-6">
                  <Gift className="w-8 h-8 text-hop-600 dark:text-hop-400 animate-pulse" />
                </div>
                <h3 className="text-lg mb-2">
                  {status === "loading" ? "Loading..." : "Decrypting Card..."}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {status === "loading" ? "Fetching your gift card" : "Securely decrypting card details"}
                </p>
              </CardContent>
            </motion.div>
          )}

          {status === "ready" && card && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <CardHeader className="text-center pb-2">
                <div className="w-12 h-12 rounded-full bg-hop-200 dark:bg-hop-500/20 border-2 border-hop-500 mx-auto flex items-center justify-center mb-2">
                  <Check className="w-6 h-6 text-hop-600 dark:text-hop-400" />
                </div>
                <CardTitle>Your Gift Card</CardTitle>
                <CardDescription>
                  ${card.value} {card.productName}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Redemption artifact card — renders if we have a code OR a PIN
                    (or both). PIN-only products like Uber Eats get a clean
                    single-field card; code+PIN products like prepaid Visa get
                    both stacked. */}
                {hasCardArtifact && (
                  <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-600 text-white space-y-4">
                    <div className="flex justify-between items-start">
                      <span className="text-xs text-slate-400 uppercase">{card.productName}</span>
                      <span className="text-lg">${card.value}</span>
                    </div>

                    {card.redemptionCode && (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400">Redemption Code</p>
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-lg tracking-wider break-all">
                            {showDetails
                              ? card.redemptionCode
                              : "•".repeat(Math.min(card.redemptionCode.length, 20))}
                          </p>
                          <button
                            onClick={() => handleCopy(card.redemptionCode!, "code")}
                            className="p-1 hover:bg-slate-700 rounded shrink-0"
                          >
                            {copied === "code" ? (
                              <Check className="w-4 h-4 text-hop-400" />
                            ) : (
                              <Copy className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {card.pin && (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400">
                          {card.redemptionCode ? "PIN" : "Gift Code"}
                        </p>
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-lg tracking-wider break-all">
                            {showDetails
                              ? card.pin
                              : "•".repeat(Math.min(card.pin.length, 20))}
                          </p>
                          <button
                            onClick={() => handleCopy(card.pin!, "pin")}
                            className="p-1 hover:bg-slate-700 rounded shrink-0"
                          >
                            {copied === "pin" ? (
                              <Check className="w-4 h-4 text-hop-400" />
                            ) : (
                              <Copy className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Redemption URL — separate block so URL-only products still get a CTA */}
                {card.redemptionUrl && (
                  <a
                    href={card.redemptionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-4 rounded-xl bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400 hover:border-hop-500 transition-colors"
                  >
                    <p className="text-xs text-muted-foreground mb-1">Redeem at</p>
                    <p className="text-sm text-hop-700 dark:text-hop-300 break-all flex items-center gap-2">
                      {card.redemptionUrl}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </p>
                  </a>
                )}

                {/* Instructions from Bitrefill, when present — preserves the newlines
                    in the source so step-by-step lists render cleanly. */}
                {card.instructions && (
                  <div className="p-4 rounded-xl bg-muted/40 border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="w-4 h-4 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">
                        How to redeem
                      </p>
                    </div>
                    <p className="text-sm whitespace-pre-line text-foreground/90">
                      {card.instructions.trim()}
                    </p>
                  </div>
                )}

                {/* Legacy raw-PAN cards */}
                {isLegacyPan && card.number && (
                  <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-600 text-white space-y-4">
                    <div className="flex justify-between items-start">
                      <span className="text-xs text-slate-400 uppercase">
                        {card.cardType || card.productName}
                      </span>
                      <span className="text-lg">${card.value}</span>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-slate-400">Card Number</p>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-lg tracking-wider">
                          {showDetails
                            ? card.number.replace(/(.{4})/g, "$1 ").trim()
                            : "•••• •••• •••• " + card.number.slice(-4)}
                        </p>
                        <button
                          onClick={() => handleCopy(card.number!, "number")}
                          className="p-1 hover:bg-slate-700 rounded"
                        >
                          {copied === "number" ? (
                            <Check className="w-4 h-4 text-hop-400" />
                          ) : (
                            <Copy className="w-4 h-4 text-slate-400" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-8">
                      <div>
                        <p className="text-xs text-slate-400">Expiry</p>
                        <p className="font-mono">{showDetails ? card.expiry : "••/••"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">CVV</p>
                        <div className="flex items-center gap-2">
                          <p className="font-mono">{showDetails ? card.cvv : "•••"}</p>
                          <button
                            onClick={() => handleCopy(card.cvv!, "cvv")}
                            className="p-1 hover:bg-slate-700 rounded"
                          >
                            {copied === "cvv" ? (
                              <Check className="w-3 h-3 text-hop-400" />
                            ) : (
                              <Copy className="w-3 h-3 text-slate-400" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <Button variant="outline" onClick={() => setShowDetails(!showDetails)} className="w-full">
                  {showDetails ? (
                    <>
                      <EyeOff className="w-4 h-4 mr-2" />
                      Hide Details
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4 mr-2" />
                      Show Full Details
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Save these details — this link can only be used once.
                </p>
              </CardContent>
            </motion.div>
          )}

          {status === "error" && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <CardContent className="py-12 text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/20 border-2 border-red-400 mx-auto flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg mb-2">Claim Failed</h3>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
                {orderId && <p className="text-xs text-muted-foreground">Order ID: {orderId}</p>}
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Try Again
                </Button>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <div className="max-w-md mx-auto mt-8 p-4 rounded-xl bg-card border-2 border-border">
        <h3 className="mb-2 text-sm">Privacy Protected</h3>
        <p className="text-xs text-muted-foreground">
          The card details were encrypted with a key only you have (in this URL).
          The server never sees your decryption key.
        </p>
      </div>
    </div>
  );
}
