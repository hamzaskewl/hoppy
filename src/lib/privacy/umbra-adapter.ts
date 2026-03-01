/**
 * Umbra Privacy Adapter
 *
 * Replaces the PrivacyCash adapter with Umbra Privacy SDK integration.
 *
 * KEY DIFFERENCES FROM PRIVACYCASH:
 * - All sends use the mixer (always private, no "basic" sender mode)
 * - Uses wSOL instead of native SOL (auto-wrap/unwrap handled transparently)
 * - Users must register on Umbra before receiving (1-3 on-chain txs, idempotent)
 * - ZK proofs via WASM prover (1-5 seconds, no 19MB circuit download)
 * - UTXO lookup via indexer (instant, no brute-force scanning)
 *
 * PRIVACY MODEL:
 * - Create link: sender creates self-claimable UTXO via mixer (sender-recipient link broken)
 * - Claim quick: claim into public balance (recipient visible to link holder)
 * - Claim private: claim into encrypted balance (recipient hidden)
 *
 * URL FORMAT:
 * /claim#<base58-encoded JSON with ephemeral seed, amount, token info>
 */

import bs58 from "bs58";

// ============================================================================
// Constants
// ============================================================================

const LAMPORTS_PER_SOL = 1_000_000_000;

/** wSOL mint address (Umbra uses wSOL, not native SOL) */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Umbra fee: 0.3% commission on deposits */
export const UMBRA_FEE_PERCENT = 0.003;

/** Estimated gas buffer for ephemeral operations (registration + UTXO creation + claim) */
export const EPHEMERAL_GAS_BUFFER = 20_000_000; // 0.02 SOL

/** Minimum send amounts */
export const MIN_SEND_SOL = 0.01; // 0.01 SOL
export const MIN_SEND_SPL = 0.1;  // 0.1 USDC/USDT

/** SOL buffer for SPL token operations (gas fees) */
export const SPL_SOL_BUFFER = 5_000_000; // 0.005 SOL

// ============================================================================
// Token Types & Constants
// ============================================================================

export type SupportedToken = "SOL" | "USDC" | "USDT";

export interface TokenInfo {
  symbol: SupportedToken;
  name: string;
  mint: string; // Always has a mint (wSOL for SOL)
  decimals: number;
  icon: string;
}

/**
 * Token mints for Umbra.
 * NOTE: SOL uses wSOL mint (not null like PrivacyCash).
 */
export const TOKEN_MINTS: Record<SupportedToken, TokenInfo> = {
  SOL: {
    symbol: "SOL",
    name: "Solana",
    mint: WSOL_MINT,
    decimals: 9,
    icon: "/sol.svg",
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png",
  },
};

export function getTokenInfo(token: SupportedToken): TokenInfo {
  return TOKEN_MINTS[token];
}

/** Get token symbol from mint address */
export function getTokenFromMint(mint: string): SupportedToken | null {
  for (const [symbol, info] of Object.entries(TOKEN_MINTS)) {
    if (info.mint === mint) return symbol as SupportedToken;
  }
  return null;
}

// ============================================================================
// Claim Mode (replaces SenderPrivacy + RecipientPrivacy)
// ============================================================================

/**
 * All sends are private (mixer always breaks sender-receiver link).
 * Claim mode only affects recipient privacy.
 */
export type ClaimMode = "quick" | "private";

// Legacy type aliases for compatibility during migration
export type SenderPrivacy = "basic" | "private"; // "basic" is deprecated, kept for compat
export type RecipientPrivacy = ClaimMode;

export interface ClaimModeInfo {
  id: ClaimMode;
  label: string;
  name: string;
  description: string;
  icon: string;
  recipientHidden: boolean;
  feeDescription: string;
  hops: number;
}

export const CLAIM_MODES: Record<ClaimMode, ClaimModeInfo> = {
  quick: {
    id: "quick",
    label: "Quick",
    name: "Quick Claim",
    description: "Fast claim to your wallet. Link holder can see who claimed.",
    icon: "zap",
    recipientHidden: false,
    feeDescription: "0.3% commission",
    hops: 0,
  },
  private: {
    id: "private",
    label: "Private",
    name: "Private Claim",
    description: "Claim into encrypted balance. Link holder cannot see who claimed.",
    icon: "shield",
    recipientHidden: true,
    feeDescription: "0.3% commission",
    hops: 0,
  },
};

