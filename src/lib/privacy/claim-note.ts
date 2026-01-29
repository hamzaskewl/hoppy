import bs58 from "bs58";

/**
 * Claim Note System
 * 
 * A claim note is a cryptographic secret that proves ownership of shielded funds.
 * It contains:
 * - secret: Random bytes that only the holder knows
 * - nullifier: Hash derived from secret, used to prevent double-spending
 * - amount: The amount of lamports in the note
 * - commitment: Public commitment stored in the pool
 * 
 * The flow:
 * 1. Sender deposits → Pool stores commitment, sender gets note
 * 2. Sender shares note with recipient (via URL)
 * 3. Recipient claims → Reveals nullifier, pool verifies and pays out
 */

export interface ClaimNote {
  /** Random secret (32 bytes, base58 encoded) */
  secret: string;
  /** Nullifier hash (32 bytes, base58 encoded) - derived from secret */
  nullifier: string;
  /** Commitment hash (32 bytes, base58 encoded) - stored in pool */
  commitment: string;
  /** Amount in lamports */
  amount: number;
  /** Timestamp when note was created */
  createdAt: number;
  /** Optional: network identifier */
  network?: "devnet" | "mainnet-beta";
}

/**
 * Serialized note format for URL sharing
 */
export interface SerializedNote {
  s: string;  // secret
  a: number;  // amount
  n?: string; // network
}

/**
 * Generate a cryptographically secure random secret
 */
function generateSecret(): Uint8Array {
  const secret = new Uint8Array(32);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(secret);
  } else {
    // Node.js fallback
    const crypto = require("crypto");
    const randomBytes = crypto.randomBytes(32);
    secret.set(randomBytes);
  }
  return secret;
}

/**
 * Simple hash function for deriving nullifier/commitment
 * In production, this would use Poseidon or similar ZK-friendly hash
 */
async function hash(data: Uint8Array, salt: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const saltBytes = encoder.encode(salt);
  const combined = new Uint8Array(data.length + saltBytes.length);
  combined.set(data);
  combined.set(saltBytes, data.length);
  
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", combined);
    return new Uint8Array(hashBuffer);
  } else {
    // Node.js fallback
    const crypto = require("crypto");
    return new Uint8Array(crypto.createHash("sha256").update(combined).digest());
  }
}

/**
 * Create a new claim note for a shielded deposit
 */
export async function createClaimNote(
  amount: number,
  network: "devnet" | "mainnet-beta" = "devnet"
): Promise<ClaimNote> {
  const secretBytes = generateSecret();
  const secret = bs58.encode(secretBytes);
  
  // Derive nullifier (used to prevent double-spending)
  const nullifierBytes = await hash(secretBytes, "hoppy:nullifier:v1");
  const nullifier = bs58.encode(nullifierBytes);
  
  // Derive commitment (stored publicly in the pool)
  const commitmentBytes = await hash(secretBytes, "hoppy:commitment:v1");
  const commitment = bs58.encode(commitmentBytes);
  
  return {
    secret,
    nullifier,
    commitment,
    amount,
    createdAt: Date.now(),
    network,
  };
}

/**
 * Reconstruct a claim note from just the secret
 * Used when recipient receives the note and needs to derive nullifier/commitment
 */
export async function reconstructNoteFromSecret(
  secret: string,
  amount: number,
  network: "devnet" | "mainnet-beta" = "devnet"
): Promise<ClaimNote> {
  const secretBytes = bs58.decode(secret);
  
  const nullifierBytes = await hash(secretBytes, "hoppy:nullifier:v1");
  const nullifier = bs58.encode(nullifierBytes);
  
  const commitmentBytes = await hash(secretBytes, "hoppy:commitment:v1");
  const commitment = bs58.encode(commitmentBytes);
  
  return {
    secret,
    nullifier,
    commitment,
    amount,
    createdAt: Date.now(),
    network,
  };
}

/**
 * Serialize a claim note for URL sharing
 * Only includes the secret and amount - recipient can derive the rest
 */
export function serializeNote(note: ClaimNote): string {
  const data: SerializedNote = {
    s: note.secret,
    a: note.amount,
  };
  if (note.network && note.network !== "devnet") {
    data.n = note.network;
  }
  
  // Encode as base58 for URL safety
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  return bs58.encode(bytes);
}

/**
 * Deserialize a claim note from URL
 */
export async function deserializeNote(encoded: string): Promise<ClaimNote | null> {
  try {
    const bytes = bs58.decode(encoded);
    const json = new TextDecoder().decode(bytes);
    const data: SerializedNote = JSON.parse(json);
    
    if (!data.s || typeof data.a !== "number") {
      console.error("Invalid note data:", data);
      return null;
    }
    
    const network = (data.n as "devnet" | "mainnet-beta") || "devnet";
    return await reconstructNoteFromSecret(data.s, data.a, network);
  } catch (error) {
    console.error("Failed to deserialize note:", error);
    return null;
  }
}

/**
 * Create a claim URL from a note
 */
export function createClaimUrl(note: ClaimNote, baseUrl?: string): string {
  const serialized = serializeNote(note);
  const base = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/claim#${serialized}`;
}

/**
 * Extract note from URL hash
 */
export async function extractNoteFromUrl(url?: string): Promise<ClaimNote | null> {
  const hash = url 
    ? new URL(url).hash.slice(1) 
    : (typeof window !== "undefined" ? window.location.hash.slice(1) : "");
  
  if (!hash || hash.length < 10) {
    return null;
  }
  
  return await deserializeNote(hash);
}

/**
 * Validate a claim note structure
 */
export function isValidNote(note: ClaimNote): boolean {
  return (
    typeof note.secret === "string" &&
    note.secret.length > 20 &&
    typeof note.nullifier === "string" &&
    typeof note.commitment === "string" &&
    typeof note.amount === "number" &&
    note.amount > 0
  );
}
