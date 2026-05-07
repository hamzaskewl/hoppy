/**
 * Umbra adapter (server-side only).
 *
 * Real on-chain implementation. Each public function does exactly what its
 * name says, with no mocking. Trade-offs documented per-function.
 *
 * Trust model:
 *   - The Hoppy server holds the per-business escrow keypair (deterministic
 *     from UMBRA_ESCROW_MASTER_KEY + business wallet). The escrow is the
 *     Umbra signer for issuance ops, so the business doesn't sign N times.
 *   - The server also reconstructs the stealth keypair on claim (the seed
 *     lives in the URL hash). This preserves the no-setup recipient UX.
 *
 * Performance reality:
 *   - Each Groth16 ZK proof takes 30–120 s on a typical Node server.
 *     `umbraPayrollIssueLink` runs one prover; `umbraPayrollClaim` runs two
 *     (claim + then a withdraw, plus possibly a one-time stealth registration
 *     proof). Plan for the API routes to take minutes.
 */

import {
  getUserRegistrationFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getClaimableUtxoScannerFunction,
} from "@umbra-privacy/sdk";
import type { ScannedUtxoData } from "@umbra-privacy/sdk/interfaces";
import bs58 from "bs58";
import type { UmbraNote } from "@/lib/payroll/types";
import {
  getEscrowKeypair,
  getEscrowAddress,
  stealthKeypairFromSeed,
} from "./keys";
import {
  umbraClientFor,
  umbraRelayer,
  createUtxoProver,
  claimUtxoProver,
  registrationProver,
  networkName,
} from "./client";
import {
  WSOL_MINT,
  wrapSol,
  unwrapAllWsol,
  confirmSolTransferTo,
  transferSol,
  wsolAtaFor,
} from "./wsol";
import { PublicKey } from "@solana/web3.js";

const WSOL_MINT_STR = WSOL_MINT.toBase58();

/** Minimum SOL we keep in the escrow as gas/rent buffer (lamports). */
const ESCROW_BUFFER = 100_000_000; // 0.1 SOL — covers per-link stealth funding for ~3 links per top-up

/**
 * SOL transferred to each stealth wallet at issuance time. Pays for:
 *   1. Stealth's own Umbra registration (required so issuance can encrypt to it).
 *   2. Later: register-noop + claim + withdraw + unwrap + transfer when the
 *      recipient claims (5 txs).
 * 0.03 SOL is generous; unused remainder is drained back to the recipient on
 * claim by the existing transferSol(stealth → recipient) step.
 */
const STEALTH_FUND_BUDGET = 30_000_000; // 0.03 SOL

// ============================================================================
// URL codec
// ============================================================================

export function encodeNoteToUrl(note: UmbraNote, origin: string): string {
  const json = JSON.stringify(note);
  const b58 = bs58.encode(new TextEncoder().encode(json));
  return `${origin.replace(/\/$/, "")}/payroll/claim#${b58}`;
}

