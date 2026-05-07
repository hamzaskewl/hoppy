"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Trash2,
  Undo2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { lamportsToSol } from "@/lib/utils";
import { summarize } from "@/lib/payroll/storage";
import type { PayrollRun, PayrollLink } from "@/lib/payroll/types";

export interface PayrollHistoryProps {
  runs: PayrollRun[];
  onRecallLink: (run: PayrollRun, link: PayrollLink) => Promise<void>;
  onClearAll: () => void;
}

export function PayrollHistory({
  runs,
  onRecallLink,
  onClearAll,
}: PayrollHistoryProps) {
  const [openId, setOpenId] = useState<string | null>(runs[0]?.id ?? null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recallingId, setRecallingId] = useState<string | null>(null);

  const copy = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // ignore
    }
  };

  if (runs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8 border-2 border-dashed border-border rounded-xl">
        No payroll runs yet. Generate links above to start tracking history.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">History (local)</h3>
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          <Trash2 className="w-4 h-4" />
          Clear all
        </Button>
      </div>

      <div className="space-y-2">
        {runs.map((run) => {
          const stats = summarize(run);
          const open = openId === run.id;
          const date = new Date(run.createdAt).toISOString().split("T")[0];
          return (
            <div
              key={run.id}
              className="rounded-xl border-2 border-border bg-card overflow-hidden"
            >
              <button
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors text-left"
                onClick={() => setOpenId(open ? null : run.id)}
              >
                {open ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="text-sm flex-1 min-w-0 truncate">
                  <span className="font-medium">{date}</span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {stats.total} employee{stats.total === 1 ? "" : "s"}
                    {" · "}
                    {lamportsToSol(run.totalAmount).toFixed(4)} SOL
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {stats.claimed > 0 && (
                    <span className="px-2 py-0.5 rounded bg-hop-500/15 text-hop-700 dark:text-hop-300">
                      {stats.claimed} claimed
                    </span>
                  )}
                  {stats.pending > 0 && (
                    <span className="px-2 py-0.5 rounded bg-honey-500/15 text-honey-700 dark:text-honey-300">
                      {stats.pending} pending
                    </span>
                  )}
                  {stats.recalled > 0 && (
                    <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {stats.recalled} recalled
                    </span>
                  )}
                </div>
              </button>

              {open && (
                <div className="border-t border-border divide-y divide-border/60">
                  {run.links.map((link) => (
                    <div
                      key={link.id}
                      className="px-4 py-2.5 flex items-center gap-3 flex-wrap"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{link.label}</div>
                        {link.noteText && (
                          <div className="text-xs text-muted-foreground italic">
                            {link.noteText}
                          </div>
                        )}
                      </div>
                      <div className="text-sm tabular-nums whitespace-nowrap">
                        {lamportsToSol(link.amount).toFixed(4)} SOL
                      </div>
                      <div className="text-xs">
                        <StatusPill status={link.status} />
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => copy(link.id, link.claimUrl)}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          aria-label="Copy link"
                          title="Copy link"
                        >
                          {copiedId === link.id ? (
                            <Check className="w-3.5 h-3.5 text-hop-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <a
                          href={link.claimUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Open"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        {link.status === "pending" && (
                          <button
                            onClick={async () => {
                              setRecallingId(link.id);
                              try {
                                await onRecallLink(run, link);
                              } finally {
                                setRecallingId(null);
                              }
                            }}
                            disabled={recallingId === link.id}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            title="Recall (return funds)"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: PayrollLink["status"] }) {
  const styles: Record<PayrollLink["status"], string> = {
    pending:
      "bg-honey-500/15 text-honey-700 dark:text-honey-300",
    claimed:
      "bg-hop-500/15 text-hop-700 dark:text-hop-300",
    recalled:
      "bg-muted text-muted-foreground",
    failed:
      "bg-destructive/15 text-destructive",
  };
  return (
    <span className={`px-2 py-0.5 rounded ${styles[status]}`}>{status}</span>
  );
}
