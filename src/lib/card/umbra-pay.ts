/**
 * Card-flow Umbra orchestration (server-side only).
 *
 * The on-chain story this orchestration tells:
 *
 *   user wallet ─SOL─▶ per-order ESCROW
 *       (visible: user → escrow)
 *                     │
 *                     │  ESCROW wraps SOL → wSOL → encrypted balance
 *                     │  ESCROW creates a RECEIVER-CLAIMABLE UTXO destined
 *                     │  for a fresh STEALTH keypair. The UTXO's destination
 *                     │  is encrypted inside Umbra — observers can't tell
 *                     │  who it's for.
 *                     ▼
 *   relayer ─0.02 SOL─▶ STEALTH  (visible: relayer-funded gas, indistinguishable
 *                                 from any other relayer activity)
 *                     │
 *                     │  STEALTH registers, claims the UTXO into its own
 *                     │  encrypted balance, withdraws → wSOL ATA, unwraps
 *                     │  → native SOL.
 *                     ▼
 *   STEALTH ─SOL─▶ Bitrefill payout address (visible: stealth → merchant)
 *
 * The privacy primitive: ESCROW and STEALTH are signed by DIFFERENT keypairs,
 * with no on-chain SOL transfer between them. The only "link" is encrypted
 * inside the UTXO destination field. An observer can see {user → escrow}
 * and {stealth → bitrefill} but can't tell that the same order produced both.
 *
 * Per-order escrow + stealth keypairs are derived deterministically from
 * UMBRA_ESCROW_MASTER_KEY + orderId (lib/umbra/keys.ts) so refunds can
 * always re-derive both halves and sweep stranded funds.
 */

import {
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getClaimableUtxoScannerFunction,
  getUserRegistrationFunction,
} from "@umbra-privacy/sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
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
  umbraRelayer,
  registrationProver,
  createReceiverUtxoProver,
  claimReceiverIntoEncryptedProver,
  rpcUrl,
} from "@/lib/umbra/client";
import {
  getCardEscrowKeypair,
  getCardStealthKeypair,
} from "@/lib/umbra/keys";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";
import { updateOrder } from "@/lib/card/storage";

const WSOL_MINT_STR = WSOL_MINT.toBase58();

/** Tx fee reserve so the refund tx itself can pay for its own gas. */
const REFUND_FEE_RESERVE = 5_000;

/**
 * Lamport buffer kept on the ESCROW's NATIVE balance after the wrap step.
 * Has to cover (cumulatively, mid-tx, before any rent is recovered):
 *
 *   - wSOL ATA rent              ~2_039_280  (recovered on unwrap... if we unwrap)
 *   - Umbra deposit computation queue + proof account rent (~3-8M)
 *   - Umbra create-UTXO computation queue + proof account rent (~5-10M)
 *   - tx fees for ~5 ops at 5_000 each + priority surges
 *   - Solana's per-byte fee on loadedAccountsDataSize (~7MB loaded per Umbra op)
 *
 * The escrow's job in the new flow ends at "create receiver-claimable UTXO";
 * it doesn't unwrap or pay Bitrefill anymore. So slightly less burden than
 * the old direct-withdraw design, but the proof-account rents still apply.
 */
const ESCROW_TX_FEE_BUFFER = 35_000_000; // 0.035 SOL

/**
 * SOL the relayer sends to the per-order STEALTH so it can pay for its own
 * Umbra registration, claim, withdraw, unwrap, and final transfer to
 * Bitrefill. Whatever the stealth doesn't actually consume sweeps back to
 * the relayer at the end.
 *
 * Stealth needs: registration (~10M), wSOL ATA rent (~2M, recovered on
 * unwrap), claim proof rent (~5-8M), withdraw proof rent (~5-8M), tx fees
 * across ~6 ops, slop. Worst case totals ~28M — previous 25M budget had
 * zero headroom and was hitting 'insufficient funds for rent' simulation
 * failures on mainnet. Bumped to 40M to give ~12M cushion for proof-rent
 * rate changes or extra ZK-proof bytes.
 */
const STEALTH_FUND_BUDGET = 40_000_000; // 0.040 SOL

/**
 * Total overhead added to the user's deposit beyond bitrefillLamports.
 * Covers:
 *   - ESCROW_TX_FEE_BUFFER (kept on escrow native after wrap)             ~35M
 *   - Escrow Umbra registration cost (rent + tx)                          ~10M
 *   - Encrypted-balance fee headroom (~21bps × 2 ops, deposit + create)    ~3M
 *   - Slop / priority surges                                               ~2M
 *                                                                  total: ~50M
 *
 * Whatever the orchestration doesn't consume sweeps back to the user
 * automatically as part of the leftover-refund step.
 */
