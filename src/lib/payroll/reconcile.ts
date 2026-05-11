/**
 * Client-side reconciliation of payroll link status against on-chain state.
 *
 * Each payroll link points at a receiver-claimable Umbra UTXO sitting at a
 * stealth address. When the recipient claims (or the employer recalls), that
 * UTXO is consumed. So:
 *
 *   stealth has UTXOs visible to indexer → link is still "pending"
 *   stealth has no UTXOs                 → link was claimed (or recalled)
 *
 * We only ever upgrade "pending" → "claimed"; terminal statuses (claimed /
 * recalled / failed) are left alone. The recall flow tags links as "recalled"
 * synchronously after a successful recall tx, so we won't mistakenly relabel
 * those — but if a user recalls then clears localStorage on another device,
 * the link will show "claimed" rather than "recalled". That's acceptable —
 * both mean "funds delivered, no longer pending".
 */

import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import {
  getUmbraConfigForNetwork,
  createUmbraClientFromKeypair,
} from "@/lib/privacy";
import type { PayrollLink, PayrollLinkStatus, UmbraNote } from "./types";

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
 * Returns the new status if the link should be updated, or null to leave it.
 * Errors (bad note, network, scanner failure) return null — we never
 * downgrade a status based on a failed check.
 */
export async function reconcilePayrollLinkStatus(
  link: PayrollLink,
): Promise<PayrollLinkStatus | null> {
  if (link.status !== "pending") return null;

  const note = parseUmbraNoteFromUrl(link.claimUrl);
  if (!note) return null;

  let stealthKeypair: Keypair;
  try {
    const seed = bs58.decode(note.secret);
    if (seed.length !== 32) return null;
    stealthKeypair = Keypair.fromSeed(seed);
  } catch {
    return null;
  }

  // The note carries its own network — a devnet link claimed on a mainnet
  // deploy still needs to hit the devnet indexer.
  const network = note.network === "mainnet-beta" ? "mainnet" : "devnet";
  const config = getUmbraConfigForNetwork(network);

  let client: Awaited<ReturnType<typeof createUmbraClientFromKeypair>>;
  try {
    client = await createUmbraClientFromKeypair(stealthKeypair, config);
  } catch (err) {
    console.warn(`[payroll-reconcile/${link.id}] client init failed:`, err);
    return null;
  }

  try {
    const { getClaimableUtxoScannerFunction } = await import(
      "@umbra-privacy/sdk"
    );
    const scan = getClaimableUtxoScannerFunction({ client });
    const result = (await scan(
      BigInt(0) as never,
      BigInt(0) as never,
      BigInt(10000) as never,
    )) as {
      received?: unknown[];
      publicReceived?: unknown[];
      selfBurnable?: unknown[];
      publicSelfBurnable?: unknown[];
    };
    const visibleCount =
      (result.received?.length ?? 0) +
      (result.publicReceived?.length ?? 0) +
      (result.selfBurnable?.length ?? 0) +
      (result.publicSelfBurnable?.length ?? 0);

    if (visibleCount === 0) {
      return "claimed";
    }
    return null;
  } catch (err) {
    console.warn(`[payroll-reconcile/${link.id}] scan failed:`, err);
    return null;
  }
}
