/**
 * Card-flow Umbra orchestration (server-side only).
 *
 * Mirrors the payroll adapter's pattern but for the card-buying flow:
 *
 *   user wallet  ──SOL──▶  per-order escrow  ──Umbra mix──▶  Bitrefill
 *
 * The escrow keypair is derived from UMBRA_ESCROW_MASTER_KEY + the orderId
 * (see lib/umbra/keys.ts), so we can always re-derive it during refund and
 * never need to persist a secret. Each order gets its own escrow so a stuck
 * order can't strand other users' funds.
 *
 * Refund is the safety net: at any point before the SOL leaves the escrow
 * for Bitrefill, the user can recover their funds. After Bitrefill is paid,
 * recovery has to go through Bitrefill support.
 */

import {
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getUserRegistrationFunction,
} from "@umbra-privacy/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  WSOL_MINT,
  wrapSol,
  unwrapAllWsol,
  transferSol,
  getSolBalance,
  confirmSolTransferTo,
} from "@/lib/umbra/wsol";
import {
  umbraClientFor,
  registrationProver,
  rpcUrl,
} from "@/lib/umbra/client";
import { getCardEscrowKeypair } from "@/lib/umbra/keys";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";
import { updateOrder } from "@/lib/card/storage";

const WSOL_MINT_STR = WSOL_MINT.toBase58();

/** Tx fee reserve so the refund tx itself can pay for its own gas. */
const REFUND_FEE_RESERVE = 5_000;

/**
 * Lamport buffer kept on the escrow's NATIVE balance after the wrap step.
 * Covers:
 *   - wSOL ATA rent (~2_039_280) recovered when ATA closes during unwrap,
 *     but "in flight" mid-tx so balance must cover it
 *   - tx fees for the remaining ops (~6 × 5_000 lamports baseline + priority)
 *   - Umbra ZK proof account rent / occasional surprises
 *
 * 0.01 SOL with comfortable headroom. Unused remainder refunds to user.
 */
const ESCROW_TX_FEE_BUFFER = 10_000_000; // 0.01 SOL

/**
 * Total overhead added to the user's deposit beyond bitrefillLamports.
 * Covers:
 *   - ESCROW_TX_FEE_BUFFER (kept on native balance after wrap)            ~10M
 *   - Umbra registration cost (rent for the registration account + tx)    ~10M
 *   - Umbra fee headroom (encrypted-balance op fees, ~21bps)               ~2M
 *   - Slop / priority surges                                               ~3M
 *                                                                  total: ~25M
 *
 * Whatever the orchestration doesn't actually consume gets swept back to
 * the user at the end as part of step 8 (refund leftover).
 */
const UMBRA_FLOW_OVERHEAD = 25_000_000; // 0.025 SOL

/**
 * Minimum / maximum jitter on top of UMBRA_FLOW_OVERHEAD. Adds randomness so
 * the deposit amount doesn't equal a recognizable card-price denomination —
 * observers shouldn't be able to fingerprint "user X deposited $25's worth
 * of SOL" by the exact lamports value.
 */
const MIN_OVERSHOOT_LAMPORTS = 2_000_000; // 0.002 SOL
const MAX_OVERSHOOT_LAMPORTS = 6_000_000; // 0.006 SOL

/**
 * Compute the deposit lamports the user must send to the per-order escrow.
 *
 *   bitrefillLamports + UMBRA_FLOW_OVERHEAD + jitter
 *
 * Leftover funds (whatever the orchestration doesn't consume) refund back
 * to the user automatically once Bitrefill is paid.
 */
export function computeDepositLamports(bitrefillLamports: number): number {
  const jitterRange = MAX_OVERSHOOT_LAMPORTS - MIN_OVERSHOOT_LAMPORTS;
  const jitter = MIN_OVERSHOOT_LAMPORTS + Math.floor(Math.random() * jitterRange);
  return bitrefillLamports + UMBRA_FLOW_OVERHEAD + jitter;
}

async function ensureUmbraRegistered(
  client: IUmbraClient,
  label: string
): Promise<void> {
  try {
    const register = getUserRegistrationFunction(
      { client },
      { zkProver: registrationProver() }
    );
    await register({ confidential: true, anonymous: true });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (
      msg.includes("already") ||
      msg.includes("AlreadyCallbacked") ||
      msg.includes("custom program error: #1")
    ) {
      // Already registered; fine.
      return;
    }
    console.warn(`[umbra-pay/${label}] registration error (continuing):`, msg);
  }
}

