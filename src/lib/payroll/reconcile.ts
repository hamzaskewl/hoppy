/**
 * Client-side reconciliation of payroll link status against on-chain state.
 *
 * Each payroll link is bound to a stealth wallet that gets funded with
 * STEALTH_FUND_BUDGET (0.03 SOL) at issuance to cover its own claim gas
 * (registration noop + receiver-claim + withdraw + ATA close + drain). The
 * final drain step inside the recipient's claim flow sweeps everything from
 * the stealth — native SOL plus the recovered wSOL ATA rent — into the
 * recipient's wallet, leaving the stealth at fee-dust (~0–5K lamports).
 *
 * So:
 *   stealth has > a few million lamports → link is still pending
 *   stealth has been drained to dust     → recipient already claimed
 *                                          (or recalled — same outcome)
 *
 * Why not the Umbra UTXO scanner? `getClaimableUtxoScannerFunction` returns
 * every UTXO whose AES ciphertext decrypts to this viewing key, regardless
 * of whether the nullifier has been published on-chain. So after a claim,
 * the original receiver-claimable UTXO still appears in `scan.received[]`
 * forever — making a "scanner sees 0 UTXOs" heuristic unreachable in
 * practice. That's why the previous implementation never flipped pending →
 * claimed.
 *
 * Mirrors the /create reconcile (src/app/create/.../create-link-form.tsx
 * `checkLinkStatus`), which uses the same ephemeral-wallet balance trick.
 *
 * We only ever upgrade "pending" → "claimed"; terminal statuses (claimed /
 * recalled / failed) are left alone. The recall flow tags links as
 * "recalled" synchronously after a successful recall tx, so we won't
 * mistakenly relabel those — but if a user recalls then clears localStorage
 * on another device, the link will show "claimed" rather than "recalled".
 * That's acceptable — both mean "funds delivered, no longer pending".
 */

import bs58 from "bs58";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getUmbraConfigForNetwork } from "@/lib/privacy";
import type { PayrollLink, PayrollLinkStatus, UmbraNote } from "./types";

/**
 * Balance threshold below which the stealth is considered "drained" → claimed.
 * The drain tx in claim-flow.tsx tries to send `balance - fee` to the
 * recipient, leaving ~5000 lamports of fee dust. A still-pending stealth has
 * at least most of the 0.03 SOL STEALTH_FUND_BUDGET it was issued with.
 *
 * 0.005 SOL is comfortably above the post-drain dust ceiling (~5K lamports)
 * but well below the pre-claim floor (after the stealth burns gas for its
 * own Umbra registration during issuance — typically 25–29M lamports remain
 * at the moment the link is generated).
 */
const DRAINED_THRESHOLD_LAMPORTS = 5_000_000; // 0.005 SOL

function parseUmbraNoteFromUrl(url: string): UmbraNote | null {
  try {
    const hash = url.includes("#") ? url.split("#")[1] : "";
    if (!hash) return null;
    const json = new TextDecoder().decode(bs58.decode(hash));
    const parsed = JSON.parse(json) as UmbraNote;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve the stealth pubkey from the note. Prefer the explicit
 * `stealthAddress` field (newer links), fall back to deriving it from the
 * `secret` seed for older links that predate the field.
 */
function resolveStealthPubkey(note: UmbraNote): PublicKey | null {
  if (note.stealthAddress) {
    try {
      return new PublicKey(note.stealthAddress);
    } catch {
      // fall through to seed derivation
    }
  }
  if (note.secret) {
    try {
      const seed = bs58.decode(note.secret);
      if (seed.length === 32) {
        return Keypair.fromSeed(seed).publicKey;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Returns the new status if the link should be updated, or null to leave it.
 * Errors (bad note, network failure) return null — we never downgrade a
 * status based on a failed check.
 */
export async function reconcilePayrollLinkStatus(
  link: PayrollLink,
): Promise<PayrollLinkStatus | null> {
  if (link.status !== "pending") return null;

  const note = parseUmbraNoteFromUrl(link.claimUrl);
  if (!note) {
    console.warn(`[payroll-reconcile/${link.id}] could not parse note from url`);
    return null;
  }

  const stealthPubkey = resolveStealthPubkey(note);
  if (!stealthPubkey) {
    console.warn(`[payroll-reconcile/${link.id}] could not resolve stealth pubkey`);
    return null;
  }

  // The note carries its own network — a devnet link reconciled on a mainnet
  // deploy still needs to hit the devnet RPC.
  const network = note.network === "mainnet-beta" ? "mainnet" : "devnet";
  const config = getUmbraConfigForNetwork(network);

  try {
    const connection = new Connection(config.rpcUrl, "confirmed");
    const balance = await connection.getBalance(stealthPubkey);
    const stealthShort = `${stealthPubkey.toBase58().slice(0, 6)}…${stealthPubkey
      .toBase58()
      .slice(-4)}`;
    if (balance < DRAINED_THRESHOLD_LAMPORTS) {
      console.log(
        `[payroll-reconcile/${link.id}] stealth ${stealthShort} drained (${balance} lamports) → claimed`,
      );
      return "claimed";
    }
    console.log(
      `[payroll-reconcile/${link.id}] stealth ${stealthShort} still funded (${balance} lamports) → pending`,
    );
    return null;
  } catch (err) {
    console.warn(`[payroll-reconcile/${link.id}] balance check failed:`, err);
    return null;
  }
}
