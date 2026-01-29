/**
 * Privacy Cash Adapter - Multi-Level Privacy System
 * 
 * This file contains utility functions for different privacy levels.
 * The actual Privacy Cash SDK operations are handled in API routes (server-side).
 * 
 * ============================================================================
 * PRIVACY LEVELS
 * ============================================================================
 * 
 * BASIC (1 hop) - Cheapest, least private:
 *   Sender → Eph → Pool → Recipient
 *   - Sender visible to recipient (can look up Eph funding)
 *   - Recipient visible to sender/link holder
 *   - Cost: 0.006 SOL + 0.35%
 * 
 * PRIVATE (2 hops) - Balanced:
 *   Sender → Pool → Eph → Pool → Recipient
 *   - Sender hidden from recipient (ZK breaks link)
 *   - Recipient visible to sender/link holder
 *   - Cost: 0.012 SOL + 0.70%
 * 
 * MAXIMUM (3 hops) - Most private, most expensive:
 *   Sender → Pool → Eph1 → Pool → Eph2 → Pool → Recipient
 *   - Sender hidden from everyone
 *   - Recipient hidden from everyone (even link holder!)
 *   - Cost: 0.018 SOL + 1.05%
 * 
 * ============================================================================
 * COMPOSITE SECRET STRUCTURE (384 bits / 48 bytes)
 * ============================================================================
 * - First 128 bits (16 bytes): Claim identifier
 * - Last 256 bits (32 bytes): Ephemeral wallet private key seed
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
  /** Amount in lamports (what recipient should receive) */
  amount: number;
  /** Network */
  network: "devnet" | "mainnet-beta";
  /** Timestamp */
  createdAt: number;
  /** Ephemeral wallet address (for verification) */
  ephemeralAddress: string;
  /** Status tracking */
  status: "pending" | "funded" | "deposited" | "claimed";
  /** Privacy level used */
  privacyLevel: PrivacyLevel;
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

/** Privacy level for claim links */
export type PrivacyLevel = "basic" | "private" | "maximum";

export interface PrivacyLevelInfo {
  id: PrivacyLevel;
  name: string;
  description: string;
  hops: number;
  senderHidden: boolean;
  recipientHiddenFromSender: boolean;
  recipientHiddenFromLinkHolder: boolean;
  baseFeeMultiplier: number;
  percentageFeeMultiplier: number;
}

/** Privacy level configurations */
export const PRIVACY_LEVELS: Record<PrivacyLevel, PrivacyLevelInfo> = {
  basic: {
    id: "basic",
    name: "Basic",
    description: "Cheapest option. Recipient cannot see sender's identity on-chain, but could look up who funded the ephemeral wallet.",
    hops: 1,
    senderHidden: false,
    recipientHiddenFromSender: false,
    recipientHiddenFromLinkHolder: false,
    baseFeeMultiplier: 1,
    percentageFeeMultiplier: 1,
  },
  private: {
    id: "private",
    name: "Private",
    description: "Sender is hidden from recipient via ZK proofs. Link holder can still see who claims.",
    hops: 2,
    senderHidden: true,
    recipientHiddenFromSender: false,
    recipientHiddenFromLinkHolder: false,
    baseFeeMultiplier: 2,
    percentageFeeMultiplier: 2,
  },
  maximum: {
    id: "maximum",
    name: "Maximum",
    description: "Full anonymity. Neither sender nor recipient can identify each other. Even link interceptors cannot discover the recipient.",
    hops: 3,
    senderHidden: true,
    recipientHiddenFromSender: true,
    recipientHiddenFromLinkHolder: true,
    baseFeeMultiplier: 3,
    percentageFeeMultiplier: 3,
  },
};

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
 * @param privacyLevel The privacy level (affects number of hops and fees)
 * @returns Breakdown of costs
 */
export function calculateTotalDeposit(
  recipientAmountLamports: number,
  privacyLevel: PrivacyLevel = "basic"
): {
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
  /** Privacy level info */
  privacyLevelInfo: PrivacyLevelInfo;
} {
  const levelInfo = PRIVACY_LEVELS[privacyLevel];
  
  // For multi-hop, we need to calculate fees for each hop
  // The recipient amount passes through multiple withdrawals, each taking fees
  let depositAmount = recipientAmountLamports;
  
  // Work backwards from recipient amount through each hop
  for (let i = 0; i < levelInfo.hops; i++) {
    depositAmount = calculateDepositForRecipientAmount(depositAmount);
  }
  
  // Calculate total fees (difference between what sender pays and recipient gets)
  const totalFees = depositAmount - recipientAmountLamports;
  const baseFee = Math.floor(PRIVACY_CASH_BASE_FEE_SOL * LAMPORTS_PER_SOL) * levelInfo.hops;
  const percentageFee = totalFees - baseFee;
  
  const fees: FeeEstimate = {
    baseFee,
    percentageFee,
    totalFee: totalFees,
    recipientReceives: recipientAmountLamports,
  };
  
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
    privacyLevelInfo: levelInfo,
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
  p: string;  // privacy level
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
    p: note.privacyLevel,
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
      privacyLevel: (data.p as PrivacyLevel) || "basic", // Default to basic for old links
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
