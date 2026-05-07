"use client";

import { useEffect, useMemo, useState } from "react";
import bs58 from "bs58";
import Image from "next/image";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  Wallet,
  Check,
  AlertTriangle,
  Sparkles,
  Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { lamportsToSol, shortenAddress } from "@/lib/utils";
import type { UmbraNote } from "@/lib/payroll/types";

type Phase = "loading" | "ready" | "claiming" | "claimed" | "error";

export function PayrollClaim() {
  const { publicKey, connected } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const [note, setNote] = useState<UmbraNote | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const recipientWallet = useMemo<string | null>(
    () => publicKey?.toBase58() ?? null,
    [publicKey],
  );

  // Decode the note from the URL hash on mount.
  useEffect(() => {
    try {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) {
        setError("No payment data in URL");
        setPhase("error");
        return;
      }
      const json = new TextDecoder().decode(bs58.decode(hash));
      const parsed = JSON.parse(json) as UmbraNote;
      if (parsed.version !== 1) throw new Error("unsupported note version");
      setNote(parsed);
      setPhase("ready");
    } catch {
      setError("Invalid or corrupted link");
      setPhase("error");
    }
  }, []);

  const handleClaim = async () => {
    if (!note || !recipientWallet) return;
    setPhase("claiming");
    setError(null);
    try {
      const res = await fetch("/api/umbra/payroll/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, recipientAddress: recipientWallet }),
      });
      const json = (await res.json()) as {
        withdrawTxHash?: string;
        error?: string;
      };
      if (!res.ok || !json.withdrawTxHash) {
        throw new Error(json.error ?? "claim failed");
      }
      setTxHash(json.withdrawTxHash);
      setPhase("claimed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "claim failed");
      setPhase("error");
    }
  };

  if (phase === "loading") {
    return <div className="text-center py-16 text-muted-foreground">…</div>;
  }

  if (phase === "error" && !note) {
    return (
      <div className="rounded-2xl bg-card border-2 border-border p-8 text-center space-y-3">
        <AlertTriangle className="w-12 h-12 mx-auto text-destructive" />
        <h2 className="text-xl font-semibold">Couldn&apos;t load this link</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (phase === "claimed") {
    return (
      <div className="rounded-2xl bg-card border-2 border-hop-400 p-8 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-hop-100 dark:bg-hop-900/40 flex items-center justify-center">
          <Check className="w-8 h-8 text-hop-600 dark:text-hop-300" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Payment claimed</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {note ? lamportsToSol(note.amount).toFixed(4) : "—"} SOL is on its
            way to {recipientWallet && shortenAddress(recipientWallet, 6)}.
          </p>
        </div>
        {txHash && (
          <div className="text-xs font-mono text-muted-foreground break-all px-4">
            tx: {txHash}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card border-2 border-border p-8 space-y-5">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-hop-400 bg-hop-100 dark:bg-hop-900/40 flex items-center justify-center">
          <Image
            src="/hopbunny.png"
            alt=""
            width={56}
            height={56}
            className="object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          {note?.from ? (
            <>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                You&apos;ve been paid by
              </div>
              <div className="text-base font-semibold truncate">
                {note.from}
              </div>
            </>
          ) : (
            <div className="text-base font-semibold">You&apos;ve been paid</div>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-muted/40 border border-border p-5 text-center">
        <div className="text-xs text-muted-foreground">Amount</div>
        <div className="text-4xl font-bold tabular-nums mt-1">
          {note ? lamportsToSol(note.amount).toFixed(4) : "—"}{" "}
          <span className="text-2xl text-muted-foreground">SOL</span>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {!connected || !recipientWallet ? (
        <Button onClick={() => openWalletModal(true)} size="lg" className="w-full">
          <Wallet className="w-5 h-5" />
          Connect wallet to claim
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground text-center">
            Sending to{" "}
            <span className="font-mono">
              {shortenAddress(recipientWallet, 6)}
            </span>
          </div>
          <Button
            onClick={handleClaim}
            loading={phase === "claiming"}
            disabled={phase === "claiming"}
            size="lg"
            className="w-full"
          >
            <Sparkles className="w-5 h-5" />
            Claim payment
          </Button>
        </div>
      )}
    </div>
  );
}
