"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lamportsToSol } from "@/lib/utils";
import type { PayrollRun } from "@/lib/payroll/types";

export interface GeneratedLinksProps {
  run: PayrollRun;
  onDone: () => void;
}

export function GeneratedLinks({ run, onDone }: GeneratedLinksProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base ">
            Generated {run.links.length} payment link
            {run.links.length === 1 ? "" : "s"}
          </h3>
          <p className="text-xs text-muted-foreground">
            Total {lamportsToSol(run.totalAmount).toFixed(4)} SOL · saved
            locally to history.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>

      <div className="rounded-xl border-2 border-border bg-card divide-y divide-border">
        {run.links.map((link) => (
          <div
            key={link.id}
            className="px-4 py-3 flex items-center gap-3 flex-wrap"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{link.label}</div>
              <div className="text-xs text-muted-foreground truncate font-mono">
                {link.claimUrl}
              </div>
            </div>
            <div className="text-sm font-medium tabular-nums whitespace-nowrap">
              {lamportsToSol(link.amount).toFixed(4)} SOL
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => copy(link.id, link.claimUrl)}
                className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Copy link"
                title="Copy link"
              >
                {copiedId === link.id ? (
                  <Check className="w-4 h-4 text-hop-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              <a
                href={link.claimUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Open link"
                title="Open link"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
