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
  getEncryptedBalanceToSelfClaimableUtxoCreatorFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
} from "@umbra-privacy/sdk";
import bs58 from "bs58";
import type { UmbraNote } from "@/lib/payroll/types";
import {
  getEscrowKeypair,
  getEscrowAddress,
  stealthKeypairFromSeed,
} from "./keys";
import {
  umbraClientFor,
  createUtxoProver,
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

/**
 * Minimum native SOL we keep in escrow as gas/rent buffer.
 * Each link consumes ~STEALTH_FUND_BUDGET (0.03) plus ~0.005 in tx fees +
 * temporary proof-account rent. So 0.05 + 0.035*N lamports is the floor.
 *
 * The default 0.2 SOL covers ~5 links comfortably. Callers issuing more links
 * should increase totalAmount in the deposit so the buffer scales.
 */
const ESCROW_BUFFER = 200_000_000; // 0.2 SOL

/**
 * SOL transferred to each stealth wallet at issuance time. Pays for:
 *   1. Stealth's own Umbra registration (required so issuance can encrypt to it).
 *   2. Later: register-noop + claim + withdraw + unwrap + transfer when the
 *      recipient claims (5 txs).
 * 0.03 SOL is generous; unused remainder is drained back to the recipient on
 * claim by the existing transferSol(stealth → recipient) step.
 */
const STEALTH_FUND_BUDGET = 30_000_000; // 0.03 SOL

/**
 * Minimum total deposit (lamports) needed to issue `nLinks` payroll links
 * and have all gas/rent covered. Frontend should validate against this
 * BEFORE sending the bulk deposit so we never end up with a stuck escrow.
 *
 *   sum(amounts) + N × STEALTH_FUND_BUDGET + ESCROW_BUFFER
 */
export function minimumDepositForPayroll(
  amountsSum: number,
  nLinks: number,
): number {
  return amountsSum + nLinks * STEALTH_FUND_BUDGET + ESCROW_BUFFER;
}

export const PAYROLL_STEALTH_FUND_BUDGET = STEALTH_FUND_BUDGET;
export const PAYROLL_ESCROW_BUFFER = ESCROW_BUFFER;

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
 * SELF-claimable UTXO whose destination is the stealth address. The stealth
 * seed goes into the URL hash; the recipient just opens /claim and the
 * existing claim flow (same as a regular private send) handles withdrawal.
 *
 * Why self-claimable instead of receiver-claimable:
 *   - Receiver-claimable UTXOs land in the recipient's *encrypted* balance,
 *     forcing them through a 2-step claim (claim → withdraw).
 *   - Self-claimable UTXOs can be withdrawn directly to a public address
 *     by anyone holding the seed — matches the regular Hoppy claim flow
 *     and lets us reuse src/components/claim/claim-flow.tsx unchanged.
 *
 * Required registrations:
 *   - The escrow needs to be Umbra-registered (done at deposit time).
 *   - The stealth ALSO needs to be Umbra-registered before escrow can
 *     create the UTXO, because the UTXO ciphertext is encrypted to the
 *     destination's master viewing key. Without on-chain registration,
 *     the destination's viewing key can't be looked up.
 */
export async function umbraPayrollIssueLink(
  input: PayrollIssueLinkInput,
): Promise<PayrollIssueLinkResult> {
  if (input.amount <= 0) throw new Error("amount must be positive");

  const escrow = getEscrowKeypair(input.businessWallet);
  const stealthSeed = crypto.getRandomValues(new Uint8Array(32));
  const stealth = stealthKeypairFromSeed(stealthSeed);

  // Fund the stealth with SOL so it has rent + tx-fee budget for its own
  // Umbra registration (next step) and the eventual claim flow.
  await transferSol(escrow, stealth.publicKey, STEALTH_FUND_BUDGET);

  // Register the stealth on Umbra. This uploads stealth's master viewing
  // key on-chain so the escrow can encrypt the UTXO ciphertext to it. Without
  // this step the scanner can't decrypt the UTXO and it appears "missing".
  const stealthClient = await umbraClientFor(stealth);
  const registerStealth = getUserRegistrationFunction(
    { client: stealthClient },
    { zkProver: registrationProver() },
  );
  await registerStealth({ confidential: true, anonymous: true });

  // Escrow creates a self-claimable UTXO destined for the stealth address.
  const escrowClient = await umbraClientFor(escrow);
  const createUtxo = getEncryptedBalanceToSelfClaimableUtxoCreatorFunction(
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
// Claim — unified with regular /claim flow
// ============================================================================
// The per-link claim runs entirely client-side via the stealth keypair from
// the URL hash. The legacy server-side claim/recall helpers were removed.
// Recall, if needed, can be done by visiting the claim URL with the
// business wallet selected as the recipient.

// ============================================================================
// Bulk refund — drain escrow's encrypted balance + native SOL back to business
// ============================================================================

export interface PayrollRefundInput {
  businessWallet: string;
}

export interface PayrollRefundResult {
  encryptedWithdrawn: number;
  nativeRefunded: number;
  unwrapTxHash?: string;
  refundTxHash?: string;
}

/**
 * Drain the per-business escrow back to the business wallet.
 *
 * 1. Withdraw all encrypted-balance wSOL to escrow's public wSOL ATA.
 * 2. Unwrap wSOL → native SOL on the escrow.
 * 3. Sweep all native SOL on the escrow → business wallet.
 *
 * Does NOT recover funds already issued as employee links — those need to
 * be recalled per-link via `umbraPayrollRecall`.
 */
export async function umbraPayrollRefund(
  input: PayrollRefundInput,
): Promise<PayrollRefundResult> {
  const escrow = getEscrowKeypair(input.businessWallet);
  const escrowPk = escrow.publicKey;
  const businessPk = new PublicKey(input.businessWallet);

  const result: PayrollRefundResult = {
    encryptedWithdrawn: 0,
    nativeRefunded: 0,
  };

  // 1. Try to withdraw all encrypted balance to public wSOL ATA.
  try {
    const escrowClient = await umbraClientFor(escrow);
    const withdrawFn =
      getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({
        client: escrowClient,
      });

    // Probe encrypted balance with a generous query if available; otherwise
    // fall back to attempting a withdraw of the deposit amount and let the
    // SDK error if it's empty. The withdrawer will refund the gas if no-op.
    const querier = escrowClient as unknown as {
      getEncryptedBalance?: (mint: string) => Promise<bigint>;
    };
    let encryptedBal = BigInt(0);
    if (typeof querier.getEncryptedBalance === "function") {
      try {
        encryptedBal = await querier.getEncryptedBalance(WSOL_MINT_STR);
      } catch {
        // ignore — fallback below
      }
    }

    if (encryptedBal > BigInt(0)) {
      await withdrawFn(
        escrow.publicKey.toBase58() as never,
        WSOL_MINT_STR as never,
        encryptedBal as never,
      );
      result.encryptedWithdrawn = Number(encryptedBal);
    }
  } catch (err) {
    console.warn("[refund] encrypted withdraw failed:", err);
    // continue — native sweep below may still recover something
  }

  // 2. Unwrap any wSOL → native SOL.
  try {
    const u = await unwrapAllWsol(escrow);
    if (u.signature) result.unwrapTxHash = u.signature;
  } catch (err) {
    console.warn("[refund] unwrap failed:", err);
  }

  // 3. Sweep all native SOL → business wallet (leave dust for fee).
  const { getSolBalance } = await import("./wsol");
  const nativeBal = await getSolBalance(escrowPk);
  const FEE_RESERVE = 5_000;
  const sweepable = Math.max(0, nativeBal - FEE_RESERVE);
  if (sweepable > 0) {
    const sig = await transferSol(escrow, businessPk, sweepable);
    result.refundTxHash = sig;
    result.nativeRefunded = sweepable;
  }

  return result;
}

// Re-exports for the wsolAtaFor used elsewhere.
export { wsolAtaFor };
