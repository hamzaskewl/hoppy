/**
 * Server-side key derivation for the per-business escrow signer.
 *
 * Each business wallet maps to a deterministic Solana keypair via
 *   keypair_seed = SHA-256( UMBRA_ESCROW_MASTER_KEY || businessWallet )
 *
 * The escrow keypair is what actually signs Umbra ops (deposit, create UTXO).
 * The business never holds it; the dashboard just sends SOL to its address.
 *
 * Trust model: the Hoppy server can spend escrow funds. This is the price for
 * "no per-row Privy signatures" issuance UX. If the server is compromised the
 * escrow can be drained — same trust class as any custodial relayer.
 */

import crypto from "crypto";
import { Keypair } from "@solana/web3.js";

function getMasterKey(): Uint8Array {
  const hex = process.env.UMBRA_ESCROW_MASTER_KEY;
  if (!hex) {
    throw new Error(
      "UMBRA_ESCROW_MASTER_KEY env var is required (64 hex chars; openssl rand -hex 32)",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("UMBRA_ESCROW_MASTER_KEY must be 64 hex chars");
  }
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/** Deterministic 32-byte seed for the escrow keypair belonging to this business. */
export function deriveEscrowSeed(businessWallet: string): Uint8Array {
  const master = getMasterKey();
  const h = crypto.createHash("sha256");
  h.update(master);
  h.update(Buffer.from(businessWallet, "utf8"));
  return new Uint8Array(h.digest());
}

/** Returns the @solana/web3.js Keypair (32-byte seed → 64-byte secret). */
export function getEscrowKeypair(businessWallet: string): Keypair {
  return Keypair.fromSeed(deriveEscrowSeed(businessWallet));
}

export function getEscrowAddress(businessWallet: string): string {
  return getEscrowKeypair(businessWallet).publicKey.toBase58();
}

/** Stealth keypair for a single payroll link, derived from the URL-hash secret. */
export function stealthKeypairFromSeed(seed32: Uint8Array): Keypair {
  if (seed32.length !== 32) {
    throw new Error("stealth seed must be 32 bytes");
  }
  return Keypair.fromSeed(seed32);
}

// ============================================================================
// Card-flow escrow keys
// ============================================================================
//
// The card flow uses a per-order escrow so each order's funds are isolated:
// if one user's flow gets stuck, only their funds (not anyone else's) sit in
// the orphan escrow until refunded. The escrow is derived deterministically
// from the orderId so it can always be re-derived during refund — we never
// need to persist the secret key anywhere.

/** Deterministic 32-byte seed for a per-order card escrow keypair. */
export function deriveCardEscrowSeed(orderId: string): Uint8Array {
  const master = getMasterKey();
  const h = crypto.createHash("sha256");
  h.update(master);
  h.update(Buffer.from("hoppy-card-escrow:v1:", "utf8"));
  h.update(Buffer.from(orderId, "utf8"));
  return new Uint8Array(h.digest());
}

/** Per-order Solana keypair used as the Umbra signer for the card flow. */
export function getCardEscrowKeypair(orderId: string): Keypair {
  return Keypair.fromSeed(deriveCardEscrowSeed(orderId));
}

export function getCardEscrowAddress(orderId: string): string {
  return getCardEscrowKeypair(orderId).publicKey.toBase58();
}