const UMBRA_FLOW_OVERHEAD = 55_000_000; // 0.055 SOL

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

// ============================================================================
// Helpers
// ============================================================================

function relayerKeypair(): Keypair {
  const key = process.env.HOPPY_RELAYER_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "HOPPY_RELAYER_PRIVATE_KEY env var required for the private card flow"
    );
  }
  return Keypair.fromSecretKey(bs58.decode(key));
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
      return;
    }
    console.warn(`[umbra-pay/${label}] registration error (continuing):`, msg);
  }
}

/**
 * Wait for an Umbra callback signature to be mined on-chain. Many SDK
 * functions return when the QUEUE tx confirms, but the actual effect of
 * the op (encrypted-balance update, UTXO availability) only lands when
 * the follow-up CALLBACK tx runs. Without explicitly waiting, the next
 * op races ahead and sees stale state.
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

/**
 * Wait for the indexer to surface a freshly-created UTXO to the receiver.
 * The on-chain UTXO is committed once its callback mines, but Umbra's
 * indexer can lag — sometimes a few seconds (mainnet), sometimes minutes
 * (devnet). Without this poll, the immediate stealth-side claim sees an
 * empty list and fails.
 *
 * Checks ALL UTXO buckets (received / publicReceived / selfBurnable /
 * publicSelfBurnable) in case the SDK reclassifies our encrypted-balance
 * receiver UTXO into a different bucket — defensive, costs nothing.
 */
async function waitForUtxoVisible(
  stealthClient: IUmbraClient,
  orderId: string,
  timeoutMs = 180_000
): Promise<unknown[]> {
  const scanner = getClaimableUtxoScannerFunction({ client: stealthClient });
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const result = (await scanner(
        BigInt(0) as never,
        BigInt(0) as never,
        BigInt(10000) as never
      )) as {
        received?: unknown[];
        publicReceived?: unknown[];
        selfBurnable?: unknown[];
        publicSelfBurnable?: unknown[];
      };
      // Receiver UTXOs from encrypted balance officially land in `received`,
      // but accept any bucket as a fallback in case the SDK reclassifies.
      const utxos =
        (result.received && result.received.length > 0 && result.received) ||
        (result.publicReceived && result.publicReceived.length > 0 && result.publicReceived) ||
        (result.selfBurnable && result.selfBurnable.length > 0 && result.selfBurnable) ||
        (result.publicSelfBurnable && result.publicSelfBurnable.length > 0 && result.publicSelfBurnable) ||
        null;

      if (utxos && Array.isArray(utxos) && utxos.length > 0) {
        console.log(`[umbra-pay/${orderId}][indexer] UTXO visible to stealth`, {
          attempts,
          count: utxos.length,
          buckets: {
            received: result.received?.length ?? 0,
            publicReceived: result.publicReceived?.length ?? 0,
            selfBurnable: result.selfBurnable?.length ?? 0,
            publicSelfBurnable: result.publicSelfBurnable?.length ?? 0,
          },
        });
        return utxos;
      }

      // Log every 6 attempts (~12s) so the polling progress shows up in logs
      // rather than the loop being silent for 3 minutes.
      if (attempts % 6 === 0) {
        console.log(`[umbra-pay/${orderId}][indexer] still waiting`, {
          attempts,
          elapsedMs: Date.now() - (deadline - timeoutMs),
          buckets: {
            received: result.received?.length ?? 0,
            publicReceived: result.publicReceived?.length ?? 0,
            selfBurnable: result.selfBurnable?.length ?? 0,
            publicSelfBurnable: result.publicSelfBurnable?.length ?? 0,
          },
        });
      }
    } catch (err) {
      console.warn(`[umbra-pay/${orderId}][indexer] scan error attempt ${attempts}`, err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Surface the indexer URL the client used so misconfigured envs are
  // immediately diagnosable from the error message.
  const indexerHint =
    process.env.UMBRA_INDEXER_URL ?? "(env unset; using network-default)";
  const networkHint = process.env.UMBRA_NETWORK ?? "(env unset; defaults to devnet)";
  throw new Error(
    `UTXO not visible to stealth indexer after ${timeoutMs}ms. ` +
      `Indexer=${indexerHint}, network=${networkHint}. ` +
      `If network is devnet, the indexer URL must end with "api-devnet.umbraprivacy.com". ` +
      `If they don't match, fix the Railway env vars and try again.`
  );
}

// ============================================================================
// Main orchestration
// ============================================================================

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
  bitrefillTxHash: string;
  refundLeftoverTxHash?: string;
  refundLeftoverLamports?: number;
}

