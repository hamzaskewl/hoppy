"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Copy,
  Loader2,
  RefreshCw,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  loadHistory,
  upsertEntry,
  deleteEntry,
  normalizeServerStatus,
  TERMINAL_STATUSES,
  type CardHistoryEntry,
} from "@/lib/card/local-history";
import {
  colorForSlug,
  shortLabelFor,
  domainForSlug,
  logoUrlForDomain,
} from "@/lib/card/featured-products";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function StatusBadge({ status }: { status: CardHistoryEntry["status"] }) {
  const cfg = {
    pending: { label: "Processing", cls: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/40" },
    ready: { label: "Ready", cls: "bg-hop-100 text-hop-900 border-hop-300 dark:bg-hop-500/10 dark:text-hop-200 dark:border-hop-500/40" },
    claimed: { label: "Claimed", cls: "bg-muted text-muted-foreground border-border" },
    refunded: { label: "Refunded", cls: "bg-muted text-muted-foreground border-border" },
    failed: { label: "Failed", cls: "bg-red-100 text-red-900 border-red-300 dark:bg-red-500/10 dark:text-red-200 dark:border-red-500/40" },
    expired: { label: "Expired", cls: "bg-muted text-muted-foreground border-border" },
  }[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn("text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border font-medium", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

function HistoryAvatar({ slug, name }: { slug: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const logoUrl = logoUrlForDomain(domainForSlug(slug));
  const color = colorForSlug(slug);
  const label = shortLabelFor(name);
  if (logoUrl && !failed) {
    return (
      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border-2 border-border shrink-0 p-1.5 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={name} className="max-w-full max-h-full object-contain" onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div
      className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold border-2 border-border shrink-0"
      style={{ backgroundColor: color }}
    >
      {label}
    </div>
  );
}

export function CardHistory() {
  const { publicKey } = useWallet();
  const [entries, setEntries] = useState<CardHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const wallet = publicKey?.toBase58() ?? null;

  const load = useCallback(async () => {
    if (!wallet) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const list = await loadHistory(wallet);
    setEntries(list);
    setLoading(false);
  }, [wallet]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCopy = (link: string, orderId: string) => {
    navigator.clipboard.writeText(link);
    setCopied(orderId);
    setTimeout(() => setCopied(null), 2000);
  };

  const refreshOne = useCallback(
    async (entry: CardHistoryEntry, walletAddr: string): Promise<CardHistoryEntry[] | null> => {
      try {
        const res = await fetch(`/api/card/status?orderId=${entry.orderId}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.status) return null;
        const nextStatus = normalizeServerStatus(String(data.status));
        if (nextStatus === entry.status && !(nextStatus === "ready" && data.claimLink && !entry.claimLink)) {
          return null;
        }
        const patch: Partial<CardHistoryEntry> & { orderId: string } = {
          orderId: entry.orderId,
          status: nextStatus,
        };
        if (nextStatus === "ready" && data.claimLink) patch.claimLink = data.claimLink;
        return await upsertEntry(patch, walletAddr);
      } catch {
        return null;
      }
    },
    [],
  );

  const handleRefresh = async (entry: CardHistoryEntry) => {
    if (!wallet) return;
    setRefreshing(entry.orderId);
    try {
      const next = await refreshOne(entry, wallet);
      if (next) setEntries(next);
    } finally {
      setRefreshing(null);
    }
  };

  // Auto-reconcile non-terminal entries with the server once per (wallet,
  // load) cycle. Without this, an order whose recipient already claimed
  // (server status flipped to "claimed") would sit in the buyer's local
  // history showing "ready" — same problem for orders the buyer left
  // mid-flow showing "pending".
  const reconciledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!wallet || loading) return;
    if (reconciledRef.current === wallet) return;
    reconciledRef.current = wallet;
    let cancelled = false;
    (async () => {
      const stale = entries.filter((e) => !TERMINAL_STATUSES.has(e.status));
      if (stale.length === 0) return;
      let latest: CardHistoryEntry[] | null = null;
      for (const entry of stale) {
        if (cancelled) return;
        const updated = await refreshOne(entry, wallet);
        if (updated) latest = updated;
      }
      if (!cancelled && latest) setEntries(latest);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, loading]);

  const handleDelete = async (orderId: string) => {
    if (!wallet) return;
    const next = await deleteEntry(orderId, wallet);
    setEntries(next);
  };

  if (!wallet) return null;
  if (loading) return null;
  if (entries.length === 0) return null;

  return (
    <div className="max-w-2xl mx-auto mb-8">
      <div className="rounded-2xl bg-card border-2 border-border p-4 md:p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold">Your Orders</h2>
            <p className="text-xs text-muted-foreground">
              Saved locally — only visible to this wallet on this browser.
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {entries.map((entry) => (
              <motion.li
                key={entry.orderId}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex items-center gap-3 p-3 rounded-xl bg-secondary/40 border border-border"
              >
                <HistoryAvatar slug={entry.productSlug} name={entry.productName} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{entry.productName}</p>
                    <span className="text-xs text-muted-foreground">${entry.amount}</span>
                    <StatusBadge status={entry.status} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {timeAgo(entry.createdAt)} · <span className="font-mono">{entry.orderId.slice(0, 12)}…</span>
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {entry.status === "ready" && entry.claimLink && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => handleCopy(entry.claimLink!, entry.orderId)}
                        title="Copy claim link"
                      >
                        {copied === entry.orderId ? (
                          <Check className="w-3.5 h-3.5 text-hop-600 dark:text-hop-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </Button>
                      <a
                        href={entry.claimLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-hop-500 hover:bg-hop-600 text-white text-xs font-medium transition-colors"
                      >
                        Open
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </>
                  )}

                  {entry.status === "pending" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => handleRefresh(entry)}
                      disabled={refreshing === entry.orderId}
                      title="Check status"
                    >
                      {refreshing === entry.orderId ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                    onClick={() => handleDelete(entry.orderId)}
                    title="Remove from history"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
