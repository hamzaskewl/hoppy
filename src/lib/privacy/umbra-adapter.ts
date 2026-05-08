/**
 * Umbra Privacy Adapter
 *
 * Wraps the Umbra Privacy SDK for use throughout the Hoppy app.
 *
 * NOTES:
 * - Uses wSOL (auto-wrap/unwrap handled transparently)
 * - Users must register on Umbra before receiving (1-3 on-chain txs, idempotent)
 * - ZK proofs via WASM prover (1-5 seconds)
 * - UTXO lookup via indexer (instant, no brute-force scanning)
 *
 * PRIVACY MODEL (hybrid — sender & receiver choose independently):
 * - Sender basic: direct transfer to ephemeral (visible on-chain, cheapest)
 * - Sender private: sender→Umbra pool→ephemeral (sender hidden via ZK mixer, ~0.21%)
 * - Claim quick: ephemeral→receiver (direct transfer, cheapest)
 * - Claim private: ephemeral→Umbra pool→receiver (receiver hidden via ZK mixer, ~0.21%)
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

/**
 * Umbra v2 fee: 35 BPS with divisor 2^14 = 16384.
 * Effective rate ≈ 0.2136%  (floor(amount × 35 / 16384))
 */
export const UMBRA_FEE_BPS = 35;
export const UMBRA_BPS_DIVISOR = 16384;
/** Legacy alias — now derived from BPS for backwards compat */
export const UMBRA_FEE_PERCENT = UMBRA_FEE_BPS / UMBRA_BPS_DIVISOR; // ≈ 0.002136

/**
 * Gas buffer for ephemeral Umbra ops (registration + proof account + tx fees).
 *
 * NET cost is only ~0.003 SOL (most rent gets reclaimed via ClaimComputationRent),
 * but PEAK requirement is higher because Arcium's QueueComputation rent
 * (~0.006 SOL) has to be paid before it gets reclaimed. So we need at least:
 *   0.006 (queue rent) + 0.002 (init account + token register) + 0.001 (tx fees)
 *   ≈ 0.009 SOL peak.
 *
 * We use 0.012 to be safe. Any unused balance gets drained back to the claimer
 * on claim, so over-funding is not "wasted" — just temporarily locked.
 */
export const EPHEMERAL_GAS_BUFFER = 12_000_000; // 0.012 SOL

/** Extra rent needed for creating wSOL ATA on the sender ephemeral (recovered when ATA closed) */
export const WSOL_ATA_RENT = 2_039_280; // exact rent-exempt minimum for token account

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
 * NOTE: SOL uses wSOL mint (Umbra wraps SOL automatically).
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
// Privacy Types — Sender & Receiver choose independently
// ============================================================================

/**
 * Sender privacy:
 *   basic   = direct transfer (sender visible on-chain)
 *   private = ZK mixer self-claimable (sender's regular /create flow)
 *   payroll = receiver-claimable from escrow's encrypted balance (server-issued)
 */
export type SenderPrivacy = "basic" | "private" | "payroll";

/** Claim mode: quick = direct transfer, private = ZK mixer */
export type ClaimMode = "quick" | "private";

export type RecipientPrivacy = ClaimMode;

export interface SenderPrivacyInfo {
  id: SenderPrivacy;
  label: string;
  name: string;
  description: string;
  icon: string;
  senderHidden: boolean;
  feeDescription: string;
}