/**
 * Wait for an Umbra callback signature to be mined on-chain. Many Umbra
 * SDK functions return as soon as the QUEUE tx is confirmed, but the
 * actual effect of the op (e.g. crediting encrypted balance) doesn't
 * land until the follow-up CALLBACK tx runs. Without explicitly waiting
 * for the callback, the next op in our pipeline races ahead and sees
 * stale state — encrypted balance still 0, withdraws fail, etc.
 */
async function waitForUmbraCallback(
  signature: string | undefined,
  label: string,
  orderId: string,
  timeoutMs = 90_000
): Promise<void> {
  if (!signature) {
    console.warn(`[umbra-pay/${orderId}][${label}] no callback signature returned`);
    return;
  }
  const conn = new Connection(rpcUrl(), "confirmed");
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const start = Date.now();

  const result = (await Promise.race([
    conn.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    ),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} callback timed out after ${timeoutMs}ms (sig=${signature})`)),
        timeoutMs
      )
    ),
  ])) as { value: { err: unknown } };

  if (result.value.err) {
    throw new Error(
      `${label} callback failed: ${JSON.stringify(result.value.err)} (sig=${signature})`
    );
  }
  console.log(`[umbra-pay/${orderId}][${label}] callback confirmed`, {
    signature,
    elapsedMs: Date.now() - start,
  });
}

export interface UmbraCardExecuteInput {
  orderId: string;
  /** Lamports the escrow received from the user (returned by deposit confirm). */
  escrowLamports: number;
  /** Exact lamports we owe Bitrefill. */
  bitrefillLamports: number;
  /** Bitrefill's payout address (receives the final SOL transfer). */
  bitrefillAddress: string;
  /** User wallet — leftover funds refund here automatically. */
  userAddress: string;
  /** Tx hash of the user → escrow deposit (for confirmation). */
  depositTxHash: string;
}

export interface UmbraCardExecuteResult {
  depositConfirmedLamports: number;
  wrapTxHash: string;
  bitrefillTxHash: string;
  refundLeftoverTxHash?: string;
  refundLeftoverLamports?: number;
}

/**
 * Run the full Umbra-mediated card payment flow.
 *
 *   1. Confirm user → escrow deposit
 *   2. Register escrow with Umbra (idempotent)
 *   3. Wrap (depositLamports - txBuffer) SOL → wSOL on escrow
 *   4. Public balance → encrypted balance (Umbra deposit)
 *   5. Encrypted balance → public balance (Umbra withdraw, exactly bitrefillLamports
 *      worth, but as wSOL on the escrow's ATA)
 *   6. Unwrap that wSOL back to native SOL on escrow
 *   7. Transfer EXACTLY bitrefillLamports to Bitrefill's address
 *   8. Sweep any remaining SOL on the escrow back to the user (auto-refund leftover)
 *
 * Each step also calls updateOrder() with a status checkpoint so the UI's
 * polling endpoint can show meaningful progress messages. Failures at any
 * step leave funds in the escrow — caller can trigger /api/card/refund to
 * recover them.
 */
export async function umbraCardExecute(
  input: UmbraCardExecuteInput
): Promise<UmbraCardExecuteResult> {
  const escrow = getCardEscrowKeypair(input.orderId);
  const escrowPk = escrow.publicKey;
  const userPk = new PublicKey(input.userAddress);
  const bitrefillPk = new PublicKey(input.bitrefillAddress);

  console.log(`[umbra-pay/${input.orderId}] start`, {
    escrow: escrowPk.toBase58(),
    user: input.userAddress,
    bitrefill: input.bitrefillAddress,
    bitrefillLamports: input.bitrefillLamports,
    escrowLamports: input.escrowLamports,
  });

  // 1. Confirm the user's deposit hit the escrow with the expected amount.
  await updateOrder(input.orderId, { status: "depositing" });
  const delivered = await confirmSolTransferTo(
    input.depositTxHash,
    escrowPk,
    Math.min(input.escrowLamports, input.bitrefillLamports + ESCROW_TX_FEE_BUFFER)
  );
  console.log(`[umbra-pay/${input.orderId}] deposit confirmed`, { delivered });

  // 2. Register escrow with Umbra (one-time, idempotent).
  const client = await umbraClientFor(escrow);
  await ensureUmbraRegistered(client, input.orderId);

  // 3. Read the LIVE escrow balance (not the deposited amount — it may have
  //    been touched by registration tx fees) and wrap most of it. Keep at
  //    least ESCROW_TX_FEE_BUFFER as native SOL on the escrow to cover
  //    ATA rent + tx fees for the rest of the flow.
  const liveBalance = await getSolBalance(escrowPk);
  const wrappable = liveBalance - ESCROW_TX_FEE_BUFFER;
  if (wrappable < input.bitrefillLamports) {
    throw new Error(
      `escrow has ${wrappable} wrappable lamports (live balance ${liveBalance}, buffer ${ESCROW_TX_FEE_BUFFER}), ` +
        `need ≥ ${input.bitrefillLamports}`
    );
  }
  const { signature: wrapTxHash } = await wrapSol(escrow, wrappable);
  console.log(`[umbra-pay/${input.orderId}] wrap ok`, {
    wrapTxHash,
    wrappable,
    liveBalanceBeforeWrap: liveBalance,
  });

  // 4. Deposit the wSOL into encrypted balance. CRITICAL: the SDK returns
  //    when the queue tx mines, but the actual encrypted-balance credit
  //    happens via a follow-up callback tx. We MUST wait for that callback
  //    before withdrawing, otherwise the withdraw sees a 0 balance and
  //    fails with Umbra error 7050031.
  await updateOrder(input.orderId, { status: "mixing" });
  const depositToEncrypted = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({
    client,
  });
  const depositResult = (await depositToEncrypted(
    client.signer.address,
    WSOL_MINT_STR as never,
    BigInt(wrappable) as never
  )) as { queueSignature?: string; callbackSignature?: string };
  console.log(`[umbra-pay/${input.orderId}] umbra deposit queued`, {
    queue: depositResult.queueSignature,
    callback: depositResult.callbackSignature,
  });
  await waitForUmbraCallback(
    depositResult.callbackSignature,
    "deposit-callback",
    input.orderId,
    90_000
  );

  // 5. Withdraw bitrefillLamports from encrypted balance to escrow's wSOL ATA.
  //    Same callback-wait pattern: the queue tx returns fast but the wSOL
  //    only lands in the ATA after the callback runs.
  await updateOrder(input.orderId, { status: "withdrawing" });
  const withdraw = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({
    client,
  });
  const withdrawResult = (await withdraw(
    escrowPk.toBase58() as never,
    WSOL_MINT_STR as never,
    BigInt(input.bitrefillLamports) as never
  )) as { queueSignature?: string; callbackSignature?: string };
  console.log(`[umbra-pay/${input.orderId}] umbra withdraw queued`, {
    queue: withdrawResult.queueSignature,
    callback: withdrawResult.callbackSignature,
  });
  await waitForUmbraCallback(
    withdrawResult.callbackSignature,
    "withdraw-callback",
    input.orderId,
    90_000
  );

  // 6. Unwrap wSOL → native SOL on the escrow. The unwrap closes the ATA and
  //    moves the entire wSOL balance back to the escrow's main wallet.
  const unwrap = await unwrapAllWsol(escrow);
  console.log(`[umbra-pay/${input.orderId}] unwrap ok`, { sig: unwrap.signature });

  // 7. Transfer EXACTLY bitrefillLamports to Bitrefill's address.
  await updateOrder(input.orderId, { status: "paying" });
  const bitrefillTxHash = await transferSol(escrow, bitrefillPk, input.bitrefillLamports);
  console.log(`[umbra-pay/${input.orderId}] paid bitrefill`, { bitrefillTxHash });

  // 8. Sweep leftover SOL back to the user (auto-refund).
  let refundLeftoverTxHash: string | undefined;
  let refundLeftoverLamports: number | undefined;
  try {
    const remaining = await getSolBalance(escrowPk);
    const sweepable = Math.max(0, remaining - REFUND_FEE_RESERVE);
    if (sweepable > 0) {
      refundLeftoverTxHash = await transferSol(escrow, userPk, sweepable);
      refundLeftoverLamports = sweepable;
      console.log(`[umbra-pay/${input.orderId}] swept leftover to user`, {
        sweepable,
        refundLeftoverTxHash,
      });
    }
  } catch (err) {
    // Don't fail the whole orchestration if leftover sweep fails — Bitrefill
    // is paid, the order will fulfill normally. User can manually call
    // /api/card/refund later.
    console.warn(`[umbra-pay/${input.orderId}] leftover sweep failed:`, err);
  }

  await updateOrder(input.orderId, {
    status: "paid",
    depositTxHash: input.depositTxHash,
    withdrawTxHash: bitrefillTxHash,
    refundTxHash: refundLeftoverTxHash,
  });

  return {
    depositConfirmedLamports: delivered,
    wrapTxHash,
    bitrefillTxHash,
    refundLeftoverTxHash,
    refundLeftoverLamports,
  };
}

export interface CardRefundResult {
  encryptedWithdrawn: number;
  unwrapTxHash?: string;
  refundTxHash?: string;
  nativeRefunded: number;
  /** True if there were no funds to refund — endpoint returns this so callers
   *  can distinguish "already drained" from "actually moved money". */
  noop: boolean;
}

/**
 * Drain the per-order card escrow back to the user's address.
 *
 *   1. If encrypted balance > 0, withdraw it to the escrow's public wSOL ATA.
 *   2. Unwrap any wSOL on the escrow → native SOL.
 *   3. Sweep all native SOL on the escrow → user's address (minus fee reserve).
 *
 * Idempotent: safe to call repeatedly. If the escrow is already empty,
 * returns { noop: true } without erroring.
 *
 * Caller must verify the user is authorized to refund THIS order before
 * calling — typically by checking the order's stored `userAddress` matches
 * the address requesting the refund.
 */
export async function umbraCardRefund(
  orderId: string,
  userAddress: string,
): Promise<CardRefundResult> {
  const escrow = getCardEscrowKeypair(orderId);
  const userPk = new PublicKey(userAddress);

  const result: CardRefundResult = {
    encryptedWithdrawn: 0,
    nativeRefunded: 0,
    noop: false,
  };

  // 1. Withdraw any encrypted balance back to escrow's public wSOL ATA.
  try {
    const escrowClient = await umbraClientFor(escrow);
    const querier = escrowClient as unknown as {
      getEncryptedBalance?: (mint: string) => Promise<bigint>;
    };
    let encryptedBal = BigInt(0);
    if (typeof querier.getEncryptedBalance === "function") {
      try {
        encryptedBal = await querier.getEncryptedBalance(WSOL_MINT_STR);
      } catch {
        // ignore — we'll fall through to native sweep
      }
    }

    if (encryptedBal > BigInt(0)) {
      const withdrawFn = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({
        client: escrowClient,
      });
      await withdrawFn(
        escrow.publicKey.toBase58() as never,
        WSOL_MINT_STR as never,
        encryptedBal as never,
      );
      result.encryptedWithdrawn = Number(encryptedBal);
    }
  } catch (err) {
    console.warn(`[card-refund/${orderId}] encrypted withdraw failed:`, err);
    // continue — native sweep below may still recover something
  }

  // 2. Unwrap wSOL → native SOL.
  try {
    const u = await unwrapAllWsol(escrow);
    if (u.signature) result.unwrapTxHash = u.signature;
  } catch (err) {
    console.warn(`[card-refund/${orderId}] unwrap failed:`, err);
  }

  // 3. Sweep native SOL → user address.
  const nativeBal = await getSolBalance(escrow.publicKey);
  const sweepable = Math.max(0, nativeBal - REFUND_FEE_RESERVE);
  if (sweepable > 0) {
    const sig = await transferSol(escrow, userPk, sweepable);
    result.refundTxHash = sig;
    result.nativeRefunded = sweepable;
  } else if (result.encryptedWithdrawn === 0) {
    result.noop = true;
  }

  return result;
}

/**
 * Quick helper to inspect what's recoverable from a stuck escrow.
 * Useful for an admin "show me orphan funds" dashboard view.
 */
export async function umbraCardEscrowBalances(orderId: string): Promise<{
  address: string;
  nativeLamports: number;
  encryptedLamports: number;
}> {
  const escrow = getCardEscrowKeypair(orderId);
  const nativeLamports = await getSolBalance(escrow.publicKey);

  let encryptedLamports = 0;
  try {
    const client = await umbraClientFor(escrow);
    const querier = client as unknown as {
      getEncryptedBalance?: (mint: string) => Promise<bigint>;
    };
    if (typeof querier.getEncryptedBalance === "function") {
      const bal = await querier.getEncryptedBalance(WSOL_MINT_STR);
      encryptedLamports = Number(bal);
    }
  } catch {
    // ignore — fresh escrows have no Umbra registration; that's fine
  }

  return {
    address: escrow.publicKey.toBase58(),
    nativeLamports,
    encryptedLamports,
  };
}
