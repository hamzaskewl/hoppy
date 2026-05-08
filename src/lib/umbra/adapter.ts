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
  getClaimableUtxoScannerFunction,
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
  rpcUrl,
} from "./client";
import {
  WSOL_MINT,
  wrapSol,
  unwrapAllWsol,
  confirmSolTransferTo,
  transferSol,
  wsolAtaFor,
} from "./wsol";
import { Connection, PublicKey } from "@solana/web3.js";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";
import { randomUUID } from "crypto";

const WSOL_MINT_STR = WSOL_MINT.toBase58();

// ============================================================================
// Reliability helpers
// ============================================================================
//
// The Umbra SDK's "queue + callback" operations (deposit, registration, UTXO
// creation) return as soon as the queue tx is mined, but the *effect* of the
// op is only on-chain after a follow-up callback tx runs. Without explicitly
// confirming the callback, the next step in our pipeline can race ahead and
// see stale state — escrow balance still 0, stealth viewing key not yet
// uploaded, etc. — silently producing broken UTXOs.
//
// These helpers make every async hop verified-on-chain before the next runs.

function newCorrelationId(): string {
  return randomUUID().slice(0, 8);
}

function newConnection(): Connection {
  return new Connection(rpcUrl(), "confirmed");
}

/**
 * Confirm an Umbra callback signature on-chain. No-ops cleanly if the SDK
 * didn't return a callback sig (some operations don't have one). Throws on
 * timeout or on a tx error.
 */
async function confirmCallbackOnChain(
  conn: Connection,
  signature: string | undefined,
  label: string,
  cid: string,
  timeoutMs: number,
): Promise<void> {
  if (!signature) {
    console.warn(`[payroll/${cid}][${label}] no callback signature returned`);
    return;
  }

  const start = Date.now();
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("confirmed");

  let result: { value: { err: unknown } };
  try {
    result = (await Promise.race([
      conn.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `${label} callback confirmation timed out after ${timeoutMs}ms (sig=${signature})`,
              ),
            ),
          timeoutMs,
        ),
      ),
    ])) as { value: { err: unknown } };
  } catch (err) {
    console.error(`[payroll/${cid}][${label}] callback confirm error`, err);
    throw err;
  }

  if (result.value.err) {
    throw new Error(
      `${label} callback failed on-chain: ${JSON.stringify(result.value.err)} (sig=${signature})`,
    );
  }
  console.log(`[payroll/${cid}][${label}] callback confirmed`, {
    signature,
    elapsedMs: Date.now() - start,
  });
}

/**
 * Poll the escrow's encrypted balance until it reaches `expectedAtLeast` or
 * the deadline elapses. Returns the observed balance. Throws on timeout.
 *
 * Tolerates the SDK not exposing getEncryptedBalance — if the method is
 * missing, logs a warning and returns 0n without throwing (so callers
 * don't break on SDK upgrades).
 */
