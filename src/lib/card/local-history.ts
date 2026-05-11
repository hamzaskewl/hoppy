/**
 * localStorage helpers for the per-buyer gift card order history.
 *
 * Mirrors the encrypted-by-wallet pattern used in personal sends + payroll
 * runs. The decryption key is derived from the connected wallet address, so
 * the history is scoped to whoever placed the order; switching wallets shows
 * a fresh empty history (the ciphertext is still there but undecryptable).
 *
 * The stored claim_link contains the AES key in its URL fragment — anyone
 * with read access to this browser's localStorage AND the same wallet
 * address can decrypt the card details. That's the same threat model as
 * personal sends, and the user explicitly asked for local persistence.
 */

import {
  encryptData,
  decryptData,
  type CryptoConfig,
} from "@/lib/local-storage-crypto";

const STORAGE_KEY = "hoppy_card_history_v1";
const MAX_ENTRIES = 50;

const CRYPTO_CONFIG: CryptoConfig = {
  salt: "hoppy_card_salt_v1",
  keyMaterialSuffix: "_hoppy_card_key",
};

export type CardHistoryStatus =
  | "pending"
  | "ready"
  | "claimed"
  | "refunded"
  | "failed"
  | "expired";

/** Statuses where the order is in a final/terminal state — no more polling needed. */
export const TERMINAL_STATUSES: ReadonlySet<CardHistoryStatus> = new Set([
  "claimed",
  "refunded",
  "failed",
  "expired",
]);

/**
 * Map raw server-side statuses (from /api/card/status) to the smaller set
 * the buyer's local history understands. The server has fine-grained
 * orchestration states (depositing/mixing/withdrawing/paying/paid) that
 * all just mean "still processing" from the buyer's POV.
 */
export function normalizeServerStatus(serverStatus: string): CardHistoryStatus {
  switch (serverStatus) {
    case "ready":
    case "claimed":
    case "refunded":
    case "failed":
    case "expired":
      return serverStatus;
    case "pending":
    case "depositing":
    case "mixing":
    case "withdrawing":
    case "paying":
    case "paid":
      return "pending";
    default:
      return "pending";
  }
}

export interface CardHistoryEntry {
  orderId: string;
  productSlug: string;
  productName: string;
  amount: number;
  currency: string;
  status: CardHistoryStatus;
  claimLink?: string;
  refundTxHash?: string;
  /** ISO timestamp captured at order-create time. */
  createdAt: string;
  /** ISO timestamp of the last localStorage mutation. */
  updatedAt: string;
}

export async function loadHistory(
  walletAddress: string,
): Promise<CardHistoryEntry[]> {
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY);
    if (!encrypted) return [];
    const decrypted = await decryptData(encrypted, walletAddress, CRYPTO_CONFIG);
    if (!decrypted) return [];
    const parsed = JSON.parse(decrypted) as CardHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeHistory(
  entries: CardHistoryEntry[],
  walletAddress: string,
): Promise<void> {
  const encrypted = await encryptData(
    JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    walletAddress,
    CRYPTO_CONFIG,
  );
  localStorage.setItem(STORAGE_KEY, encrypted);
}

/**
 * Upsert by orderId. Newest entries come first. Existing fields not in
 * `patch` are preserved (so a status-update call doesn't clobber the
 * product name / amount captured at create time).
 */
export async function upsertEntry(
  patch: Partial<CardHistoryEntry> & { orderId: string },
  walletAddress: string,
): Promise<CardHistoryEntry[]> {
  const existing = await loadHistory(walletAddress);
  const now = new Date().toISOString();
  const idx = existing.findIndex((e) => e.orderId === patch.orderId);

  let next: CardHistoryEntry[];
  if (idx >= 0) {
    const merged: CardHistoryEntry = {
      ...existing[idx],
      ...patch,
      updatedAt: now,
    };
    next = [merged, ...existing.filter((_, i) => i !== idx)];
  } else {
    const created: CardHistoryEntry = {
      orderId: patch.orderId,
      productSlug: patch.productSlug ?? "",
      productName: patch.productName ?? "Gift Card",
      amount: patch.amount ?? 0,
      currency: patch.currency ?? "USD",
      status: patch.status ?? "pending",
      claimLink: patch.claimLink,
      refundTxHash: patch.refundTxHash,
      createdAt: patch.createdAt ?? now,
      updatedAt: now,
    };
    next = [created, ...existing];
  }

  await writeHistory(next, walletAddress);
  return next;
}

export async function deleteEntry(
  orderId: string,
  walletAddress: string,
): Promise<CardHistoryEntry[]> {
  const existing = await loadHistory(walletAddress);
  const next = existing.filter((e) => e.orderId !== orderId);
  await writeHistory(next, walletAddress);
  return next;
}

export async function clearHistory(walletAddress: string): Promise<void> {
  await writeHistory([], walletAddress);
}
