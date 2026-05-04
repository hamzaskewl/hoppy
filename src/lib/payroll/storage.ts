/**
 * localStorage helpers for payroll runs.
 * Mirrors the encrypted-by-wallet-address pattern in create-link-form.tsx
 * but uses its own STORAGE_KEY/salt so the two stores never collide.
 */

import {
  encryptData,
  decryptData,
  type CryptoConfig,
} from "@/lib/local-storage-crypto";
import type { PayrollRun, PayrollLink, PayrollLinkStatus } from "./types";

const STORAGE_KEY = "hoppy_payroll_v1";
const MAX_RUNS = 50;

const CRYPTO_CONFIG: CryptoConfig = {
  salt: "hoppy_payroll_salt_v1",
  keyMaterialSuffix: "_hoppy_payroll_key",
};

export async function loadRuns(walletAddress: string): Promise<PayrollRun[]> {
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY);
    if (!encrypted) return [];

    const decrypted = await decryptData(encrypted, walletAddress, CRYPTO_CONFIG);
    if (!decrypted) return [];

    return JSON.parse(decrypted) as PayrollRun[];
  } catch {
    return [];
  }
}

export async function saveRun(
  run: PayrollRun,
  walletAddress: string,
): Promise<void> {
  const existing = await loadRuns(walletAddress);
  const next = [run, ...existing.filter((r) => r.id !== run.id)].slice(0, MAX_RUNS);
  const encrypted = await encryptData(
    JSON.stringify(next),
    walletAddress,
    CRYPTO_CONFIG,
  );
  localStorage.setItem(STORAGE_KEY, encrypted);
}

export async function updateLinkStatus(
  runId: string,
  linkId: string,
  patch: Partial<Pick<PayrollLink, "status" | "claimTxHash" | "recallTxHash">>,
  walletAddress: string,
): Promise<void> {
  const existing = await loadRuns(walletAddress);
  const next = existing.map((run) => {
    if (run.id !== runId) return run;
    return {
      ...run,
      links: run.links.map((link) =>
        link.id === linkId ? { ...link, ...patch } : link,
      ),
    };
  });
  const encrypted = await encryptData(
    JSON.stringify(next),
    walletAddress,
    CRYPTO_CONFIG,
  );
  localStorage.setItem(STORAGE_KEY, encrypted);
}

export async function deleteRun(
  runId: string,
  walletAddress: string,
): Promise<void> {
  const existing = await loadRuns(walletAddress);
  const next = existing.filter((r) => r.id !== runId);
  const encrypted = await encryptData(
    JSON.stringify(next),
    walletAddress,
    CRYPTO_CONFIG,
  );
  localStorage.setItem(STORAGE_KEY, encrypted);
}

export async function clearAllRuns(walletAddress: string): Promise<void> {
  const empty = await encryptData("[]", walletAddress, CRYPTO_CONFIG);
  localStorage.setItem(STORAGE_KEY, empty);
}

/** Aggregate counts for the run-header summary line. */
export function summarize(run: PayrollRun): {
  total: number;
  pending: number;
  claimed: number;
  recalled: number;
  failed: number;
} {
  const counts: Record<PayrollLinkStatus, number> = {
    pending: 0,
    claimed: 0,
    recalled: 0,
    failed: 0,
  };
  for (const link of run.links) counts[link.status]++;
  return { total: run.links.length, ...counts };
}