async function verifyEncryptedBalance(
  client: IUmbraClient,
  mint: string,
  expectedAtLeast: bigint,
  label: string,
  cid: string,
  timeoutMs: number,
): Promise<bigint> {
  const querier = client as unknown as {
    getEncryptedBalance?: (mint: string) => Promise<bigint>;
  };
  if (typeof querier.getEncryptedBalance !== "function") {
    console.warn(
      `[payroll/${cid}][${label}] client.getEncryptedBalance not available, skipping balance check`,
    );
    return BigInt(0);
  }

  const deadline = Date.now() + timeoutMs;
  let lastBalance = BigInt(0);
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      lastBalance = await querier.getEncryptedBalance(mint);
      if (lastBalance >= expectedAtLeast) {
        console.log(
          `[payroll/${cid}][${label}] encrypted balance verified`,
          {
            balance: lastBalance.toString(),
            expectedAtLeast: expectedAtLeast.toString(),
            attempts,
          },
        );
        return lastBalance;
      }
    } catch (err) {
      console.warn(
        `[payroll/${cid}][${label}] getEncryptedBalance error (attempt ${attempts})`,
        err,
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(
    `${label} encrypted balance not credited within ${timeoutMs}ms ` +
      `(observed ${lastBalance.toString()}, needed ≥ ${expectedAtLeast.toString()})`,
  );
}

/**
 * Walk an error's `.cause` chain and return all messages joined.
 * Used to recognize "already registered" / blockhash-expired errors that
 * the Umbra SDK wraps several layers deep.
 */
function fullErrorMessage(err: unknown): string {
  const messages: string[] = [];
  let e: unknown = err;
  while (e) {
    const m = (e as { message?: string }).message;
    if (m) messages.push(m);
    e = (e as { cause?: unknown }).cause;
  }
  return messages.join(" | ");
}

/**
 * Idempotent Umbra registration with retries. Mirrors the regular /create
 * path's `ensureRegistered` (src/lib/privacy/umbra-adapter.ts:800) so the
 * payroll path benefits from the same hardening: 3 retries on blockhash
 * expiration, tolerance of "already registered" / AlreadyCallbacked
 * errors. Additionally confirms each returned signature on-chain — if the
 * SDK returns queue sigs (rather than awaiting callback completion), this
 * closes the registration → UTXO-creation race. Idempotent; no-op when
 * sigs are already mined.
 */
async function ensureRegistered(
  client: IUmbraClient,
  label: string,
  cid: string,
): Promise<void> {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      // Re-create the registration function each attempt so it picks up a
      // fresh blockhash when retrying.
      const register = getUserRegistrationFunction(
        { client },
        { zkProver: registrationProver() },
      );
      const sigs = await register({ confidential: true, anonymous: true });
      const sigList = Array.isArray(sigs) ? sigs.map((s) => String(s)) : [];
      console.log(`[payroll/${cid}][${label}] registration sdk returned`, {
        attempt,
        elapsedMs: Date.now() - start,
        sigs: sigList,
      });

      // Confirm each returned signature on-chain. Defensive: if the SDK
      // already waits for finality, these are no-ops; if it returned queue
      // sigs and the callback is still in flight, we wait for them here.
      // Without this, the stealth's viewing key may not be queryable on-
      // chain when createUtxo runs immediately after — producing a UTXO
      // whose ciphertext can't be resolved and shows up as "missing" to
      // the recipient's scan.
      if (sigList.length > 0) {
        const conn = newConnection();
        for (const sig of sigList) {
          await confirmCallbackOnChain(
            conn,
            sig,
            `${label}/sig-confirm`,
            cid,
            45_000,
          );
        }
      }
      return;
    } catch (error: unknown) {
      const fullError = fullErrorMessage(error);

      const alreadyRegistered =
        fullError.includes("already") ||
        fullError.includes("exists") ||
        fullError.includes("AlreadyCallbacked") ||
        fullError.includes("custom program error: #1");
      if (alreadyRegistered) {
        console.log(`[payroll/${cid}][${label}] already registered, ok`, {
          attempt,
        });
        return;
      }

      const blockhashExpired =
        fullError.includes("block height") ||
        fullError.includes("blockhash") ||
        fullError.includes("progressed past");
      if (blockhashExpired && attempt < MAX_RETRIES) {
        console.warn(
          `[payroll/${cid}][${label}] blockhash expired, retry ${attempt}/${MAX_RETRIES}`,
        );
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      console.error(`[payroll/${cid}][${label}] registration failed`, {
        attempt,
        fullError,
        cause: (error as { cause?: unknown }).cause ?? null,
      });
      throw error;
    }
  }
}

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
  /** Correlation id surfaced to the caller for cross-log debugging. */
  correlationId: string;
}

/**
 * 1. Confirm the business's SOL transfer hit the escrow.
 * 2. Wrap (totalAmount - buffer) SOL into wSOL on the escrow's ATA.
 * 3. Idempotent-register the escrow with Umbra.
 * 4. Deposit wSOL into the escrow's encrypted balance.
 * 5. Confirm the deposit callback on-chain and verify the encrypted balance
 *    actually reflects the deposit before returning. Without these the next
 *    issue-link call can read stale state and produce a broken UTXO.
 */