/**
 * Run the full Umbra-mediated card payment flow with privacy via
 * receiver-claimable UTXO. Stages:
 *
 *   1. Confirm user → escrow deposit
 *   2. Register escrow with Umbra (idempotent)
 *   3. Wrap (delivered - txBuffer) SOL → wSOL on escrow
 *   4. Public → encrypted balance on escrow (Umbra deposit)
 *   5. Escrow creates a receiver-claimable UTXO destined for fresh stealth
 *   6. Relayer funds stealth with gas
 *   7. Register stealth with Umbra
 *   8. Stealth claims the UTXO into its own encrypted balance
 *   9. Stealth withdraws encrypted → wSOL ATA on stealth
 *  10. Stealth unwraps wSOL → native SOL
 *  11. Stealth transfers EXACTLY bitrefillLamports → Bitrefill address
 *  12. Sweep escrow leftover → user (auto-refund)
 *  13. Sweep stealth leftover → relayer (recover gas)
 *
 * Every stage updates the order status so the polling client can show a
 * meaningful progress timeline.
 */
export async function umbraCardExecute(
  input: UmbraCardExecuteInput
): Promise<UmbraCardExecuteResult> {
  const escrow = getCardEscrowKeypair(input.orderId);
  const escrowPk = escrow.publicKey;
  const stealth = getCardStealthKeypair(input.orderId);
  const stealthPk = stealth.publicKey;
  const userPk = new PublicKey(input.userAddress);
  const bitrefillPk = new PublicKey(input.bitrefillAddress);
  const relayer = relayerKeypair();
  const overallStart = Date.now();

  console.log(`[umbra-pay/${input.orderId}] start`, {
    escrow: escrowPk.toBase58(),
    stealth: stealthPk.toBase58(),
    user: input.userAddress,
    bitrefill: input.bitrefillAddress,
    bitrefillLamports: input.bitrefillLamports,
  });

  // 1. Confirm user → escrow deposit hit on-chain.
  await updateOrder(input.orderId, { status: "depositing" });
  const delivered = await confirmSolTransferTo(
    input.depositTxHash,
    escrowPk,
    Math.min(input.escrowLamports, input.bitrefillLamports + ESCROW_TX_FEE_BUFFER)
  );
  console.log(`[umbra-pay/${input.orderId}] deposit confirmed`, { delivered });

  // 2. Register escrow with Umbra (one-time).
  const escrowClient = await umbraClientFor(escrow);
  await ensureUmbraRegistered(escrowClient, `${input.orderId}/escrow`);

  // 3. Wrap most of the escrow's SOL to wSOL.
  const liveBalance = await getSolBalance(escrowPk);
  const wrappable = liveBalance - ESCROW_TX_FEE_BUFFER;
  if (wrappable < input.bitrefillLamports) {
    throw new Error(
      `escrow has ${wrappable} wrappable lamports (live ${liveBalance}, buffer ${ESCROW_TX_FEE_BUFFER}), need ≥ ${input.bitrefillLamports}`
    );
  }
  const { signature: wrapTxHash } = await wrapSol(escrow, wrappable);
  console.log(`[umbra-pay/${input.orderId}] wrap ok`, { wrapTxHash, wrappable });

  // 4. Deposit wSOL into escrow's encrypted balance.
  await updateOrder(input.orderId, { status: "mixing" });
  const depositToEncrypted = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({
    client: escrowClient,
  });
  const depositResult = (await depositToEncrypted(
    escrowClient.signer.address,
    WSOL_MINT_STR as never,
    BigInt(wrappable) as never
  )) as { queueSignature?: string; callbackSignature?: string };
  console.log(`[umbra-pay/${input.orderId}] umbra deposit queued`, depositResult);
  await waitForUmbraCallback(
    depositResult.callbackSignature,
    "deposit-callback",
    input.orderId,
    90_000
  );

  // 5. Fund stealth from relayer FIRST so it can pay for its own
  //    Umbra registration. The receiver MUST be registered before the
  //    escrow creates a UTXO destined for it — Umbra needs the
  //    receiver's on-chain viewing key to encrypt the UTXO. Otherwise
  //    create-UTXO fails with "Receiver is not registered".
  //
  //    The relayer-funded stealth is also what gives the on-chain
  //    privacy — observers see relayer → stealth (generic relayer
  //    activity, blends with all other relayer ops) instead of
  //    escrow → stealth (which would link the two ends).
  const conn = new Connection(rpcUrl(), "confirmed");

  // Fail fast if the relayer wallet itself doesn't have funds. Without
  // this check, the SystemProgram.transfer below dies with a cryptic
  // "Attempt to debit an account but found no record of a prior credit"
  // and the user can't tell what to fix.
  const relayerBalance = await conn.getBalance(relayer.publicKey, "confirmed");
  const relayerNeeds = STEALTH_FUND_BUDGET + 10_000;
  if (relayerBalance < relayerNeeds) {
    throw new Error(
      `Hoppy relayer wallet ${relayer.publicKey.toBase58()} has only ${relayerBalance} lamports — needs at least ${relayerNeeds}. ` +
        `Fund it: \`solana airdrop 1 ${relayer.publicKey.toBase58()} --url https://api.devnet.solana.com\` ` +
        `(or transfer SOL on mainnet).`
    );
  }

  {
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: relayer.publicKey,
        toPubkey: stealthPk,
        lamports: STEALTH_FUND_BUDGET,
      })
    );
    const sig = await sendAndConfirmTransaction(conn, fundTx, [relayer], {
      commitment: "confirmed",
    });
    console.log(`[umbra-pay/${input.orderId}] relayer funded stealth`, {
      lamports: STEALTH_FUND_BUDGET,
      relayerPubkey: relayer.publicKey.toBase58(),
      relayerBalanceBefore: relayerBalance,
      sig,
    });
  }

  // 6. Register stealth with Umbra. Must complete BEFORE step 7
  //    (create-UTXO) because Umbra encrypts the UTXO destination to
  //    the receiver's on-chain viewing key.
  const stealthClient = await umbraClientFor(stealth);
  await ensureUmbraRegistered(stealthClient, `${input.orderId}/stealth`);

  // 7. Escrow creates a RECEIVER-CLAIMABLE UTXO destined for the stealth.
  //    Size it slightly above bitrefillLamports so the downstream withdraw
  //    fee doesn't put us short. Anything left over stays in the stealth's
  //    encrypted balance after withdraw — small dust loss.
  const utxoAmount = Math.floor(input.bitrefillLamports * 1.005);
  if (utxoAmount > wrappable) {
    throw new Error(
      `UTXO amount ${utxoAmount} exceeds wrappable ${wrappable} — bug in deposit-amount math`
    );
  }
  const createUtxo = getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction(
    { client: escrowClient },
    { zkProver: createReceiverUtxoProver() }
  );
  const utxoResult = (await createUtxo({
    amount: BigInt(utxoAmount) as never,
    destinationAddress: stealthPk.toBase58() as never,
    mint: WSOL_MINT_STR as never,
  })) as { queueSignature?: string; callbackSignature?: string };
  console.log(`[umbra-pay/${input.orderId}] utxo created (encrypted destination)`, {
    utxoAmount,
    queue: utxoResult.queueSignature,
    callback: utxoResult.callbackSignature,
  });
  await waitForUmbraCallback(
    utxoResult.callbackSignature,
    "utxo-callback",
    input.orderId,
    120_000
  );

  // 8. Stealth claims the UTXO into its encrypted balance.
  await updateOrder(input.orderId, { status: "withdrawing" });
  const utxos = await waitForUtxoVisible(stealthClient, input.orderId, 90_000);
  const fetchBatchMerkleProof = (
    stealthClient as unknown as { fetchBatchMerkleProof?: unknown }
  ).fetchBatchMerkleProof;
  const claimFn = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
    { client: stealthClient },
    {
      zkProver: claimReceiverIntoEncryptedProver(),
      relayer: umbraRelayer(),
      fetchBatchMerkleProof: fetchBatchMerkleProof as never,
    }
  );
  const claimResult = (await claimFn(utxos as never)) as {
    queueSignature?: string;
    callbackSignature?: string;
  };
  console.log(`[umbra-pay/${input.orderId}] stealth claimed UTXO`, claimResult);
  await waitForUmbraCallback(
    claimResult.callbackSignature,
    "claim-callback",
    input.orderId,
    90_000
  );

  // 9. Stealth withdraws bitrefillLamports from encrypted → wSOL ATA on stealth.
  const stealthWithdraw = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({
    client: stealthClient,
  });
  const withdrawResult = (await stealthWithdraw(
    stealthPk.toBase58() as never,
    WSOL_MINT_STR as never,
    BigInt(input.bitrefillLamports) as never
  )) as { queueSignature?: string; callbackSignature?: string };
  console.log(`[umbra-pay/${input.orderId}] stealth withdraw queued`, withdrawResult);
  await waitForUmbraCallback(
    withdrawResult.callbackSignature,
    "withdraw-callback",
    input.orderId,
    90_000
  );

  // 10. Unwrap stealth's wSOL → native SOL.
  const unwrap = await unwrapAllWsol(stealth);
  console.log(`[umbra-pay/${input.orderId}] stealth unwrapped`, { sig: unwrap.signature });

  // 11. Stealth transfers EXACTLY bitrefillLamports → Bitrefill.
  await updateOrder(input.orderId, { status: "paying" });
  const bitrefillTxHash = await transferSol(stealth, bitrefillPk, input.bitrefillLamports);
  console.log(`[umbra-pay/${input.orderId}] stealth → bitrefill`, { bitrefillTxHash });

  // 12. Sweep escrow leftover SOL → user.
  let refundLeftoverTxHash: string | undefined;
  let refundLeftoverLamports: number | undefined;
  try {
    const remaining = await getSolBalance(escrowPk);
    const sweepable = Math.max(0, remaining - REFUND_FEE_RESERVE);
    if (sweepable > 0) {
      refundLeftoverTxHash = await transferSol(escrow, userPk, sweepable);
      refundLeftoverLamports = sweepable;
      console.log(`[umbra-pay/${input.orderId}] swept escrow leftover → user`, {
        sweepable,
        sig: refundLeftoverTxHash,
      });
    }
  } catch (err) {
    console.warn(`[umbra-pay/${input.orderId}] escrow leftover sweep failed:`, err);
  }

  // 13. Sweep stealth leftover SOL → relayer (recover gas).
  try {
    const stealthLeft = await getSolBalance(stealthPk);
    const stealthSweep = Math.max(0, stealthLeft - REFUND_FEE_RESERVE);
    if (stealthSweep > 0) {
      const sig = await transferSol(stealth, relayer.publicKey, stealthSweep);
      console.log(`[umbra-pay/${input.orderId}] swept stealth leftover → relayer`, {
        stealthSweep,
        sig,
      });
    }
  } catch (err) {
    console.warn(`[umbra-pay/${input.orderId}] stealth leftover sweep failed:`, err);
  }

  await updateOrder(input.orderId, {
    status: "paid",
    depositTxHash: input.depositTxHash,
    withdrawTxHash: bitrefillTxHash,
    refundTxHash: refundLeftoverTxHash,
  });

  console.log(`[umbra-pay/${input.orderId}] complete`, {
    totalElapsedMs: Date.now() - overallStart,
    bitrefillTxHash,
    refundLeftoverLamports,
  });

  return {
    depositConfirmedLamports: delivered,
    bitrefillTxHash,
    refundLeftoverTxHash,
    refundLeftoverLamports,
  };
}

