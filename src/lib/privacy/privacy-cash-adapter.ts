/**
 * Privacy Cash Adapter - Dual Privacy Model
 * 
 * SENDER and RECIPIENT each choose their own privacy level independently.
 * 
 * ============================================================================
 * SENDER PRIVACY (chosen when creating link)
 * ============================================================================
 * 
 * BASIC - Cheapest, sender is traceable:
 *   Sender wallet → Ephemeral (direct transfer)
 *   - Recipient can look up who funded the ephemeral
 *   - Cost: ~0.000005 SOL (just tx fee)
 * 
 * PRIVATE - Sender is hidden:
 *   Sender → Pool → Ephemeral (ZK withdrawal)
 *   - ZK proof breaks link between sender and ephemeral
 *   - Cost: 0.006 SOL + 0.35%
 * 
 * ============================================================================
 * RECIPIENT PRIVACY (chosen when claiming)
 * ============================================================================
 * 
 * QUICK - Cheapest, recipient visible to link holder:
 *   Ephemeral (Pool) → Recipient wallet
 *   - Anyone with link can see who claimed
 *   - Cost: 0.006 SOL + 0.35%
 * 
 * PRIVATE - Recipient hidden from everyone:
 *   Ephemeral (Pool) → Eph2 → Pool → Recipient
 *   - Extra hop hides recipient identity
 *   - Cost: 0.012 SOL + 0.70%
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
  /** Amount in lamports available for recipient */
  amount: number;
  /** Network */
  network: "devnet" | "mainnet-beta";
  /** Timestamp */
  createdAt: number;
  /** Ephemeral wallet address (for verification) */
  ephemeralAddress: string;
  /** Status tracking */
  status: "pending" | "funded" | "deposited" | "claimed" | "reclaimed";
  /** Sender's privacy choice */
  senderPrivacy: SenderPrivacy;
  /** Sender's address (for reclaim feature, only stored if basic privacy) */
  senderAddress?: string;
  /** Where funds are currently located */
  fundsLocation: "ephemeral" | "pool";
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

/** Sender privacy level (chosen when creating link) */
export type SenderPrivacy = "basic" | "private";

/** Recipient privacy level (chosen when claiming) */
export type RecipientPrivacy = "quick" | "private";

export interface SenderPrivacyInfo {
  id: SenderPrivacy;
  name: string;
  description: string;
  senderHidden: boolean;
  /** Extra cost on top of base amount (lamports estimate for 0.1 SOL) */
  estimatedCost: string;
}

export interface RecipientPrivacyInfo {
  id: RecipientPrivacy;
  name: string;
  description: string;
  recipientHidden: boolean;
  /** Fee deducted from amount */
  feeDescription: string;
  /** Number of withdrawal hops */
  hops: number;
}

/** Sender privacy options */
export const SENDER_PRIVACY: Record<SenderPrivacy, SenderPrivacyInfo> = {
  basic: {
    id: "basic",
    name: "Basic",
    description: "Cheapest. Recipient could look up who funded the link if they check the blockchain.",
    senderHidden: false,
    estimatedCost: "~0.000005 SOL (tx fee only)",
  },
  private: {
    id: "private",
    name: "Private",
    description: "Your identity is protected by ZK proofs. Recipient cannot trace funds back to you.",
    senderHidden: true,
    estimatedCost: "~0.006 SOL + 0.35%",
  },
};

/** Recipient privacy options */
export const RECIPIENT_PRIVACY: Record<RecipientPrivacy, RecipientPrivacyInfo> = {
  quick: {
    id: "quick",
    name: "Quick Claim",
    description: "Fastest option. Anyone with the link can see your address after you claim.",
    recipientHidden: false,
    feeDescription: "0.006 SOL + 0.35%",
    hops: 1,
  },
  private: {
    id: "private",
    name: "Private Claim",
    description: "Your identity is hidden from everyone, including the sender and link holder.",
    recipientHidden: true,
    feeDescription: "0.012 SOL + 0.70%",
    hops: 2,
  },
};

// Legacy type for backwards compatibility
export type PrivacyLevel = "basic" | "private" | "maximum";
export const PRIVACY_LEVELS = {
  basic: { ...SENDER_PRIVACY.basic, hops: 1, baseFeeMultiplier: 1, percentageFeeMultiplier: 1 },
  private: { ...SENDER_PRIVACY.private, hops: 2, baseFeeMultiplier: 2, percentageFeeMultiplier: 2 },
  maximum: { id: "maximum", name: "Maximum", hops: 3, baseFeeMultiplier: 3, percentageFeeMultiplier: 3 },
} as any;

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
 * Calculate what sender needs to pay based on desired amount for recipient.
 * 
 * @param recipientAmountLamports Amount recipient should receive
 * @param senderPrivacy Sender's privacy choice
 */