// ============================================================================
// Umbra Note (replaces DoubleHopNote)
// ============================================================================

/**
 * UmbraNote represents a payment link's metadata.
 * Stored as base58-encoded JSON in the URL hash fragment.
 */
export interface UmbraNote {
  /** 32-byte ephemeral private key seed (base58) */
  ephemeralSeed: string;
  /** Amount in smallest token units (lamports for SOL, base units for SPL) */
  amount: number;
  /** Network */
  network: "mainnet" | "devnet";
  /** Token type */
  token: SupportedToken;
  /** Token mint address */
  tokenMint: string;
  /** Timestamp of creation */
  createdAt: number;
  /** Ephemeral public key (for verification) */
  ephemeralAddress: string;

  // ---- Legacy fields (for migration compatibility, removed after Phase 2-3) ----
  /** @deprecated Always "funded" in Umbra */
  status: string;
  /** @deprecated Not used in Umbra — always "ephemeral" */
  fundsLocation: "ephemeral" | "pool";
  /** @deprecated Always "private" in Umbra */
  senderPrivacy: string;
  /** @deprecated Not stored in Umbra notes */
  senderAddress: string;
  /** @deprecated Alias for ephemeralSeed */
  secret: string;
}

// Legacy alias
export type DoubleHopNote = UmbraNote;

// ============================================================================
// Fee Calculations
// ============================================================================

export interface FeeEstimate {
  /** Umbra commission (0.3% of amount) */
  commission: number;
  /** Estimated gas costs */
  gasCost: number;
  /** Total fee */
  totalFee: number;
  /** What recipient receives after fees */
  recipientReceives: number;
}

/**
 * Calculate Umbra fees for a given amount.
 * Umbra charges 0.3% commission on deposits.
 */
export function calculateUmbraFees(amount: number, token: SupportedToken = "SOL"): FeeEstimate {
  const commission = Math.ceil(amount * UMBRA_FEE_PERCENT);
  const gasCost = token === "SOL" ? EPHEMERAL_GAS_BUFFER : SPL_SOL_BUFFER;
  const totalFee = commission + gasCost;
  const recipientReceives = Math.max(0, amount - commission);

  return { commission, gasCost, totalFee, recipientReceives };
}

/**
 * Calculate how much sender needs to deposit for recipient to receive a specific amount.
 * Returns just the deposit amount (number) for legacy compatibility.
 */
export function calculateDepositForRecipientAmount(
  recipientAmount: number,
  _token: SupportedToken = "SOL"
): number {
  // recipientReceives = depositAmount - (depositAmount * 0.003)
  // depositAmount = recipientReceives / (1 - 0.003)
  return Math.ceil(recipientAmount / (1 - UMBRA_FEE_PERCENT));
}

/**
 * Full deposit calculation with fee breakdown.
 */
export function calculateFullDepositInfo(
  recipientAmount: number,
  token: SupportedToken = "SOL"
): { depositAmount: number; totalSenderPays: number; fees: FeeEstimate } {
  const depositAmount = calculateDepositForRecipientAmount(recipientAmount, token);
  const fees = calculateUmbraFees(depositAmount, token);
  const gasCost = token === "SOL" ? EPHEMERAL_GAS_BUFFER : SPL_SOL_BUFFER;

  return {
    depositAmount,
    totalSenderPays: depositAmount + gasCost,
    fees,
  };
}

/**
 * Calculate what recipient receives (legacy-compatible return shape).
 * In Umbra, fees are on the deposit side. Recipient gets the full UTXO amount.
 */
export function calculateRecipientReceives(
  amount: number,
  claimMode: ClaimMode = "quick"
): {
  poolAmount: number;
  recipientReceives: number;
  fee: number;
  privacyInfo: ClaimModeInfo;
} {
  // Umbra fee is on deposit side, not claim side — recipient gets the full amount
  return {
    poolAmount: amount,
    recipientReceives: amount,
    fee: 0,
    privacyInfo: CLAIM_MODES[claimMode],
  };
}

// Legacy fee functions for compatibility
export function calculateFees(amount: number): FeeEstimate {
  return calculateUmbraFees(amount, "SOL");
}

export function calculateSPLFees(amount: number, _decimals: number = 6): FeeEstimate {
  return calculateUmbraFees(amount, "USDC");
}