// ============================================================================
// Refund — drain escrow + stealth back to user
// ============================================================================

export interface CardRefundResult {
  encryptedWithdrawn: number;
  unwrapTxHash?: string;
  refundTxHash?: string;
  nativeRefunded: number;
  /** True if there were no funds to refund — endpoint returns this so callers
   *  can distinguish "already drained" from "actually moved money". */
  noop: boolean;
}

async function drainAccountToUser(
  account: Keypair,
  userPk: PublicKey,
  orderId: string,
  label: string
): Promise<{ encryptedWithdrawn: number; unwrapTx?: string; refundTx?: string; refunded: number }> {
  const out = { encryptedWithdrawn: 0, unwrapTx: undefined as string | undefined, refundTx: undefined as string | undefined, refunded: 0 };

  // 1. Withdraw any encrypted balance back to public wSOL ATA.
  try {
    const client = await umbraClientFor(account);
    const querier = client as unknown as {
      getEncryptedBalance?: (mint: string) => Promise<bigint>;
    };
    let encryptedBal = BigInt(0);
    if (typeof querier.getEncryptedBalance === "function") {
      try {
        encryptedBal = await querier.getEncryptedBalance(WSOL_MINT_STR);
      } catch {
        /* ignore — may not be registered */
      }
    }
    if (encryptedBal > BigInt(0)) {
      const withdrawFn = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({
        client,
      });
      await withdrawFn(
        account.publicKey.toBase58() as never,
        WSOL_MINT_STR as never,
        encryptedBal as never
      );
      out.encryptedWithdrawn = Number(encryptedBal);
    }
  } catch (err) {
    console.warn(`[card-refund/${orderId}/${label}] encrypted withdraw failed:`, err);
  }

  // 2. Unwrap any wSOL → native SOL.
  try {
    const u = await unwrapAllWsol(account);
    if (u.signature) out.unwrapTx = u.signature;
  } catch (err) {
    console.warn(`[card-refund/${orderId}/${label}] unwrap failed:`, err);
  }

  // 3. Sweep native SOL → user.
  const nativeBal = await getSolBalance(account.publicKey);
  const sweepable = Math.max(0, nativeBal - REFUND_FEE_RESERVE);
  if (sweepable > 0) {
    const sig = await transferSol(account, userPk, sweepable);
    out.refundTx = sig;
    out.refunded = sweepable;
  }

  return out;
}