export async function umbraPayrollDeposit(
  input: PayrollDepositInput,
): Promise<PayrollDepositResult> {
  if (input.totalAmount <= ESCROW_BUFFER) {
    throw new Error(
      `totalAmount must exceed escrow buffer (${ESCROW_BUFFER} lamports)`,
    );
  }

  const cid = newCorrelationId();
  const escrow = getEscrowKeypair(input.businessWallet);
  const escrowPk = escrow.publicKey;
  const overallStart = Date.now();

  console.log(`[payroll/${cid}][deposit] start`, {
    businessWallet: input.businessWallet,
    escrow: escrowPk.toBase58(),
    totalAmount: input.totalAmount,
    network: networkName(),
  });

  // 1. Confirm business → escrow transfer.
  const delivered = await confirmSolTransferTo(
    input.signedDepositTxHash,
    escrowPk,
    input.totalAmount,
  );
  const wrappable = delivered - ESCROW_BUFFER;
  console.log(`[payroll/${cid}][deposit] business-transfer confirmed`, {
    delivered,
    wrappable,
  });

  // 2. Wrap to wSOL on escrow's ATA.
  const wrapStart = Date.now();
  const { signature: wrapSig } = await wrapSol(escrow, wrappable);
  console.log(`[payroll/${cid}][deposit] wrap ok`, {
    sig: wrapSig,
    elapsedMs: Date.now() - wrapStart,
  });

  // 3. Build Umbra client + ensure escrow is registered (idempotent, retries).
  const client = await umbraClientFor(escrow);
  await ensureRegistered(client, "deposit/escrow-register", cid);

  // 4. Deposit wSOL into encrypted balance.
  const conn = newConnection();
  const depositStart = Date.now();
  const deposit = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({
    client,
  });
  const depositResult = await deposit(
    client.signer.address,
    WSOL_MINT_STR as never,
    BigInt(wrappable) as never,
  );
  console.log(`[payroll/${cid}][deposit] sdk deposit returned`, {
    queueSignature: depositResult.queueSignature,
    callbackSignature: depositResult.callbackSignature,
    elapsedMs: Date.now() - depositStart,
  });

  // 5. Confirm callback is on-chain. The deposit op only credits the
  //    encrypted balance after the callback runs; without this, a
  //    follow-on issue-link sees an empty balance.
  await confirmCallbackOnChain(
    conn,
    depositResult.callbackSignature,
    "deposit/callback",
    cid,
    60_000,
  );

  // 6. Verify the encrypted balance reflects the deposit. Belt-and-braces:
  //    a confirmed callback should mean the balance is credited, but we
  //    don't trust the SDK to be perfectly aligned here. Poll up to 30s.
  await verifyEncryptedBalance(
    client,
    WSOL_MINT_STR,
    BigInt(wrappable),
    "deposit/balance-verify",
    cid,
    30_000,
  );

  console.log(`[payroll/${cid}][deposit] done`, {
    totalElapsedMs: Date.now() - overallStart,
  });

  return {
    poolPositionId: escrowPk.toBase58(),
    depositTxHash: input.signedDepositTxHash,
    wrapTxHash: wrapSig,
    umbraDepositQueueSignature: depositResult.queueSignature,
    umbraDepositCallbackSignature: depositResult.callbackSignature,
    correlationId: cid,
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
  /** Correlation id surfaced to the caller for cross-log debugging. */
  correlationId: string;
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
 *   - The escrow needs to be Umbra-registered (done at deposit time, but we
 *     re-ensure here in case the escrow's registration callback hadn't
 *     landed when deposit returned).
 *   - The stealth ALSO needs to be Umbra-registered AND its registration
 *     callback must be on-chain before the escrow creates the UTXO. The
 *     UTXO ciphertext is encrypted to the destination's master viewing key
 *     — if that key isn't on-chain yet, the indexer can't resolve it and
 *     the UTXO appears "missing" to the recipient forever. This is the
 *     bug behind the "middle escrow" claim failures.
 *
 * The flow is also instrumented with a correlation id so server logs can be
 * cross-referenced when a single issuance fails partway through.
 */
export async function umbraPayrollIssueLink(
  input: PayrollIssueLinkInput,
): Promise<PayrollIssueLinkResult> {
  if (input.amount <= 0) throw new Error("amount must be positive");

  const cid = newCorrelationId();
  const overallStart = Date.now();
  const escrow = getEscrowKeypair(input.businessWallet);
  const stealthSeed = crypto.getRandomValues(new Uint8Array(32));
  const stealth = stealthKeypairFromSeed(stealthSeed);
  const conn = newConnection();

  console.log(`[payroll/${cid}][issue-link] start`, {
    businessWallet: input.businessWallet,
    escrow: escrow.publicKey.toBase58(),
    stealth: stealth.publicKey.toBase58(),
    amount: input.amount,
    network: networkName(),
  });

  // 1. Fund the stealth with SOL so it has rent + tx-fee budget for its own
  //    Umbra registration (next step) and the eventual claim flow.
  const fundStart = Date.now();
  const fundSig = await transferSol(
    escrow,
    stealth.publicKey,
    STEALTH_FUND_BUDGET,
  );
  console.log(`[payroll/${cid}][issue-link] stealth funded`, {
    sig: fundSig,
    lamports: STEALTH_FUND_BUDGET,
    elapsedMs: Date.now() - fundStart,
  });

  // 2. Register the stealth on Umbra. This uploads stealth's master viewing
  //    key on-chain so the escrow can encrypt the UTXO ciphertext to it.
  //    `ensureRegistered` retries on blockhash expiration and tolerates
  //    "already registered" errors (paranoia — the seed is fresh, but the
  //    SDK may sometimes report odd states).
  const stealthClient = await umbraClientFor(stealth);
  await ensureRegistered(stealthClient, "issue-link/stealth-register", cid);

  // 3. Re-ensure the escrow is registered. The deposit step already does
  //    this, but if a previous deposit's registration callback didn't land,
  //    the escrow's encryption key may not be queryable yet. Idempotent.
  const escrowClient = await umbraClientFor(escrow);
  await ensureRegistered(escrowClient, "issue-link/escrow-reregister", cid);

  // 4. Verify the escrow has enough encrypted balance to source the UTXO.
  //    Without this we may silently create a 0-amount or invalid UTXO if
  //    the deposit callback hadn't actually credited yet.
  await verifyEncryptedBalance(
    escrowClient,
    WSOL_MINT_STR,
    BigInt(input.amount),
    "issue-link/escrow-balance-verify",
    cid,
    20_000,
  );

  // 5. Escrow creates a self-claimable UTXO destined for the stealth address.
  const createStart = Date.now();
  const createUtxo = getEncryptedBalanceToSelfClaimableUtxoCreatorFunction(
    { client: escrowClient },
    { zkProver: createUtxoProver() },
  );

  const result = await createUtxo({
    amount: BigInt(input.amount) as never,
    destinationAddress: stealth.publicKey.toBase58() as never,
    mint: WSOL_MINT_STR as never,
  });

  const queueSignature = (result as { queueSignature?: string }).queueSignature;
  const callbackSignature = (result as { callbackSignature?: string })
    .callbackSignature;
  const sdkCallbackElapsedMs = (result as { callbackElapsedMs?: number })
    .callbackElapsedMs;

  console.log(`[payroll/${cid}][issue-link] createUtxo returned`, {
    queueSignature,
    callbackSignature,
    sdkCallbackElapsedMs,
    elapsedMs: Date.now() - createStart,
  });

  // 6. Confirm the UTXO callback is on-chain before returning the link.
  //    This is the critical step: without it, the link can be shared while
  //    the UTXO is still mid-flight, and the recipient hits "no UTXOs
  //    found" — sometimes transiently, sometimes forever if the callback
  //    later errors.
  await confirmCallbackOnChain(
    conn,
    callbackSignature,
    "issue-link/utxo-callback",
    cid,
    90_000,
  );

  // 7. Verify the UTXO is actually visible to the indexer from the
  //    stealth's perspective. The Umbra indexer can lag the on-chain
  //    state by several seconds; if we return the link too early, the
  //    recipient's first scan comes up empty and they hit the
  //    "Couldn't find claimable funds" error even though the UTXO is on
  //    chain. Poll the scan every 3s until a UTXO shows up or we hit a
  //    90s deadline.
  const indexerVerifyStart = Date.now();
  const stealthScanner = getClaimableUtxoScannerFunction({
    client: stealthClient,
  });
  const indexerDeadline = Date.now() + 90_000;
  let indexerVisible = false;
  let indexerAttempts = 0;
  while (Date.now() < indexerDeadline) {
    indexerAttempts += 1;
    try {
      const scanResult = (await stealthScanner(
        BigInt(0) as never,
        BigInt(0) as never,
        BigInt(10000) as never,
      )) as {
        selfBurnable?: unknown[];
        publicSelfBurnable?: unknown[];
        self?: unknown[];
      };
      const visibleCount =
        (scanResult.selfBurnable?.length ?? 0) +
        (scanResult.publicSelfBurnable?.length ?? 0) +
        (scanResult.self?.length ?? 0);
      if (visibleCount > 0) {
        indexerVisible = true;
        console.log(
          `[payroll/${cid}][issue-link/indexer-verify] visible to stealth`,
          {
            attempts: indexerAttempts,
            elapsedMs: Date.now() - indexerVerifyStart,
            selfBurnable: scanResult.selfBurnable?.length ?? 0,
            publicSelfBurnable: scanResult.publicSelfBurnable?.length ?? 0,
          },
        );
        break;
      }
    } catch (err) {
      console.warn(
        `[payroll/${cid}][issue-link/indexer-verify] scan error attempt ${indexerAttempts}`,
        err,
      );
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!indexerVisible) {
    // Don't fail the issuance — the UTXO IS on-chain (we confirmed the
    // callback). The indexer will catch up eventually. But surface a
    // warning so server logs make it obvious why the recipient might
    // hit a transient "no UTXOs" error on their first scan.
    console.warn(
      `[payroll/${cid}][issue-link/indexer-verify] NOT visible after ${Math.round((Date.now() - indexerVerifyStart) / 1000)}s — UTXO is on-chain but indexer hasn't caught up. Recipient may need to retry.`,
    );
  }

  console.log(`[payroll/${cid}][issue-link] done`, {
    totalElapsedMs: Date.now() - overallStart,
    indexerVisible,
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
    issueTxHash: queueSignature,
    correlationId: cid,
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