// Only the user-facing send modes need an info entry — payroll links are
// generated server-side and never appear in the /create UI.
export const SENDER_PRIVACY: Record<"basic" | "private", SenderPrivacyInfo> = {
  basic: {
    id: "basic",
    label: "Basic",
    name: "Basic Send",
    description: "Direct transfer. Cheaper, but your wallet is visible on-chain.",
    icon: "zap",
    senderHidden: false,
    feeDescription: "~0.000005 SOL (tx fee only)",
  },
  private: {
    id: "private",
    label: "Private",
    name: "Private Send",
    description: "ZK mixer hides your wallet from on-chain observers.",
    icon: "shield",
    senderHidden: true,
    feeDescription: "~0.21% + ~0.02 SOL gas",
  },
};

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
    description: "Direct transfer to your wallet. Fast and free.",
    icon: "zap",
    recipientHidden: false,
    feeDescription: "~0 fees",
    hops: 0,
  },
  private: {
    id: "private",
    label: "Private",
    name: "Private Claim",
    description: "ZK mixer hides your wallet from on-chain observers.",
    icon: "shield",
    recipientHidden: true,
    feeDescription: "~0.21% + gas",
    hops: 1,
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

  /** Sender privacy mode chosen at creation time */
  senderPrivacy: SenderPrivacy;

  // ---- Legacy fields (for migration compatibility) ----
  /** @deprecated Always "funded" in Umbra */
  status: string;
  /** @deprecated Not used in Umbra — always "ephemeral" */
  fundsLocation: "ephemeral" | "pool";
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
 * Calculate Umbra v2 fees for a given amount.
 * Fee = floor(amount × 35 / 16384) ≈ 0.2136%
 */
export function calculateUmbraFees(amount: number, token: SupportedToken = "SOL"): FeeEstimate {
  const commission = Math.floor(amount * UMBRA_FEE_BPS / UMBRA_BPS_DIVISOR);
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
  // fee = floor(deposit × 35 / 16384), so deposit = ceil(recipientAmount × 16384 / (16384 - 35))
  return Math.ceil(recipientAmount * UMBRA_BPS_DIVISOR / (UMBRA_BPS_DIVISOR - UMBRA_FEE_BPS));
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
 * Estimated amount actually received by the claimer for a private SOL send.
 *
 * On claim, the ephemeral wallet's wSOL ATA is closed (recovers ~0.00204 rent)
 * and ALL leftover native SOL is drained to the recipient. So the recipient
 * gets more than just the UTXO amount.
 *
 * Empirically measured on mainnet (0.01 send → 0.0178 received):
 *   UTXO amount  + ATA rent recovered + ~unused gas buffer (~60% of the buffer)
 *
 * @param utxoAmount - The UTXO amount in lamports (the "claim" notional value)
 * @returns Estimated lamports the claimer will actually receive after drain
 */
export function estimatePrivateClaimReceives(utxoAmount: number): number {
  // ATA rent always recovered when wSOL ATA is closed during claim drain
  const ataRentRecovered = WSOL_ATA_RENT;
  // Most of the gas buffer is reclaimable rent (Arcium QueueComputation,
  // proof accounts) — only ~0.003 SOL is permanently consumed. Conservative
  // 70% leftover assumption.
  const estimatedLeftoverGas = Math.floor(EPHEMERAL_GAS_BUFFER * 0.7);
  // Drain tx itself costs ~5000 lamports
  const drainTxFee = 5000;
  return utxoAmount + ataRentRecovered + estimatedLeftoverGas - drainTxFee;
}

/**
 * Calculate what recipient receives (legacy-compatible return shape).
 *
 * For private sends (mixer): recipient gets UTXO + recovered rent + leftover gas.
 * For basic/quick sends: recipient gets the full deposited amount minus tx fee.
 */
export function calculateRecipientReceives(
  amount: number,
  claimMode: ClaimMode = "quick",
  senderPrivacy: SenderPrivacy = "basic"
): {
  poolAmount: number;
  recipientReceives: number;
  fee: number;
  privacyInfo: ClaimModeInfo;
} {
  const recipientReceives = senderPrivacy === "private"
    ? estimatePrivateClaimReceives(amount)
    : amount;
  return {
    poolAmount: amount,
    recipientReceives,
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
  senderPrivacy: SenderPrivacy = "private"
) {
  if (senderPrivacy === "basic") {
    // Basic: just a SystemProgram.transfer — only tx fee
    const txFee = 5000; // ~5000 lamports
    return {
      recipientAmount: recipientAmountLamports,
      senderPays: recipientAmountLamports + txFee,
      senderFee: txFee,
    };
  }

  // Private: 0.3% commission + gas buffer for ephemeral registration/claim
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
 * SYNC helper for legacy call sites.
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
 * SYNC helper for legacy call sites.
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
  /** Sender privacy: "b" = basic, "p" = private */
  sp?: string;
  /** Version marker */
  v: 2;
}

/**
 * Serialize an UmbraNote to a base58-encoded string for URL hash.
 */
export function serializeUmbraNote(note: UmbraNote): string {
  // sp encoding: "b" basic | "p" private | "y" payroll
  const sp = note.senderPrivacy === "basic" ? "b"
    : note.senderPrivacy === "payroll" ? "y"
    : "p";
  const data: SerializedNote = {
    s: note.ephemeralSeed,
    a: note.amount,
    n: note.network === "mainnet" ? "m" : "d",
    t: note.token,
    tm: note.tokenMint,
    c: note.createdAt,
    e: note.ephemeralAddress,
    sp,
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
      const senderPrivacy: SenderPrivacy =
        data.sp === "b" ? "basic" :
        data.sp === "y" ? "payroll" :
        "private";
      // Both private and payroll deposit into the Umbra pool; basic stays on ephemeral
      const fundsLocation = senderPrivacy === "basic" ? "ephemeral" : "pool";
      return {
        ephemeralSeed: data.s,
        amount: data.a,
        network: data.n === "m" ? "mainnet" : "devnet",
        token: data.t as SupportedToken,
        tokenMint: data.tm,
        createdAt: data.c,
        ephemeralAddress: data.e,
        senderPrivacy,
        // Legacy compat fields
        secret: data.s,
        status: "funded",
        fundsLocation,
        senderAddress: "",
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

  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
  // Derive WebSocket URL from RPC URL if not explicitly set
  const wsUrl = process.env.NEXT_PUBLIC_SOLANA_WS_URL ||
    rpcUrl.replace("https://", "wss://").replace("http://", "ws://");

  // Network-specific Umbra infra (devnet vs mainnet have different subdomains)
  const defaultIndexer = network === "mainnet"
    ? "https://utxo-indexer.api.umbraprivacy.com"
    : "https://utxo-indexer.api-devnet.umbraprivacy.com";
  const defaultRelayer = network === "mainnet"
    ? "https://relayer.api.umbraprivacy.com"
    : "https://relayer.api-devnet.umbraprivacy.com";

  return {
    network,
    rpcUrl,
    wsUrl,
    indexerUrl: process.env.NEXT_PUBLIC_UMBRA_INDEXER_URL || defaultIndexer,
    relayerUrl: process.env.NEXT_PUBLIC_UMBRA_RELAYER_URL || defaultRelayer,
  };
}

/**
 * Build a config for a SPECIFIC network, overriding the env-based default.
 * Used when claiming a note whose network differs from the deploy's network
 * (e.g. devnet payroll link being claimed on a mainnet-deployed Railway).
 */
export function getUmbraConfigForNetwork(network: "mainnet" | "devnet"): UmbraConfig {
  const rpcUrl = network === "mainnet"
    ? (process.env.NEXT_PUBLIC_SOLANA_RPC_URL && process.env.NEXT_PUBLIC_SOLANA_NETWORK !== "devnet"
        ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL
        : "https://api.mainnet-beta.solana.com")
    : "https://api.devnet.solana.com";
  const wsUrl = rpcUrl.replace("https://", "wss://").replace("http://", "ws://");
  const indexerUrl = network === "mainnet"
    ? "https://utxo-indexer.api.umbraprivacy.com"
    : "https://utxo-indexer.api-devnet.umbraprivacy.com";
  const relayerUrl = network === "mainnet"
    ? "https://relayer.api.umbraprivacy.com"
    : "https://relayer.api-devnet.umbraprivacy.com";
  return { network, rpcUrl, wsUrl, indexerUrl, relayerUrl };
}

/**
 * Create an Umbra client from a @solana/web3.js Keypair (server-side / bot).
 * Uses createSignerFromKeyPair from the SDK.
 */
export async function createUmbraClientFromKeypair(
  keypair: InstanceType<typeof import("@solana/web3.js").Keypair>,
  configOverride?: Partial<UmbraConfig>
) {
  const { getUmbraClient, createSignerFromPrivateKeyBytes, getPollingTransactionForwarder, getPollingComputationMonitor } = await import("@umbra-privacy/sdk");
  const config = { ...getUmbraConfig(), ...configOverride };

  // createSignerFromPrivateKeyBytes accepts 64-byte keypair (secretKey) or 32-byte seed
  // @solana/web3.js Keypair.secretKey is 64 bytes (private + public key)
  const signer = await createSignerFromPrivateKeyBytes(new Uint8Array(keypair.secretKey));

  // Use polling-based forwarding and monitoring instead of WebSocket —
  // more reliable in browsers and avoids premature callback simulation failures
  const transactionForwarder = getPollingTransactionForwarder({ rpcUrl: config.rpcUrl });
  const computationMonitor = getPollingComputationMonitor({ rpcUrl: config.rpcUrl });

  const client = await getUmbraClient({
    signer,
    network: config.network as any,
    rpcUrl: config.rpcUrl,
    rpcSubscriptionsUrl: config.wsUrl,
    indexerApiEndpoint: config.indexerUrl,
  }, {
    transactionForwarder,
    computationMonitor,
  });

  return client;
}

/**
 * Create an Umbra client from wallet-standard Wallet + WalletAccount (browser wallets).
 * Used for web sender private mode where the connected wallet signs Umbra operations.
 *
 * @param wallet - Wallet from @wallet-standard/base (the connected wallet adapter)
 * @param walletAccount - WalletAccount from @wallet-standard/base (the active account)
 */
export async function createUmbraClientFromWallet(
  wallet: any, // Wallet from @wallet-standard/base
  walletAccount: any, // WalletAccount from @wallet-standard/base
  configOverride?: Partial<UmbraConfig>
) {
  const { getUmbraClient, createSignerFromWalletAccount, getPollingTransactionForwarder, getPollingComputationMonitor } = await import("@umbra-privacy/sdk");
  const config = { ...getUmbraConfig(), ...configOverride };

  const signer = createSignerFromWalletAccount(wallet, walletAccount);

  const transactionForwarder = getPollingTransactionForwarder({ rpcUrl: config.rpcUrl });
  const computationMonitor = getPollingComputationMonitor({ rpcUrl: config.rpcUrl });

  const client = await getUmbraClient({
    signer,
    network: config.network as any,
    rpcUrl: config.rpcUrl,
    rpcSubscriptionsUrl: config.wsUrl,
    indexerApiEndpoint: config.indexerUrl,
  }, {
    transactionForwarder,
    computationMonitor,
  });

  return client;
}

/**
 * Create an Umbra client from a raw private key (32 or 64 bytes).
 * Used for embedded wallets that can export their private key.
 */
export async function createUmbraClientFromPrivateKey(
  privateKeyBytes: Uint8Array,
  configOverride?: Partial<UmbraConfig>
) {
  const { getUmbraClient, createSignerFromPrivateKeyBytes, getPollingTransactionForwarder, getPollingComputationMonitor } = await import("@umbra-privacy/sdk");
  const config = { ...getUmbraConfig(), ...configOverride };

  const signer = await createSignerFromPrivateKeyBytes(privateKeyBytes);

  const transactionForwarder = getPollingTransactionForwarder({ rpcUrl: config.rpcUrl });
  const computationMonitor = getPollingComputationMonitor({ rpcUrl: config.rpcUrl });

  const client = await getUmbraClient({
    signer,
    network: config.network as any,
    rpcUrl: config.rpcUrl,
    rpcSubscriptionsUrl: config.wsUrl,
    indexerApiEndpoint: config.indexerUrl,
  }, {
    transactionForwarder,
    computationMonitor,
  });

  return client;
}

/**
 * Register a user on Umbra (idempotent — safe to call multiple times).
 * Returns transaction signatures if registration was needed, empty array if already registered.
 */
export async function ensureRegistered(
  client: any,
  options?: { confidential?: boolean; anonymous?: boolean; zkAssetProvider?: any }
): Promise<string[]> {
  const { getUserRegistrationFunction } = await import("@umbra-privacy/sdk");
  const anonymous = options?.anonymous ?? true;

  // Anonymous registration requires a ZK prover
  let deps: any = {};
  if (anonymous) {
    const { getUserRegistrationProver } = await import("@umbra-privacy/web-zk-prover");
    deps.zkProver = getUserRegistrationProver(
      options?.zkAssetProvider ? { assetProvider: options.zkAssetProvider } : undefined
    );
  }

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Re-create the registration function each attempt so it fetches a fresh blockhash
    const register = getUserRegistrationFunction({ client }, deps);

    try {
      const sigs = await register({
        confidential: options?.confidential ?? true,
        anonymous,
      });
      return sigs.map((s: any) => String(s));
    } catch (error: any) {
      // Collect all error messages from the cause chain
      const allMessages: string[] = [];
      let e = error;
      while (e) {
        if (e.message) allMessages.push(e.message);
        e = e.cause;
      }
      const fullError = allMessages.join(" | ");

      // Already registered / callback already processed — not an error
      if (
        fullError.includes("already") ||
        fullError.includes("exists") ||
        fullError.includes("Already registered") ||
        fullError.includes("AlreadyCallbacked") ||
        fullError.includes("already called") ||
        fullError.includes("custom program error: #1") // account already initialized
      ) {
        console.log("[Umbra] Already registered (or partially), skipping");
        return [];
      }

      // Blockhash expired — retry with a fresh one
      const isBlockhashExpired =
        fullError.includes("block height") ||
        fullError.includes("blockhash") ||
        fullError.includes("progressed past");

      if (isBlockhashExpired && attempt < MAX_RETRIES) {
        console.warn(`[Umbra] Registration blockhash expired, retrying (${attempt}/${MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      console.error("[Umbra] Registration failed:", error.message, error.cause || "");
      throw error;
    }
  }
  return []; // unreachable but satisfies TS
}

/**
 * Get the Umbra relayer instance.
 */
export async function getRelayer(configOverride?: Partial<UmbraConfig>) {
  const { getUmbraRelayer } = await import("@umbra-privacy/sdk");
  const config = { ...getUmbraConfig(), ...configOverride };

  return getUmbraRelayer({
    apiEndpoint: config.relayerUrl,
  } as any);
}

// ============================================================================
// Legacy exports for gradual migration
// ============================================================================

export type PrivacyLevel = "quick" | "private";
export const PRIVACY_LEVELS = CLAIM_MODES;
export const RECIPIENT_PRIVACY = CLAIM_MODES;
export type RecipientPrivacyInfo = ClaimModeInfo;

export function calculateTotalDeposit(amount: number, senderPrivacy: SenderPrivacy = "private"): number {
  return calculateSenderCost(amount, senderPrivacy).senderPays;
}