/**
 * Drain BOTH the per-order escrow AND the per-order stealth back to the
 * user. Either may have stranded funds depending on where in the flow it
 * failed:
 *
 *   - Failed before UTXO created → only escrow has funds
 *   - Failed before stealth claim → escrow + stealth (relayer-funded portion)
 *   - Failed after stealth claim, before pay → stealth has bulk, escrow has dust
 *   - Failed after pay (rare) → both should be near-empty
 *
 * Idempotent: returns noop=true if both accounts are already drained.
 */
export async function umbraCardRefund(
  orderId: string,
  userAddress: string
): Promise<CardRefundResult> {
  const escrow = getCardEscrowKeypair(orderId);
  const stealth = getCardStealthKeypair(orderId);
  const userPk = new PublicKey(userAddress);

  const escrowResult = await drainAccountToUser(escrow, userPk, orderId, "escrow");
  const stealthResult = await drainAccountToUser(stealth, userPk, orderId, "stealth");

  const totalEncrypted = escrowResult.encryptedWithdrawn + stealthResult.encryptedWithdrawn;
  const totalRefunded = escrowResult.refunded + stealthResult.refunded;
  const refundTxHash = escrowResult.refundTx ?? stealthResult.refundTx;
  const unwrapTxHash = escrowResult.unwrapTx ?? stealthResult.unwrapTx;

  return {
    encryptedWithdrawn: totalEncrypted,
    nativeRefunded: totalRefunded,
    refundTxHash,
    unwrapTxHash,
    noop: totalRefunded === 0 && totalEncrypted === 0,
  };
}

