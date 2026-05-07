/**
 * SOL ↔ wSOL plumbing for Umbra (Umbra only handles SPL tokens; we present SOL
 * to users by wrapping at the deposit edge and unwrapping at the claim edge).
 *
 * wSOL mint: So11111111111111111111111111111111111111112
 *
 * Wrap pattern:
 *   1. Get/create payer's wSOL ATA.
 *   2. SystemProgram.transfer SOL → wSOL ATA.
 *   3. syncNative on the ATA so the SPL balance reflects the lamports.
 *
 * Unwrap pattern:
 *   1. closeAccount(wSOL ATA, destination=payer's main wallet) → returns SOL.
 *   2. Note: ATA must be empty of wSOL after the transfer — closeAccount
 *      sweeps the entire balance back to the destination.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { rpcUrl } from "./client";

export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

function connection(): Connection {
  return new Connection(rpcUrl(), "confirmed");
}

/** Returns the wSOL ATA address for the given owner. */
export async function wsolAtaFor(owner: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(WSOL_MINT, owner, false, TOKEN_PROGRAM_ID);
}

/**
 * Wrap `lamports` of SOL into wSOL on `payer`'s ATA. Creates the ATA if it
 * doesn't already exist. `payer` signs and pays for everything.
 *
 * Returns the wSOL ATA address and the tx signature.
 */
export async function wrapSol(
  payer: Keypair,
  lamports: number,
): Promise<{ wsolAta: PublicKey; signature: string }> {
  const conn = connection();
  const wsolAta = await wsolAtaFor(payer.publicKey);

  const tx = new Transaction();

  // Create ATA if missing.
  const accountInfo = await conn.getAccountInfo(wsolAta);
  if (!accountInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        wsolAta,
        payer.publicKey,
        WSOL_MINT,
      ),
    );
  }

  // Send SOL to the ATA, then sync native so the SPL balance reflects it.
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAta,
      lamports,
    }),
    createSyncNativeInstruction(wsolAta),
  );

  const signature = await sendAndConfirmTransaction(conn, tx, [payer], {
    commitment: "confirmed",
  });
  return { wsolAta, signature };
}

/**
 * Unwrap all wSOL on `payer`'s ATA back into native SOL on `payer`'s main wallet.
 * After this the ATA is closed.
 */
export async function unwrapAllWsol(payer: Keypair): Promise<{
  signature: string | null;
}> {
  const conn = connection();
  const wsolAta = await wsolAtaFor(payer.publicKey);
  const info = await conn.getAccountInfo(wsolAta);
  if (!info) return { signature: null }; // nothing to unwrap

  const tx = new Transaction().add(
    createCloseAccountInstruction(wsolAta, payer.publicKey, payer.publicKey),
  );
  const signature = await sendAndConfirmTransaction(conn, tx, [payer], {
    commitment: "confirmed",
  });
  return { signature };
}

/** Native SOL balance of an address, in lamports. */
export async function getSolBalance(addr: PublicKey): Promise<number> {
  return connection().getBalance(addr, "confirmed");
}

/**
 * Wait for a tx signature to be confirmed AND verify it transferred at least
 * `minLamports` of SOL to `expectedRecipient`. Returns the actual lamports
 * delivered (so callers can use the real number, in case the user sent more).
 */
export async function confirmSolTransferTo(
  signature: string,
  expectedRecipient: PublicKey,
  minLamports: number,
): Promise<number> {
  const conn = connection();
  const { value } = await conn.confirmTransaction(
    { signature, ...(await conn.getLatestBlockhash()) },
    "confirmed",
  );
  if (value.err) {
    throw new Error(`deposit tx failed on-chain: ${JSON.stringify(value.err)}`);
  }
  const tx = await conn.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta) throw new Error("could not fetch tx meta");

  // Find expected recipient in account keys, sum positive balance delta.
  const keys = tx.transaction.message.getAccountKeys
    ? tx.transaction.message.getAccountKeys()
    : null;
  const accountKeys = keys
    ? keys.staticAccountKeys
    : tx.transaction.message
        .staticAccountKeys ??
      // legacy fallback
      [];
  const idx = accountKeys.findIndex((k: PublicKey) =>
    k.equals(expectedRecipient),
  );
  if (idx < 0) {
    throw new Error("deposit tx didn't touch the expected escrow address");
  }
  const delta = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
  if (delta < minLamports) {
    throw new Error(
      `deposit too small: got ${delta} lamports, need ≥ ${minLamports}`,
    );
  }
  return delta;
}

/** Move N lamports of SOL from payer to recipient (regular Solana transfer). */
export async function transferSol(
  payer: Keypair,
  recipient: PublicKey,
  lamports: number,
): Promise<string> {
  const conn = connection();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports,
    }),
  );
  return sendAndConfirmTransaction(conn, tx, [payer], {
    commitment: "confirmed",
  });
}
