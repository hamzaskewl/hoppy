/**
 * Payroll dashboard types. All amounts are lamports unless noted.
 */

export type PayrollLinkStatus =
  | "pending"
  | "claimed"
  | "recalled"
  | "failed";

/** A single editable row in the dashboard before submission. */
export interface EmployeeRow {
  /** Local UUID for React key + table tracking. */
  id: string;
  label: string;
  amount: string; // string while editing; parsed on submit
  noteText?: string;
}

/** A single generated payment link belonging to a payroll run. */
export interface PayrollLink {
  id: string;
  label: string;
  /** Local-only note. Never travels in the URL or on-chain. */
  noteText?: string;
  /** Amount in lamports. */
  amount: number;
  /** Full /payroll/claim#... URL ready to share. */
  claimUrl: string;
  status: PayrollLinkStatus;
  /** Tx hash of the issuance (Umbra UTXO creation). */
  issueTxHash?: string;
  /** Tx hash of the eventual claim (recipient withdrawal). */
  claimTxHash?: string;
  /** Tx hash of a recall (employer pulled funds back). */
  recallTxHash?: string;
}

/** A payroll run = one bulk deposit + N issued links. */
export interface PayrollRun {
  id: string;
  /** unix ms */
  createdAt: number;
  /** Server-tracked pool position id returned by deposit. */
  poolPositionId: string;
  /** Bulk-deposit tx hash (business signed once). */
  depositTxHash: string;
  /** Sum of all link amounts in lamports. */
  totalAmount: number;
  links: PayrollLink[];
}

/** Shape of the URL-hash payload for a /payroll/claim link. */
export interface UmbraNote {
  version: 1;
  /** base58 seed for the stealth keypair (server reconstructs this on claim). */
  secret: string;
  /** lamports */
  amount: number;
  network: "devnet" | "mainnet-beta";
  /** Stealth address that owns the Umbra UTXO. */
  stealthAddress: string;
  /** Optional employer label, surfaced on the claim page. */
  from?: string;
  status: "pending" | "claimed" | "recalled";
  token: "SOL"; // Umbra uses wSOL under the hood; UI shows SOL.
}