export function calculateSenderCost(
  recipientAmountLamports: number,
  _senderPrivacy: string = "private"
) {
  const result = calculateFullDepositInfo(recipientAmountLamports, "SOL");
  return {
    recipientAmount: recipientAmountLamports,
    senderPays: result.totalSenderPays,
    senderFee: result.fees.totalFee,
  };
}

/**
 * Calculate what recipient receives for SPL tokens (legacy-compatible return shape).
 */
export function calculateSPLRecipientReceives(
  tokenAmount: number,
  claimMode: ClaimMode = "quick",
  _decimals: number = 6
): {
  poolAmount: number;
  recipientReceives: number;
  fee: number;
  privacyInfo: ClaimModeInfo;
} {
  return {
    poolAmount: tokenAmount,
    recipientReceives: tokenAmount,
    fee: 0,
    privacyInfo: CLAIM_MODES[claimMode],
  };
}

export function calculateDepositForRecipientAmountLegacy(recipientAmount: number) {
  return calculateDepositForRecipientAmount(recipientAmount, "SOL");
}

export function calculateSPLDepositForRecipientAmount(recipientAmount: number, _decimals: number = 6) {
  return calculateDepositForRecipientAmount(recipientAmount, "USDC");
}

// ============================================================================
// Ephemeral Key Generation
// ============================================================================

/**
 * Lazy-loaded Keypair to avoid bundling issues with @solana/web3.js CURVE error.
 * Server-side: loads synchronously. Client-side: requires dynamic import for pages.
 */
let _Keypair: typeof import("@solana/web3.js").Keypair | null = null;

function getKeypairSync(): typeof import("@solana/web3.js").Keypair {
  if (!_Keypair) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web3 = require("@solana/web3.js");
    _Keypair = web3.Keypair;
  }
  return _Keypair!;
}

export interface EphemeralKey {
  /** Base58-encoded 32-byte seed */
  seed: string;
  /** Derived Keypair */
  keypair: InstanceType<typeof import("@solana/web3.js").Keypair>;
  /** Public key as base58 string */
  address: string;
}

/**
 * Generate an ephemeral keypair from a random 32-byte seed.
 * The seed is what goes in the URL; the keypair is derived from it.
 */
export function generateEphemeralKey(): EphemeralKey {
  const Keypair = getKeypairSync();

  // Generate 32 random bytes as seed
  let seedBytes: Uint8Array;
  if (typeof window !== "undefined" && window.crypto) {
    seedBytes = new Uint8Array(32);
    window.crypto.getRandomValues(seedBytes);
  } else {
    // Node.js
    const { randomBytes } = require("crypto");
    seedBytes = new Uint8Array(randomBytes(32));
  }

  const keypair = Keypair.fromSeed(seedBytes);
  const seed = bs58.encode(seedBytes);
  const address = keypair.publicKey.toBase58();

  return { seed, keypair, address };
}

/**
 * Reconstruct an ephemeral keypair from a base58-encoded seed.
 */
export function decodeEphemeralSeed(encoded: string): EphemeralKey | null {
  try {
    const Keypair = getKeypairSync();
    const seedBytes = bs58.decode(encoded);
    if (seedBytes.length !== 32) return null;

    const keypair = Keypair.fromSeed(seedBytes);
    const address = keypair.publicKey.toBase58();

    return { seed: encoded, keypair, address };
  } catch {
    return null;
  }
}

// Legacy type alias
export type CompositeSecret = {
  full: string;
  claimId: string;
  ephemeralSeed: string;
  ephemeralKeypair: InstanceType<typeof import("@solana/web3.js").Keypair>;
};

/**
 * Legacy compatibility: generates a CompositeSecret-compatible object.
 * SYNC — matches old PrivacyCash API.
 */
export function generateCompositeSecret(): CompositeSecret {
  const eph = generateEphemeralKey();
  return {
    full: eph.seed,
    claimId: eph.seed.substring(0, 22),
    ephemeralSeed: eph.seed,
    ephemeralKeypair: eph.keypair,
  };
}

/**
 * Legacy compatibility: decodes a composite secret.
 * SYNC — matches old PrivacyCash API.
 */
export function decodeCompositeSecret(encoded: string): CompositeSecret | null {
  const eph = decodeEphemeralSeed(encoded);
  if (!eph) return null;
  return {
    full: encoded,
    claimId: encoded.substring(0, 22),
    ephemeralSeed: encoded,
    ephemeralKeypair: eph.keypair,
  };
}

