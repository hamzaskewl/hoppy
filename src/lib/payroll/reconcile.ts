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
 * URL formats this function has to handle:
 *   - v:2 (current) — `/claim#<bs58(JSON{s,a,n,t,tm,c,e,sp,v:2})>`. Stealth
 *     pubkey is in `e` (ephemeralAddress); seed in `s` (ephemeralSeed).
 *     Produced by serializeUmbraNote in src/lib/privacy/umbra-adapter.ts.
 *   - v:1 (legacy payroll) — `/payroll/claim#<bs58(JSON{version:1,
 *     stealthAddress, secret, ...})>`. Stealth pubkey is in stealthAddress;
 *     seed in secret. Produced by encodeNoteToUrl in src/lib/umbra/
 *     adapter.ts before the 2fe1463 refactor.
 *
 * We only ever upgrade "pending" → "claimed"; terminal statuses (claimed /
 * recalled / failed) are left alone.
 */

import bs58 from "bs58";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getUmbraConfigForNetwork } from "@/lib/privacy";
import type { PayrollLink, PayrollLinkStatus } from "./types";

/**
 * Balance threshold below which the stealth is considered "drained" → claimed.
 * 0.005 SOL is comfortably above the post-drain dust ceiling (~5K lamports)
 * but well below the pre-claim floor (after the stealth burns gas for its
 * own Umbra registration during issuance — typically 25–29M lamports remain
 * at the moment the link is generated).
 */
const DRAINED_THRESHOLD_LAMPORTS = 5_000_000; // 0.005 SOL

/** Stealth pubkey + network resolved from any supported note format. */
interface ResolvedNote {
  stealthPubkey: PublicKey;
  network: "mainnet" | "devnet";
}

function deriveStealthFromSeed(seedBs58: string): PublicKey | null {
  try {
    const seed = bs58.decode(seedBs58);
    if (seed.length !== 32) return null;
    return Keypair.fromSeed(seed).publicKey;
  } catch {
    return null;
  }
}

function tryPublicKey(addr: unknown): PublicKey | null {
  if (typeof addr !== "string" || !addr) return null;
  try {
    return new PublicKey(addr);
  } catch {
    return null;
  }
}

/**
 * Parse the hash portion of a claim URL against every format we've ever
 * produced. Returns null if nothing matches.
 */
function resolveNote(claimUrl: string, linkId: string): ResolvedNote | null {
  const hashIdx = claimUrl.indexOf("#");
  if (hashIdx === -1) {
    console.warn(`[payroll-reconcile/${linkId}] url has no '#'`);
    return null;
  }
  const hash = claimUrl.slice(hashIdx + 1);
  if (!hash) {
    console.warn(`[payroll-reconcile/${linkId}] empty hash`);
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(bs58.decode(hash)));
  } catch (err) {
    console.warn(
      `[payroll-reconcile/${linkId}] hash is not bs58-encoded JSON:`,
      err,
    );
    return null;
  }

  if (!decoded || typeof decoded !== "object") {
    console.warn(`[payroll-reconcile/${linkId}] decoded note is not an object`);
    return null;
  }
  const note = decoded as Record<string, unknown>;

  // v:2 — current short-key format from serializeUmbraNote
  if (note.v === 2) {
    const stealthPubkey =
      tryPublicKey(note.e) ??
      (typeof note.s === "string" ? deriveStealthFromSeed(note.s) : null);
    if (!stealthPubkey) {
      console.warn(
        `[payroll-reconcile/${linkId}] v:2 note missing usable e/s field`,
        { keys: Object.keys(note) },
      );
      return null;
    }
    const network: "mainnet" | "devnet" = note.n === "m" ? "mainnet" : "devnet";
    return { stealthPubkey, network };
  }

  // v:1 — legacy payroll note format
  if (note.version === 1) {
    const stealthPubkey =
      tryPublicKey(note.stealthAddress) ??
      (typeof note.secret === "string"
        ? deriveStealthFromSeed(note.secret)
        : null);
    if (!stealthPubkey) {
      console.warn(
        `[payroll-reconcile/${linkId}] v:1 note missing usable stealthAddress/secret`,
        { keys: Object.keys(note) },
      );
      return null;
    }
    const network: "mainnet" | "devnet" =
      note.network === "mainnet-beta" || note.network === "mainnet"
        ? "mainnet"
        : "devnet";
    return { stealthPubkey, network };
  }

  // Last-ditch: arbitrary object with a recognisable address/seed field
  const fallbackAddr =
    tryPublicKey(note.e) ??
    tryPublicKey(note.ephemeralAddress) ??
    tryPublicKey(note.stealthAddress);
  if (fallbackAddr) {
    const network: "mainnet" | "devnet" =
      note.n === "m" ||
      note.network === "mainnet" ||
      note.network === "mainnet-beta"
        ? "mainnet"
        : "devnet";
    return { stealthPubkey: fallbackAddr, network };
  }
  const fallbackSeed = typeof note.s === "string" ? note.s : typeof note.secret === "string" ? note.secret : typeof note.ephemeralSeed === "string" ? note.ephemeralSeed : null;
  if (fallbackSeed) {
    const derived = deriveStealthFromSeed(fallbackSeed);
    if (derived) {
      const network: "mainnet" | "devnet" =
        note.n === "m" ||
        note.network === "mainnet" ||
        note.network === "mainnet-beta"
          ? "mainnet"
          : "devnet";
      return { stealthPubkey: derived, network };
    }
  }

  console.warn(
    `[payroll-reconcile/${linkId}] unrecognised note shape`,
    { keys: Object.keys(note), versionField: note.v ?? note.version ?? null },
  );
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

  const resolved = resolveNote(link.claimUrl, link.id);
  if (!resolved) return null;

  const config = getUmbraConfigForNetwork(resolved.network);

  try {
    const connection = new Connection(config.rpcUrl, "confirmed");
    const balance = await connection.getBalance(resolved.stealthPubkey);
    const stealthShort = `${resolved.stealthPubkey
      .toBase58()
      .slice(0, 6)}…${resolved.stealthPubkey.toBase58().slice(-4)}`;
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