export function extractNoteFromUrl(url: string): UmbraNote | null {
  try {
    const hash = url.includes("#") ? url.split("#")[1] : url;
    if (!hash) return null;
    const json = new TextDecoder().decode(bs58.decode(hash));
    const parsed = JSON.parse(json) as UmbraNote;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractNoteFromHash(hash: string): UmbraNote | null {
  return extractNoteFromUrl(hash);
}

// ============================================================================
// Escrow address (no chain calls)
// ============================================================================

export function escrowAddressFor(businessWallet: string): string {
  return getEscrowAddress(businessWallet);
}

// ============================================================================
// Bulk deposit
// ============================================================================

export interface PayrollDepositInput {
  businessWallet: string;
  /** Total SOL amount the business says they sent (lamports). */
  totalAmount: number;
  /** Tx hash from the business's Privy-signed SystemProgram.transfer to escrow. */
  signedDepositTxHash: string;
}

export interface PayrollDepositResult {
  /** The escrow address; doubles as our "pool position id". */
  poolPositionId: string;
  depositTxHash: string;
  wrapTxHash: string;
  umbraDepositQueueSignature: string;
  umbraDepositCallbackSignature?: string;
}

/**
 * 1. Confirm the business's SOL transfer hit the escrow.
 * 2. Wrap (totalAmount - buffer) SOL into wSOL on the escrow's ATA.
 * 3. Idempotent-register the escrow with Umbra.
 * 4. Deposit wSOL into the escrow's encrypted balance.
 */
export async function umbraPayrollDeposit(
  input: PayrollDepositInput,
): Promise<PayrollDepositResult> {
  if (input.totalAmount <= ESCROW_BUFFER) {
    throw new Error(
      `totalAmount must exceed escrow buffer (${ESCROW_BUFFER} lamports)`,
    );
  }

  const escrow = getEscrowKeypair(input.businessWallet);
  const escrowPk = escrow.publicKey;

  // 1. Confirm business → escrow transfer.
  const delivered = await confirmSolTransferTo(
    input.signedDepositTxHash,
    escrowPk,
    input.totalAmount,
  );
  const wrappable = delivered - ESCROW_BUFFER;

  // 2. Wrap to wSOL on escrow's ATA.
  const { signature: wrapSig } = await wrapSol(escrow, wrappable);

  // 3. Build Umbra client + register escrow.
  const client = await umbraClientFor(escrow);
  const register = getUserRegistrationFunction(
    { client },
    { zkProver: registrationProver() },
  );
  await register({ confidential: true, anonymous: true });

  // 4. Deposit wSOL into encrypted balance.
  const deposit = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({
    client,
  });
  const depositResult = await deposit(
    client.signer.address,
    WSOL_MINT_STR as never,
    BigInt(wrappable) as never,
  );

  return {
    poolPositionId: escrowPk.toBase58(),
    depositTxHash: input.signedDepositTxHash,
    wrapTxHash: wrapSig,
    umbraDepositQueueSignature: depositResult.queueSignature,
    umbraDepositCallbackSignature: depositResult.callbackSignature,
  };
}

// ============================================================================
// Per-employee link issuance
// ============================================================================

export interface PayrollIssueLinkInput {
  businessWallet: string;
  amount: number;
  from?: string;
}

export interface PayrollIssueLinkResult {
  note: UmbraNote;
  issueTxHash?: string;
}

/**
 * Generate a stealth keypair and use the escrow's Umbra client to create a
 * receiver-claimable UTXO destined for the stealth address. The stealth seed
 * is embedded in the returned note (which goes in the URL hash).
 */
export async function umbraPayrollIssueLink(
  input: PayrollIssueLinkInput,
): Promise<PayrollIssueLinkResult> {
  if (input.amount <= 0) throw new Error("amount must be positive");

  const escrow = getEscrowKeypair(input.businessWallet);
  const stealthSeed = crypto.getRandomValues(new Uint8Array(32));
  const stealth = stealthKeypairFromSeed(stealthSeed);

  // Step 1: fund the stealth with SOL. Required so the stealth can pay for its
  // own Umbra registration (next step) and for the eventual claim flow's txs.
  await transferSol(escrow, stealth.publicKey, STEALTH_FUND_BUDGET);

  // Step 2: register the stealth on Umbra. Required because createUtxo's ZK
  // proof needs to encrypt the UTXO commitment against the receiver's
  // registered Umbra public commitment — fails with "Receiver is not
  // registered" otherwise.
  const stealthClient = await umbraClientFor(stealth);
  const registerStealth = getUserRegistrationFunction(
    { client: stealthClient },
    { zkProver: registrationProver() },
  );
  await registerStealth({ confidential: true, anonymous: true });

  // Step 3: escrow creates the receiver-claimable UTXO destined for stealth.
  const escrowClient = await umbraClientFor(escrow);
  const createUtxo = getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction(
    { client: escrowClient },
    { zkProver: createUtxoProver() },
  );

  const result = await createUtxo({
    amount: BigInt(input.amount) as never,
    destinationAddress: stealth.publicKey.toBase58() as never,
    mint: WSOL_MINT_STR as never,
  });

  console.log("[umbra/payroll/issue-link] createUtxo result", {
    stealthAddress: stealth.publicKey.toBase58(),
    amount: input.amount,
    queueSignature: (result as { queueSignature?: string }).queueSignature,
    callbackSignature: (result as { callbackSignature?: string }).callbackSignature,
    callbackElapsedMs: (result as { callbackElapsedMs?: number }).callbackElapsedMs,
    network: networkName(),
  });

  const note: UmbraNote = {
    version: 1,
    secret: bs58.encode(stealthSeed),
    amount: input.amount,
    network: networkName(),
    stealthAddress: stealth.publicKey.toBase58(),
    from: input.from,
    status: "pending",
    token: "SOL",
  };

  return {
    note,
    issueTxHash: result.queueSignature,
  };
}

// ============================================================================
// Claim
// ============================================================================

export interface PayrollClaimInput {
  note: UmbraNote;
  recipientAddress: string;
}

export interface PayrollClaimResult {
  /** Signature of the final SOL transfer to the recipient. */
  withdrawTxHash: string;
  claimQueueSignature?: string;
  unwrapTxHash?: string;
}

/**
 * Recipient claim:
 *   1. Reconstruct stealth keypair from note.secret.
 *   2. Build stealth's Umbra client; register stealth (one-time).
 *   3. Stealth needs SOL for tx fees — escrow tops it up if empty.
 *   4. Scan stealth's claimable UTXOs and find the one matching this note.
 *   5. Claim the UTXO into stealth's encrypted balance.
 *   6. Withdraw wSOL from encrypted to stealth's wSOL ATA.
 *   7. Unwrap stealth's wSOL → native SOL.
 *   8. Stealth transfers SOL to recipient.
 */
export async function umbraPayrollClaim(
  input: PayrollClaimInput,
): Promise<PayrollClaimResult> {
  if (input.note.status !== "pending") {
    throw new Error(`note already ${input.note.status}`);
  }

  const recipientPk = (() => {
    try {
      return new PublicKey(input.recipientAddress);
    } catch {
      throw new Error("invalid recipient address");
    }
  })();

  const seed = bs58.decode(input.note.secret);
  if (seed.length !== 32) throw new Error("invalid note secret");
  const stealth = stealthKeypairFromSeed(new Uint8Array(seed));

  // Top up stealth with a tiny gas budget if it's empty. Server-paid (escrow).
  const STEALTH_GAS_BUDGET = 10_000_000; // 0.01 SOL
  const escrow = getEscrowKeypairFromNote(input.note);
  if (escrow) {
    const { getSolBalance } = await import("./wsol");
    const bal = await getSolBalance(stealth.publicKey);
    if (bal < STEALTH_GAS_BUDGET) {
      await transferSol(escrow, stealth.publicKey, STEALTH_GAS_BUDGET);
    }
  }

  const client = await umbraClientFor(stealth);

  // Register stealth (idempotent — no-op if already registered).
  const register = getUserRegistrationFunction(
    { client },
    { zkProver: registrationProver() },
  );
  await register({ confidential: true, anonymous: true });

  // Find the receiver-claimable UTXO targeting this stealth.
  // The claim function fetches merkle proofs internally via the
  // fetchBatchMerkleProof dep — we just pass the scanned UTXOs.
  const scan = getClaimableUtxoScannerFunction({ client });
  const scanned = await scan(BigInt(0) as never, BigInt(0) as never);
  console.log("[umbra/payroll/claim] scanner result", {
    receivedCount: scanned.received.length,
    receivedAmounts: scanned.received.map((u) => String(u.amount)),
    publicReceivedCount: scanned.publicReceived?.length ?? 0,
    selfBurnableCount: scanned.selfBurnable?.length ?? 0,
    publicSelfBurnableCount: scanned.publicSelfBurnable?.length ?? 0,
    expectedAmount: input.note.amount,
    stealthAddress: stealth.publicKey.toBase58(),
    network: networkName(),
    indexerUrl:
      process.env.UMBRA_INDEXER_URL ??
      (networkName() === "mainnet-beta"
        ? "https://utxo-indexer.api.umbraprivacy.com"
        : "https://utxo-indexer.api-devnet.umbraprivacy.com"),
  });

  // A fresh stealth wallet only ever has one UTXO destined for it (the one
  // we created at issuance). Take the first received UTXO regardless of
  // exact amount — the on-chain amount may differ from the note amount by
  // Umbra's protocol fee.
  const matching: ScannedUtxoData[] = scanned.received;
  if (matching.length === 0) {
    throw new Error(
      "no claimable UTXO found for this link — receiver-claimable computation may not have finalized yet, or the indexer hasn't picked it up",
    );
  }

  // The IUmbraClient runtime exposes fetchBatchMerkleProof directly even
  // though the public d.ts hides it. Cast to bypass the missing type.
  const fetchBatchMerkleProof = (
    client as unknown as {
      fetchBatchMerkleProof: import("@umbra-privacy/sdk/interfaces").BatchMerkleProofFetcherFunction;
    }
  ).fetchBatchMerkleProof;

  // Claim into encrypted balance (relayer-paid).
  const claim = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
    { client },
    {
      fetchBatchMerkleProof,
      zkProver: claimUtxoProver(),
      relayer: umbraRelayer(),
    },
  );
  const claimResult = await claim(matching);

  // Withdraw wSOL from stealth's encrypted balance to stealth's own wSOL ATA.
  const withdraw =
    getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({ client });
  await withdraw(
    client.signer.address,
    WSOL_MINT_STR as never,
    BigInt(input.note.amount) as never,
  );

  // Unwrap stealth's wSOL → native SOL on the stealth wallet.
  await unwrapAllWsol(stealth);

  // Forward the stealth's SOL balance (minus a tiny dust buffer) to recipient.
  const { getSolBalance } = await import("./wsol");
  const stealthBal = await getSolBalance(stealth.publicKey);
  const sendAmount = stealthBal - 5_000; // leave 5k lamports for tx fee
  if (sendAmount <= 0) throw new Error("stealth wallet ended up empty");
  const sig = await transferSol(stealth, recipientPk, sendAmount);

  return {
    withdrawTxHash: sig,
    claimQueueSignature: getFirstClaimSig(claimResult),
  };
}

/** Recall = claim sent to the business wallet. */
export async function umbraPayrollRecall(
  note: UmbraNote,
  businessWallet: string,
): Promise<PayrollClaimResult> {
  return umbraPayrollClaim({ note, recipientAddress: businessWallet });
}

// ============================================================================
// helpers
// ============================================================================

function getFirstClaimSig(claimResult: unknown): string | undefined {
  // ClaimUtxoIntoEncryptedBalanceResult shape varies; keep this defensive.
  const r = claimResult as {
    results?: { queueSignature?: string }[];
    queueSignature?: string;
  };
  if (Array.isArray(r.results) && r.results.length > 0) {
    return r.results[0]?.queueSignature;
  }
  return r.queueSignature;
}

/**
 * Best-effort lookup of which escrow funded a given note's stealth wallet.
 *
 * The note doesn't carry the business wallet, so we can't directly derive
 * the escrow keypair on claim. For now we skip the gas top-up if we can't
 * identify the source — the stealth can use whatever SOL the issuance flow
 * left in it (Umbra's deposit mechanics seed the destination address with
 * rent). If that's insufficient, real Hoppy ops will add an explicit
 * `escrowHint` field to the note in the next iteration.
 */
function getEscrowKeypairFromNote(_note: UmbraNote): null {
  return null;
}

// Re-exports for the wsolAtaFor used elsewhere.
export { wsolAtaFor };