export function calculateSenderCost(
  recipientAmountLamports: number,
  senderPrivacy: SenderPrivacy = "basic"
): {
  /** Amount recipient will have available */
  recipientAmount: number;
  /** What sender needs to pay */
  senderPays: number;
  /** Fee paid by sender */
  senderFee: number;
  /** Privacy info */
  privacyInfo: SenderPrivacyInfo;
} {
  const privacyInfo = SENDER_PRIVACY[senderPrivacy];
  
  if (senderPrivacy === "basic") {
    // Basic: Sender → Eph (direct transfer, ~0.000005 SOL tx fee)
    // Funds stay in ephemeral, no Privacy Cash fee yet
    return {
      recipientAmount: recipientAmountLamports,
      senderPays: recipientAmountLamports,
      senderFee: 0, // Just blockchain tx fee (negligible)
      privacyInfo,
    };
  } else {
    // Private: Sender → Pool → Eph (costs withdrawal fee)
    // Need to deposit more so withdrawal equals recipientAmount
    const depositNeeded = calculateDepositForRecipientAmount(recipientAmountLamports);
    const senderFee = depositNeeded - recipientAmountLamports;
    
    return {
      recipientAmount: recipientAmountLamports,
      senderPays: depositNeeded,
      senderFee,
      privacyInfo,
    };
  }
}

/**
 * Calculate what recipient receives based on pool amount and their privacy choice.
 * 
 * @param poolAmountLamports Amount in pool (what sender deposited)
 * @param recipientPrivacy Recipient's privacy choice
 */
export function calculateRecipientReceives(
  poolAmountLamports: number,
  recipientPrivacy: RecipientPrivacy = "quick"
): {
  /** Amount in pool */
  poolAmount: number;
  /** Amount recipient receives after fees */
  recipientReceives: number;
  /** Fee deducted */
  fee: number;
  /** Privacy info */
  privacyInfo: RecipientPrivacyInfo;
} {
  const privacyInfo = RECIPIENT_PRIVACY[recipientPrivacy];
  const hops = privacyInfo.hops;
  
  // Each hop costs withdrawal fee
  let remaining = poolAmountLamports;
  for (let i = 0; i < hops; i++) {
    const fees = calculateFees(remaining);
    remaining = fees.recipientReceives;
  }
  
  return {
    poolAmount: poolAmountLamports,
    recipientReceives: remaining,
    fee: poolAmountLamports - remaining,
    privacyInfo,
  };
}

// Legacy function for backwards compatibility
export function calculateTotalDeposit(
  recipientAmountLamports: number,
  privacyLevel: PrivacyLevel = "basic"
) {
  const levelInfo = PRIVACY_LEVELS[privacyLevel];
  let depositAmount = recipientAmountLamports;
  
  for (let i = 0; i < levelInfo.hops; i++) {
    depositAmount = calculateDepositForRecipientAmount(depositAmount);
  }
  
  const totalFees = depositAmount - recipientAmountLamports;
  const baseFee = Math.floor(PRIVACY_CASH_BASE_FEE_SOL * LAMPORTS_PER_SOL) * levelInfo.hops;
  const percentageFee = totalFees - baseFee;
  
  return {
    recipientAmount: recipientAmountLamports,
    depositAmount,
    fees: { baseFee, percentageFee, totalFee: totalFees, recipientReceives: recipientAmountLamports },
    gasBuffer: 0,
    total: depositAmount,
    privacyLevelInfo: levelInfo,
  };
}

// ============================================================================
// Double Hop Note Serialization
// ============================================================================

interface SerializedDoubleHopNote {
  s: string;  // secret
  a: number;  // amount available
  n: string;  // network
  e: string;  // ephemeral address
  sp: string; // sender privacy
  sa?: string; // sender address (for reclaim)
  fl: string; // funds location (ephemeral or pool)
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
    sp: note.senderPrivacy,
    sa: note.senderAddress,
    fl: note.fundsLocation,
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
    const data = JSON.parse(json);
    
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
      // Handle both old and new format
      senderPrivacy: (data.sp as SenderPrivacy) || (data.p === "private" ? "private" : "basic"),
      senderAddress: data.sa,
      // Default to pool for old links
      fundsLocation: (data.fl as "ephemeral" | "pool") || "pool",
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
