/**
 * Pre-seeds the PrivacyCash SDK UTXO cache offset for a given public key.
 *
 * The SDK scans ALL UTXOs from the relayer starting at offset 0 for any key
 * it hasn't seen before. For fresh ephemeral keypairs (which will never have
 * existing UTXOs), this is a complete waste — scanning 300K+ entries just to
 * find nothing. Pre-setting the offset to the current total skips everything
 * and only scans new UTXOs from that point forward.
 */

// @ts-expect-error — no type declarations for node-localstorage
import { LocalStorage } from "node-localstorage";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID
  ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID)
  : new PublicKey("9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD");

const RELAYER_API_URL =
  process.env.NEXT_PUBLIC_RELAYER_API_URL ?? "https://api3.privacycash.org";

const PROGRAM_PREFIX = PROGRAM_ID.toString().substring(0, 6);

// Use the same storage path as the SDK (process.cwd()/cache)
let _storage: LocalStorage | null = null;
function getStorage(): LocalStorage {
  if (!_storage) {
    _storage = new LocalStorage(path.join(process.cwd(), "cache"));
  }
  return _storage;
}

/**
 * Pre-set the UTXO scan offset for a fresh ephemeral key so the SDK skips
 * scanning all existing UTXOs. Call this BEFORE creating a PrivacyCash client
 * with the ephemeral keypair.
 */
export async function preseedUtxoOffset(
  ephemeralPublicKey: string
): Promise<void> {
  try {
    // Fetch the current total UTXO count from the relayer
    const res = await fetch(
      `${RELAYER_API_URL}/utxos/range?start=0&end=1`
    );
    if (!res.ok) return; // non-critical, worst case it scans from 0

    const data = await res.json();
    const total = data?.total;
    if (typeof total !== "number" || total <= 0) return;

    const storage = getStorage();
    const cacheKey = `fetch_offset${PROGRAM_PREFIX}${ephemeralPublicKey}`;
    storage.setItem(cacheKey, total.toString());
  } catch {
    // Non-critical — if this fails, the SDK just scans from 0 (slow but works)
  }
}
