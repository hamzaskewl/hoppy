"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { solToLamports, lamportsToSol } from "@/lib/utils";
import type { EmployeeRow } from "@/lib/payroll/types";

export interface CsvImportProps {
  onImport: (rows: EmployeeRow[]) => void;
  onClose: () => void;
}

interface ParsedRow {
  label: string;
  wallet?: string;
  email?: string;
  amount: number;
  amountStr: string;
  raw: string;
  error?: string;
}

const HEADERS = ["label", "wallet", "email", "amount"] as const;
type Header = (typeof HEADERS)[number];

function parseCsv(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  // Detect header by checking if first line starts with "label"
  let headerOrder: Header[] = ["label", "wallet", "email", "amount"];
  let dataLines = lines;
  const first = lines[0].toLowerCase();
  if (HEADERS.some((h) => first.startsWith(h))) {
    const cols = first.split(",").map((c) => c.trim() as Header);
    headerOrder = cols.filter((c): c is Header =>
      HEADERS.includes(c as Header),
    );
    dataLines = lines.slice(1);
  }

  return dataLines.map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row: Partial<Record<Header, string>> = {};
    headerOrder.forEach((h, i) => {
      row[h] = cols[i];
    });

    const sol = parseFloat(row.amount ?? "");
    const valid = !isNaN(sol) && sol > 0;

    return {
      label: row.label ?? "",
      wallet: row.wallet || undefined,
      email: row.email || undefined,
      amount: valid ? solToLamports(sol) : 0,
      amountStr: row.amount ?? "",
      raw: line,
      error: !row.label
        ? "missing label"
        : !valid
        ? "invalid amount"
        : undefined,
    };
  });
}

export function CsvImport({ onImport, onClose }: CsvImportProps) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseCsv(text) : [];
  const valid = parsed.filter((r) => !r.error);
  const total = valid.reduce((s, r) => s + r.amount, 0);

  const handleImport = () => {
    onImport(
      valid.map((r) => ({
        id: crypto.randomUUID(),
        label: r.label,
        wallet: r.wallet,
        email: r.email,
        amount: r.amountStr,
      })),
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border-2 border-border rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Import CSV</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto flex-1">
          <p className="text-xs text-muted-foreground">
            Format:{" "}
            <code className="font-mono">label,wallet,email,amount</code>{" "}
            (header optional). One row per employee. Amount is SOL.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`label,wallet,email,amount\nAlice,,alice@x.com,1.0\nBob,7xK...,bob@x.com,0.5`}
            className="w-full h-40 px-3 py-2 rounded-lg border-2 border-border bg-background font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />

          {parsed.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">
                Preview: {valid.length} valid · {parsed.length - valid.length}{" "}
                error
                {parsed.length - valid.length === 1 ? "" : "s"} · total{" "}
                {lamportsToSol(total).toFixed(4)} SOL
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border text-xs">
                {parsed.map((r, i) => (
                  <div
                    key={i}
                    className={`px-3 py-1.5 border-b border-border/40 last:border-b-0 flex items-center justify-between gap-2 ${
                      r.error ? "bg-destructive/5 text-destructive" : ""
                    }`}
                  >
                    <span className="font-mono truncate">{r.raw}</span>
                    {r.error && <span className="text-xs">{r.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={valid.length === 0}
          >
            Import {valid.length} row{valid.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </div>
  );
}
