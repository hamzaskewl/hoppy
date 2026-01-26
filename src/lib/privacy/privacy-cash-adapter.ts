/**
 * Privacy Cash Adapter - Double Hop Utilities
 * 
 * This file contains utility functions for the double hop privacy method.
 * The actual Privacy Cash SDK operations are handled in API routes (server-side).
 * 
 * Composite Secret Structure (384 bits / 48 bytes):
 * - First 128 bits (16 bytes): Claim identifier used for note tracking
 * - Last 256 bits (32 bytes): Ephemeral wallet private key seed
 * 
 * Double Hop Flow:
 * 1. Sender generates composite secret
 * 2. Derives ephemeral wallet from last 256 bits
 * 3. Sender transfers SOL to ephemeral wallet
 * 4. Ephemeral wallet deposits to Privacy Cash (via API route)
 * 5. Claim URL contains composite secret
 * 6. Recipient derives ephemeral wallet from secret
 * 7. Recipient withdraws from Privacy Cash to their actual wallet (via API route)
 * 
 * Privacy Guarantee:
 * - Sender → Ephemeral: Visible on-chain
 * - Ephemeral → Privacy Cash → Recipient: Link BROKEN
 * - Result: No traceable link between sender and recipient
 * 
 * Fees (Privacy Cash):
 * - Deposit: 0
 * - Withdrawal: 0.006 SOL + 0.35% of amount
 */