// ============================================================================
// URL Serialization
// ============================================================================

/** Compact serialized format for URL hash */
interface SerializedNote {
  /** Ephemeral seed (base58) */
  s: string;
  /** Amount in base units */
  a: number;
  /** Network: "m" = mainnet, "d" = devnet */
  n: string;
  /** Token symbol */
  t: string;
  /** Token mint */
  tm: string;
  /** Created timestamp */
  c: number;
  /** Ephemeral address (for verification) */
  e: string;
  /** Version marker */
  v: 2;
}

/**
 * Serialize an UmbraNote to a base58-encoded string for URL hash.
 */
export function serializeUmbraNote(note: UmbraNote): string {
  const data: SerializedNote = {
    s: note.ephemeralSeed,
    a: note.amount,
    n: note.network === "mainnet" ? "m" : "d",
    t: note.token,
    tm: note.tokenMint,
    c: note.createdAt,
    e: note.ephemeralAddress,
    v: 2, // Version 2 = Umbra format
  };
  const json = JSON.stringify(data);
  return bs58.encode(new TextEncoder().encode(json));
}

/**
 * Deserialize an UmbraNote from a base58-encoded string.
 */
export function deserializeUmbraNote(encoded: string): UmbraNote | null {
  try {
    const json = new TextDecoder().decode(bs58.decode(encoded));
    const data = JSON.parse(json);

    // Version 2 = Umbra format
    if (data.v === 2) {
      return {
        ephemeralSeed: data.s,
        amount: data.a,
        network: data.n === "m" ? "mainnet" : "devnet",
        token: data.t as SupportedToken,
        tokenMint: data.tm,
        createdAt: data.c,
        ephemeralAddress: data.e,
        // Legacy compat fields
        secret: data.s,
        status: "funded",
        fundsLocation: "ephemeral",
        senderPrivacy: "private",
        senderAddress: "",
      };
    }

    // Legacy PrivacyCash format (v1) — parse into UmbraNote shape for display
    // These links can't actually be claimed via Umbra, but we can show an error
    if (data.s && data.fl !== undefined) {
      return {
        ephemeralSeed: data.s,
        amount: data.a || 0,
        network: data.n === "mainnet-beta" ? "mainnet" : (data.n || "devnet"),
        token: (data.t || "SOL") as SupportedToken,
        tokenMint: data.tm || WSOL_MINT,
        createdAt: Date.now(),
        ephemeralAddress: data.e || "",
        // Legacy fields
        secret: data.s,
        status: data.st || "funded",
        fundsLocation: data.fl || "ephemeral",
        senderPrivacy: data.sp || "basic",
        senderAddress: data.sa || "",
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Create a claim URL from a note.
 */
export function createClaimUrl(note: UmbraNote, baseUrl?: string): string {
  const base = baseUrl || (typeof window !== "undefined" ? window.location.origin : "https://hoppy.cash");
  const serialized = serializeUmbraNote(note);
  return `${base}/claim#${serialized}`;
}

/**
 * Extract an UmbraNote from the current URL or a given URL string.
 */
export function extractNoteFromUrl(url?: string): UmbraNote | null {
  let hash: string;

  if (url) {
    const hashIndex = url.indexOf("#");
    if (hashIndex === -1) {
      // Try treating the whole string as a serialized note
      return deserializeUmbraNote(url);
    }
    hash = url.substring(hashIndex + 1);
  } else if (typeof window !== "undefined") {
    hash = window.location.hash.substring(1);
  } else {
    return null;
  }

  if (!hash) return null;
  return deserializeUmbraNote(hash);
}

// Legacy aliases for migration compatibility
export const serializeDoubleHopNote = serializeUmbraNote;
export const deserializeDoubleHopNote = deserializeUmbraNote;
export const createDoubleHopClaimUrl = createClaimUrl;
export const extractDoubleHopNoteFromUrl = extractNoteFromUrl;

// ============================================================================
// Umbra SDK Helpers
// ============================================================================

/** Configuration for Umbra SDK client initialization */
export interface UmbraConfig {
  network: "mainnet" | "devnet";
  rpcUrl: string;
  wsUrl: string;
  indexerUrl: string;
  relayerUrl: string;
}

/**
 * Get Umbra configuration from environment variables.
 */
export function getUmbraConfig(): UmbraConfig {
  const network = (process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet-beta" ||
                   process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet")
    ? "mainnet" : "devnet";

  return {
    network,
    rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com",
    wsUrl: process.env.NEXT_PUBLIC_SOLANA_WS_URL || "wss://api.devnet.solana.com",
    indexerUrl: process.env.NEXT_PUBLIC_UMBRA_INDEXER_URL || "https://acqzie0a1h.execute-api.eu-central-1.amazonaws.com",
    relayerUrl: process.env.NEXT_PUBLIC_UMBRA_RELAYER_URL || "https://6yn4ndrv2i.execute-api.eu-central-1.amazonaws.com",
  };
}

/**
 * Create an Umbra client from a @solana/web3.js Keypair (server-side / bot).
 * Uses createSignerFromKeyPair from the SDK.
 */
export async function createUmbraClientFromKeypair(
  keypair: InstanceType<typeof import("@solana/web3.js").Keypair>,
  configOverride?: Partial<UmbraConfig>
) {
  const { getUmbraClientFromSigner, createSignerFromPrivateKeyBytes } = await import("@umbra-privacy/sdk");
  const config = { ...getUmbraConfig(), ...configOverride };

  // createSignerFromPrivateKeyBytes accepts 64-byte keypair (secretKey) or 32-byte seed
  // @solana/web3.js Keypair.secretKey is 64 bytes (private + public key)
  const signer = await createSignerFromPrivateKeyBytes(new Uint8Array(keypair.secretKey));

  const client = await getUmbraClientFromSigner({
    signer,
    network: config.network as any,
    rpcUrl: config.rpcUrl,
    rpcSubscriptionsUrl: config.wsUrl,
    indexerApiEndpoint: config.indexerUrl,
  });

  return client;
}

/**
 * Register a user on Umbra (idempotent — safe to call multiple times).
 * Returns transaction signatures if registration was needed, empty array if already registered.
 */
export async function ensureRegistered(
  client: any,
  options?: { confidential?: boolean; anonymous?: boolean }
): Promise<string[]> {
  const { getUserRegistrationFunction } = await import("@umbra-privacy/sdk");
  const register = getUserRegistrationFunction({ client });

  try {
    const sigs = await register({
      confidential: options?.confidential ?? true,
      anonymous: options?.anonymous ?? true,
    });
    return sigs.map((s: any) => String(s));
  } catch (error: any) {
    // If already registered, the SDK should handle this gracefully
    // But catch just in case
    if (error.message?.includes("already") || error.message?.includes("exists")) {
      return [];
    }
    throw error;
  }
}

/**
 * Get the Umbra relayer instance.
 */
export async function getRelayer(configOverride?: Partial<UmbraConfig>) {
  const { getUmbraRelayer } = await import("@umbra-privacy/sdk");
  const config = { ...getUmbraConfig(), ...configOverride };

  return getUmbraRelayer({
    apiEndpoint: config.relayerUrl,
  });
}

// ============================================================================
// Legacy exports for gradual migration
// ============================================================================

// These maintain the same export shape as privacy-cash-adapter.ts
// so that files importing from index.ts don't break during migration

export type PrivacyLevel = "quick" | "private";
export const PRIVACY_LEVELS = CLAIM_MODES;

export const SENDER_PRIVACY: Record<SenderPrivacy, { id: SenderPrivacy; name: string; label: string; description: string; senderHidden: boolean; estimatedCost: string }> = {
  basic: {
    id: "basic",
    name: "Basic",
    label: "Basic",
    description: "All sends are private in Umbra (basic is deprecated).",
    senderHidden: false,
    estimatedCost: "0.3% commission",
  },
  private: {
    id: "private",
    name: "Private",
    label: "Private",
    description: "Sender hidden via ZK mixer.",
    senderHidden: true,
    estimatedCost: "0.3% commission",
  },
};

export const RECIPIENT_PRIVACY = CLAIM_MODES;

export type SenderPrivacyInfo = typeof SENDER_PRIVACY.private;
export type RecipientPrivacyInfo = ClaimModeInfo;

export function calculateTotalDeposit(amount: number): number {
  return calculateFullDepositInfo(amount, "SOL").totalSenderPays;
}