/**
 * Inspect what's recoverable across the per-order escrow and stealth.
 * Used by the admin / debug UI.
 */
export async function umbraCardEscrowBalances(orderId: string): Promise<{
  escrowAddress: string;
  stealthAddress: string;
  escrowNativeLamports: number;
  stealthNativeLamports: number;
  escrowEncryptedLamports: number;
  stealthEncryptedLamports: number;
}> {
  const escrow = getCardEscrowKeypair(orderId);
  const stealth = getCardStealthKeypair(orderId);

  const [escrowNative, stealthNative] = await Promise.all([
    getSolBalance(escrow.publicKey),
    getSolBalance(stealth.publicKey),
  ]);

  let escrowEncrypted = 0;
  let stealthEncrypted = 0;
  try {
    const c = await umbraClientFor(escrow);
    const q = c as unknown as { getEncryptedBalance?: (m: string) => Promise<bigint> };
    if (typeof q.getEncryptedBalance === "function") {
      escrowEncrypted = Number(await q.getEncryptedBalance(WSOL_MINT_STR));
    }
  } catch { /* ignore */ }
  try {
    const c = await umbraClientFor(stealth);
    const q = c as unknown as { getEncryptedBalance?: (m: string) => Promise<bigint> };
    if (typeof q.getEncryptedBalance === "function") {
      stealthEncrypted = Number(await q.getEncryptedBalance(WSOL_MINT_STR));
    }
  } catch { /* ignore */ }

  return {
    escrowAddress: escrow.publicKey.toBase58(),
    stealthAddress: stealth.publicKey.toBase58(),
    escrowNativeLamports: escrowNative,
    stealthNativeLamports: stealthNative,
    escrowEncryptedLamports: escrowEncrypted,
    stealthEncryptedLamports: stealthEncrypted,
  };
}