import type { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// LAMPORTS_PER_SOL constant to avoid importing @solana/web3.js at top level
// This prevents the CURVE.a bundling error
const LAMPORTS_PER_SOL = 1_000_000_000;

// Lazy loader for Keypair to avoid bundling issues with @solana/web3.js
let _Keypair: typeof import("@solana/web3.js").Keypair | null = null;

function getKeypair(): typeof import("@solana/web3.js").Keypair {
  if (_Keypair) return _Keypair;
  
  // Dynamic require - this runs at runtime, not bundle time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const solana = require("@solana/web3.js") as typeof import("@solana/web3.js");
  _Keypair = solana.Keypair;
  return _Keypair!;
}

// ============================================================================
// Types
// ============================================================================

export interface CompositeSecret {
  /** Full 48-byte secret (base58 encoded) */
  full: string;
  /** First 16 bytes - claim identifier (base58 encoded) */
  claimId: string;
  /** Last 32 bytes - ephemeral key seed (base58 encoded) */
  ephemeralSeed: string;
  /** Derived ephemeral keypair */
  ephemeralKeypair: Keypair;
}

export interface DoubleHopNote {
  /** Composite secret (base58 encoded) */
  secret: string;
  /** Amount in lamports */
  amount: number;
  /** Network */
  network: "devnet" | "mainnet-beta";
  /** Timestamp */
  createdAt: number;
  /** Ephemeral wallet address (for verification) */
  ephemeralAddress: string;
  /** Status tracking */
  status: "pending" | "funded" | "deposited" | "claimed";
}

export interface FeeEstimate {
  /** Base withdrawal fee in lamports */
  baseFee: number;
  /** Percentage fee (0.35% of amount) */
  percentageFee: number;
  /** Total fee */
  totalFee: number;
  /** Amount recipient receives */
  recipientReceives: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Privacy Cash withdrawal base fee in SOL */
const PRIVACY_CASH_BASE_FEE_SOL = 0.006;
/** Privacy Cash withdrawal percentage fee */
const PRIVACY_CASH_PERCENTAGE_FEE = 0.0035; // 0.35%
/** 
 * Gas buffer for ephemeral wallet
 * NOTE: Privacy Cash uses a relayer that pays ALL transaction fees.
 * The ephemeral wallet doesn't need any SOL for gas - it just deposits
 * everything to Privacy Cash and the relayer handles the rest.
 */
const EPHEMERAL_GAS_BUFFER_SOL = 0; // No gas buffer needed - relayer pays fees

// ============================================================================
// Composite Secret Functions
// ============================================================================

/**
 * Generate a new 384-bit composite secret
 */
export function generateCompositeSecret(): CompositeSecret {
  const fullBytes = new Uint8Array(48);
  
  // Use browser crypto API if available
  if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(fullBytes);
  } else if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.getRandomValues) {
    // Node.js 18+ with globalThis.crypto
    globalThis.crypto.getRandomValues(fullBytes);
  } else {
    // Fallback: generate pseudo-random bytes (not cryptographically secure, but works)
    // In production, this should never be reached as modern browsers/Node have crypto
    for (let i = 0; i < 48; i++) {
      fullBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  
  const claimIdBytes = fullBytes.slice(0, 16);
  const ephemeralSeedBytes = fullBytes.slice(16, 48);
  
  // Derive ephemeral keypair from the 32-byte seed
  const Keypair = getKeypair();
  const ephemeralKeypair = Keypair.fromSeed(ephemeralSeedBytes);
  
  return {
    full: bs58.encode(fullBytes),
    claimId: bs58.encode(claimIdBytes),
    ephemeralSeed: bs58.encode(ephemeralSeedBytes),
    ephemeralKeypair,
  };
}

/**
 * Reconstruct composite secret from encoded string
 */
export function decodeCompositeSecret(encoded: string): CompositeSecret | null {
  try {
    const fullBytes = bs58.decode(encoded);
    
    if (fullBytes.length !== 48) {
      console.error("[PrivacyCash] Invalid secret length:", fullBytes.length);
      return null;
    }
    
    const claimIdBytes = fullBytes.slice(0, 16);
    const ephemeralSeedBytes = fullBytes.slice(16, 48);
    
    // Use lazy loader to avoid bundling issues
    const Keypair = getKeypair();
    const ephemeralKeypair = Keypair.fromSeed(ephemeralSeedBytes);
    
    return {
      full: encoded,
      claimId: bs58.encode(claimIdBytes),
      ephemeralSeed: bs58.encode(ephemeralSeedBytes),
      ephemeralKeypair,
    };
  } catch (error) {
    console.error("[PrivacyCash] Failed to decode secret:", error);
    return null;
  }
}

// ============================================================================
// Fee Calculation
// ============================================================================

/**
 * Calculate Privacy Cash fees for withdrawing a given deposit amount.
 * Fee formula: depositAmount * 0.35% + 0.006 SOL base fee
 * 
 * @param depositAmountLamports The amount being deposited/withdrawn from Privacy Cash
 * @returns Fee breakdown including what recipient receives
 */
export function calculateFees(depositAmountLamports: number): FeeEstimate {
  const baseFee = Math.floor(PRIVACY_CASH_BASE_FEE_SOL * LAMPORTS_PER_SOL);
  const percentageFee = Math.floor(depositAmountLamports * PRIVACY_CASH_PERCENTAGE_FEE);
  const totalFee = baseFee + percentageFee;
  const recipientReceives = depositAmountLamports - totalFee;
  
  return {
    baseFee,
    percentageFee,
    totalFee,
    recipientReceives: Math.max(0, recipientReceives),
  };
}

/**
 * Calculate how much to deposit to Privacy Cash so recipient receives the intended amount.
 * 
 * Math:
 * - Recipient receives = Deposit - (Deposit * 0.0035 + baseFee)
 * - Recipient receives = Deposit * 0.9965 - baseFee
 * - Deposit = (recipientAmount + baseFee) / 0.9965
 * 
 * @param recipientAmountLamports The amount the recipient should receive
 * @returns Deposit amount needed
 */
export function calculateDepositForRecipientAmount(recipientAmountLamports: number): number {
  const baseFee = Math.floor(PRIVACY_CASH_BASE_FEE_SOL * LAMPORTS_PER_SOL);
  const depositAmount = Math.ceil((recipientAmountLamports + baseFee) / (1 - PRIVACY_CASH_PERCENTAGE_FEE));
  return depositAmount;
}

/**
 * Calculate total amount sender needs to fund ephemeral wallet.
 * This is what the sender actually pays.
 * 
 * @param recipientAmountLamports The amount the recipient should receive
 * @returns Breakdown of costs
 */
export function calculateTotalDeposit(recipientAmountLamports: number): {
  /** Amount recipient will receive */
  recipientAmount: number;
  /** Amount to deposit to Privacy Cash (recipientAmount + fees) */
  depositAmount: number;
  /** Fee breakdown */
  fees: FeeEstimate;
  /** Small buffer for ephemeral wallet (mostly unused since relayer pays fees) */
  gasBuffer: number;
  /** Total sender pays */
  total: number;
} {
  // Calculate how much to deposit so recipient gets their intended amount
  const depositAmount = calculateDepositForRecipientAmount(recipientAmountLamports);
  
  // Calculate actual fees based on deposit amount
  const fees = calculateFees(depositAmount);
  
  // Small gas buffer (mostly precautionary, relayer pays most fees)
  const gasBuffer = Math.floor(EPHEMERAL_GAS_BUFFER_SOL * LAMPORTS_PER_SOL);
  
  // Total = deposit amount + gas buffer
  const total = depositAmount + gasBuffer;
  
  return {
    recipientAmount: recipientAmountLamports,
    depositAmount,
    fees,
    gasBuffer,
    total,
  };
}

// ============================================================================
// Double Hop Note Serialization
// ============================================================================

interface SerializedDoubleHopNote {
  s: string;  // secret
  a: number;  // amount
  n: string;  // network
  e: string;  // ephemeral address
}

/**
 * Serialize a double hop note for URL
 */
export function serializeDoubleHopNote(note: DoubleHopNote): string {
  const data: SerializedDoubleHopNote = {
    s: note.secret,
    a: note.amount,
    n: note.network,
    e: note.ephemeralAddress,
  };
  
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  return bs58.encode(bytes);
}

/**
 * Deserialize a double hop note from URL
 */
export function deserializeDoubleHopNote(encoded: string): DoubleHopNote | null {
  try {
    const bytes = bs58.decode(encoded);
    const json = new TextDecoder().decode(bytes);
    const data: SerializedDoubleHopNote = JSON.parse(json);
    
    if (!data.s || typeof data.a !== "number" || !data.n || !data.e) {
      console.error("[PrivacyCash] Invalid note data");
      return null;
    }
    
    return {
      secret: data.s,
      amount: data.a,
      network: data.n as "devnet" | "mainnet-beta",
      createdAt: Date.now(),
      ephemeralAddress: data.e,
      status: "pending",
    };
  } catch (error) {
    console.error("[PrivacyCash] Failed to deserialize note:", error);
    return null;
  }
}

/**
 * Create a claim URL from a double hop note
 */
export function createDoubleHopClaimUrl(note: DoubleHopNote, baseUrl?: string): string {
  const serialized = serializeDoubleHopNote(note);
  const base = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/claim#${serialized}`;
}

/**
 * Extract double hop note from URL
 */
export function extractDoubleHopNoteFromUrl(url?: string): DoubleHopNote | null {
  const hash = url 
    ? new URL(url).hash.slice(1) 
    : (typeof window !== "undefined" ? window.location.hash.slice(1) : "");
  
  if (!hash || hash.length < 10) {
    return null;
  }
  
  return deserializeDoubleHopNote(hash);
}
