"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Wallet, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  loadRuns,
  saveRun,
  updateLinkStatus,
  clearAllRuns,
} from "@/lib/payroll/storage";
import type {
  EmployeeRow,
  PayrollLink,
  PayrollRun,
  UmbraNote,
} from "@/lib/payroll/types";
import { lamportsToSol, shortenAddress, solToLamports } from "@/lib/utils";
import { EmployeeTable } from "./employee-table";
import { CsvImport } from "./csv-import";
import { GeneratedLinks } from "./generated-links";
import { PayrollHistory } from "./payroll-history";

type Phase = "idle" | "depositing" | "issuing" | "done";

function emptyRow(): EmployeeRow {
  return { id: crypto.randomUUID(), label: "", amount: "" };
}

export function PayrollDashboard() {
  const { publicKey, connected, sendTransaction, disconnect } = useWallet();
  const { connection } = useConnection();
  const { setVisible: openWalletModal } = useWalletModal();

  const businessWallet = useMemo<string | null>(
    () => publicKey?.toBase58() ?? null,
    [publicKey],
  );

  const [rows, setRows] = useState<EmployeeRow[]>([emptyRow()]);
  const [showCsv, setShowCsv] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PayrollRun[]>([]);
  const [latestRun, setLatestRun] = useState<PayrollRun | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundResult, setRefundResult] = useState<string | null>(null);

  const handleRefund = useCallback(async () => {
    if (!businessWallet) return;
    if (!confirm("Drain ALL escrow funds (encrypted balance + native SOL) back to your wallet? This won't recover funds already issued as employee links.")) return;
    setRefunding(true);
    setRefundResult(null);
    setError(null);
    try {
      const res = await fetch("/api/umbra/payroll/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessWallet }),
      });
      const json = (await res.json()) as {
        encryptedWithdrawn?: number;
        nativeRefunded?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "refund failed");
      const total = (json.encryptedWithdrawn ?? 0) + (json.nativeRefunded ?? 0);
      setRefundResult(
        `Refunded ${(total / 1e9).toFixed(4)} SOL back to your wallet (${((json.encryptedWithdrawn ?? 0) / 1e9).toFixed(4)} from encrypted, ${((json.nativeRefunded ?? 0) / 1e9).toFixed(4)} native).`,
      );
      setPoolBalance(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "refund failed");
    } finally {
      setRefunding(false);
    }
  }, [businessWallet]);

  // Local pool balance: lamports the business has deposited into the Umbra
  // pool but not yet issued as links. Persisted to localStorage per wallet
  // so it survives page refresh.
  const [poolBalance, setPoolBalance] = useState<number>(0);

  const poolBalanceKey = useMemo(
    () => (businessWallet ? `hoppy_payroll_pool_${businessWallet}` : null),
    [businessWallet],
  );

  // Load persisted pool balance whenever wallet changes
  useEffect(() => {
    if (!poolBalanceKey) return;
    try {
      const raw = localStorage.getItem(poolBalanceKey);
      if (raw) {
        const v = parseInt(raw, 10);
        if (!isNaN(v) && v >= 0) setPoolBalance(v);
      }
    } catch {
      /* ignore */
    }
  }, [poolBalanceKey]);

  // Persist pool balance whenever it changes
  useEffect(() => {
    if (!poolBalanceKey) return;
    try {
      localStorage.setItem(poolBalanceKey, String(poolBalance));
    } catch {
      /* ignore */
    }
  }, [poolBalanceKey, poolBalance]);

  // Load history when wallet connects.
  useEffect(() => {
    if (!businessWallet) return;
    void (async () => {
      const runs = await loadRuns(businessWallet);
      setHistory(runs);
    })();
  }, [businessWallet]);

  const totalLamports = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const sol = parseFloat(r.amount);
        return sum + (isNaN(sol) ? 0 : solToLamports(sol));
      }, 0),
    [rows],
  );

  const handleImportCsv = useCallback((imported: EmployeeRow[]) => {
    setRows((prev) => {
      // Replace if the only row is empty; otherwise append.
      const onlyEmpty =
        prev.length === 1 && !prev[0].label && !prev[0].amount;
      return onlyEmpty ? imported : [...prev, ...imported];
    });
  }, []);

  const validateRows = (): string | null => {
    if (rows.length === 0) return "add at least one row";
    for (const r of rows) {
      if (!r.label.trim()) return "every row needs a label";
      const sol = parseFloat(r.amount);
      if (isNaN(sol) || sol <= 0) return `bad amount for ${r.label}`;
    }
    return null;
  };

  const generate = async () => {
    if (!businessWallet) return;
    setError(null);

    const validation = validateRows();
    if (validation) {
      setError(validation);
      return;
    }

    try {
      // 1. Top up pool if needed.
      let poolPositionId: string | null = null;
      let depositTxHash = "";
      if (poolBalance < totalLamports) {
        // Need: sum(amounts) + N × 0.03 SOL stealth funding + 0.2 SOL escrow buffer
        const STEALTH_FUND_BUDGET = 30_000_000;
        const ESCROW_BUFFER = 200_000_000;
        const gasNeeded = rows.length * STEALTH_FUND_BUDGET + ESCROW_BUFFER;
        const amountDelta = totalLamports - poolBalance;
        // Always include enough native gas/rent for issuance to succeed
        const delta = amountDelta + gasNeeded;

        setPhase("depositing");
        setProgress("Resolving escrow address…");
        const escrowRes = await fetch(
          `/api/umbra/payroll/escrow-address?businessWallet=${encodeURIComponent(
            businessWallet,
          )}`,
        );
        const escrowJson = (await escrowRes.json()) as {
          escrowAddress?: string;
          error?: string;
        };
        if (!escrowRes.ok || !escrowJson.escrowAddress) {
          throw new Error(escrowJson.error ?? "could not resolve escrow");
        }
        const escrowPk = new PublicKey(escrowJson.escrowAddress);

        setProgress(
          `Sending ${lamportsToSol(delta).toFixed(4)} SOL to escrow (incl. ${lamportsToSol(gasNeeded).toFixed(2)} SOL gas/rent for ${rows.length} link${rows.length === 1 ? "" : "s"})…`,
        );
        if (!publicKey) {
          throw new Error("Wallet not connected");
        }
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({
          feePayer: publicKey,
          recentBlockhash: blockhash,
        }).add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: escrowPk,
            lamports: delta,
          }),
        );
        const sigStr = await sendTransaction(tx, connection);

        setProgress("Waiting for confirmation…");
        await connection.confirmTransaction(sigStr, "confirmed");

        setProgress(
          "Wrapping SOL → wSOL and depositing into Umbra (this can take 30–120s)…",
        );
        const depositRes = await fetch("/api/umbra/payroll/deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessWallet,
            totalAmount: delta,
            signedDepositTxHash: sigStr,
          }),
        });
        const depositJson = (await depositRes.json()) as {
          poolPositionId?: string;
          depositTxHash?: string;
          error?: string;
        };
        if (!depositRes.ok || !depositJson.poolPositionId) {
          throw new Error(depositJson.error ?? "deposit failed");
        }
        poolPositionId = depositJson.poolPositionId;
        depositTxHash = depositJson.depositTxHash ?? sigStr;
        setPoolBalance((b) => b + delta);
      }

      // 2. Issue one link per row. Each call generates a Groth16 proof and an
      // on-chain UTXO creation tx; expect 30–120s per row.
      setPhase("issuing");
      const links: PayrollLink[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        setProgress(
          `Issuing link ${i + 1} of ${rows.length} (${row.label})… ZK proof can take 30–120s.`,
        );
        const amount = solToLamports(parseFloat(row.amount));
        const res = await fetch("/api/umbra/payroll/issue-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessWallet,
            amount,
            from: shortenAddress(businessWallet, 4),
            origin: window.location.origin,
          }),
        });
        const json = (await res.json()) as {
          note?: UmbraNote;
          claimUrl?: string;
          issueTxHash?: string;
          error?: string;
        };
        if (!res.ok || !json.note || !json.claimUrl) {
          throw new Error(json.error ?? `issue-link failed for ${row.label}`);
        }
        links.push({
          id: crypto.randomUUID(),
          label: row.label,
          wallet: row.wallet,
          email: row.email,
          noteText: row.noteText,
          amount,
          claimUrl: json.claimUrl,
          status: "pending",
          issueTxHash: json.issueTxHash,
        });
      }

      // 3. Drain pool balance and persist run.
      setPoolBalance((b) => Math.max(0, b - totalLamports));
      const run: PayrollRun = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        poolPositionId: poolPositionId ?? "reused",
        depositTxHash,
        totalAmount: totalLamports,
        links,
      };
      await saveRun(run, businessWallet);
      setHistory((h) => [run, ...h]);
      setLatestRun(run);
      setPhase("done");
      setProgress("");
      setRows([emptyRow()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "generate failed";
      setError(message);
      setPhase("idle");
      setProgress("");
    }
  };

  const handleRecall = useCallback(
    async (run: PayrollRun, link: PayrollLink) => {
      if (!businessWallet) return;
      try {
        const note = extractNoteFromClaimUrl(link.claimUrl);
        if (!note) throw new Error("could not parse link");
        const res = await fetch("/api/umbra/payroll/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            note,
            recipientAddress: businessWallet,
            recall: true,
          }),
        });
        const json = (await res.json()) as {
          withdrawTxHash?: string;
          error?: string;
        };
        if (!res.ok || !json.withdrawTxHash) {
          throw new Error(json.error ?? "recall failed");
        }
        await updateLinkStatus(
          run.id,
          link.id,
          { status: "recalled", recallTxHash: json.withdrawTxHash },
          businessWallet,
        );
        setHistory(await loadRuns(businessWallet));
      } catch (err) {
        setError(err instanceof Error ? err.message : "recall failed");
      }
    },
    [businessWallet],
  );

  const handleClearAll = async () => {
    if (!businessWallet) return;
    if (!confirm("Clear all payroll history from this device?")) return;
    await clearAllRuns(businessWallet);
    setHistory([]);
  };

  if (!connected || !businessWallet) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="rounded-2xl bg-card border-2 border-border p-8 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-hop-100 dark:bg-hop-900/40 flex items-center justify-center">
            <Wallet className="w-7 h-7 text-hop-600 dark:text-hop-300" />
          </div>
          <div>
            <h2 className="text-xl ">Connect to start payroll</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Connect a Solana wallet — this becomes the business identity.
              History is encrypted in your browser, scoped to this wallet.
            </p>
          </div>
          <Button onClick={() => openWalletModal(true)} size="lg">
            <Wallet className="w-5 h-5" />
            Connect wallet
          </Button>
        </div>
      </div>
    );
  }

  const busy = phase === "depositing" || phase === "issuing";

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-hop-400 bg-hop-100 dark:bg-hop-900/40">
            <Image
              src="/hopbunny.png"
              alt=""
              width={56}
              height={56}
              className="object-cover"
            />
          </div>
          <div>
            <h1 className="text-2xl  tracking-tight">Payroll</h1>
            <p className="text-sm text-muted-foreground">
              Deposit once, distribute privately to many.
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">
            Pool balance (this device)
          </div>
          <div className="text-2xl  tabular-nums">
            {lamportsToSol(poolBalance).toFixed(4)}{" "}
            <span className="text-base text-muted-foreground">SOL</span>
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1">
            {shortenAddress(businessWallet, 4)} ·{" "}
            <button
              onClick={() => disconnect()}
              className="underline hover:text-foreground"
            >
              disconnect
            </button>
            {" · "}
            <button
              onClick={handleRefund}
              disabled={refunding}
              className="underline hover:text-red-500 disabled:opacity-50"
              title="Drain all funds in your escrow back to this wallet"
            >
              {refunding ? "refunding…" : "refund escrow"}
            </button>
          </div>
        </div>
      </header>
      {refundResult && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-500/30 text-sm text-green-700 dark:text-green-400">
          {refundResult}
        </div>
      )}

      {latestRun && phase === "done" ? (
        <GeneratedLinks
          run={latestRun}
          onDone={() => {
            setLatestRun(null);
            setPhase("idle");
          }}
        />
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base ">New payroll run</h2>
            {busy && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full border-2 border-hop-500 border-t-transparent animate-spin" />
                {progress}
              </div>
            )}
          </div>

          <EmployeeTable
            rows={rows}
            onChange={setRows}
            onImportCsv={() => setShowCsv(true)}
            disabled={busy}
          />

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button onClick={generate} loading={busy} disabled={busy} size="lg">
              <Sparkles className="w-4 h-4" />
              Generate payroll links
            </Button>
          </div>
        </section>
      )}

      <PayrollHistory
        runs={history}
        onRecallLink={handleRecall}
        onClearAll={handleClearAll}
      />

      {showCsv && (
        <CsvImport
          onImport={handleImportCsv}
          onClose={() => setShowCsv(false)}
        />
      )}
    </div>
  );
}

// ---------- helpers ----------

function extractNoteFromClaimUrl(url: string): UmbraNote | null {
  try {
    const hash = url.includes("#") ? url.split("#")[1] : "";
    if (!hash) return null;
    const json = new TextDecoder().decode(bs58.decode(hash));
    const parsed = JSON.parse(json) as UmbraNote;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}
