"use client";

import { Plus, Trash2, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { lamportsToSol, solToLamports } from "@/lib/utils";
import type { EmployeeRow } from "@/lib/payroll/types";

export interface EmployeeTableProps {
  rows: EmployeeRow[];
  onChange: (rows: EmployeeRow[]) => void;
  onImportCsv: () => void;
  disabled?: boolean;
}

export function EmployeeTable({
  rows,
  onChange,
  onImportCsv,
  disabled,
}: EmployeeTableProps) {
  const updateRow = (id: string, patch: Partial<EmployeeRow>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    onChange([
      ...rows,
      {
        id: crypto.randomUUID(),
        label: "",
        amount: "",
      },
    ]);
  };

  const removeRow = (id: string) => {
    onChange(rows.filter((r) => r.id !== id));
  };

  const totalLamports = rows.reduce((sum, r) => {
    const sol = parseFloat(r.amount);
    return sum + (isNaN(sol) ? 0 : solToLamports(sol));
  }, 0);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border-2 border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-muted-foreground">
              <th className="text-left font-medium px-3 py-2">Label</th>
              <th className="text-left font-medium px-3 py-2 w-32">Amount (SOL)</th>
              <th className="text-left font-medium px-3 py-2">Note (local)</th>
              <th className="px-2 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                <td className="px-2 py-1.5">
                  <Input
                    value={row.label}
                    placeholder="Alice"
                    onChange={(e) => updateRow(row.id, { label: e.target.value })}
                    disabled={disabled}
                    className="h-9"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.amount}
                    placeholder="0.0"
                    inputMode="decimal"
                    onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                    disabled={disabled}
                    className="h-9 text-right"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.noteText ?? ""}
                    placeholder="March pay"
                    onChange={(e) => updateRow(row.id, { noteText: e.target.value })}
                    disabled={disabled}
                    className="h-9"
                  />
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => removeRow(row.id)}
                    disabled={disabled || rows.length === 1}
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-colors"
                    aria-label="Remove row"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={addRow}
            disabled={disabled}
          >
            <Plus className="w-4 h-4" />
            Add row
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onImportCsv}
            disabled={disabled}
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </Button>
        </div>
        <div className="text-sm font-medium">
          Total:{" "}
          <span className="text-hop-600 dark:text-hop-400">
            {lamportsToSol(totalLamports).toFixed(4)} SOL
          </span>
        </div>
      </div>
    </div>
  );
}
