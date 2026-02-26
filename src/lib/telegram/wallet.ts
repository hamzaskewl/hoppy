import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from "crypto";
import bs58 from "bs58";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

function getMasterKey(): Buffer {
  const key = process.env.TELEGRAM_BOT_MASTER_KEY;
  if (!key) throw new Error("TELEGRAM_BOT_MASTER_KEY not set");
  return Buffer.from(key, "hex");
}

// Derive a unique encryption key per user using HMAC-SHA256
function deriveUserKey(tgUserId: number): Buffer {
  return createHmac("sha256", getMasterKey())
    .update(`hoppy:tg:${tgUserId}`)
    .digest();
}

export function generateWallet() {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey),
    keypair,
  };
}

export function encryptSecretKey(secretKeyBase58: string, tgUserId: number): string {
  const key = deriveUserKey(tgUserId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(secretKeyBase58, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decryptSecretKey(encryptedData: string, tgUserId: number): string {
  const key = deriveUserKey(tgUserId);
  const [ivHex, tagHex, ciphertext] = encryptedData.split(":");

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function keypairFromBase58(secretKeyBase58: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(secretKeyBase58));
}

export async function getBalance(address: string): Promise<number> {
  const connection = new Connection(RPC_URL, "confirmed");
  return connection.getBalance(new PublicKey(address));
}

export function lamportsToSol(lamports: number): number {
  return lamports / 1e9;
}

export function solToLamports(sol: number): number {
  return Math.round(sol * 1e9);
}

// ============ Payment Claim URL Encryption ============

/** System-level key for encrypting payment claim URLs (not per-user) */
function derivePaymentKey(): Buffer {
  return createHmac("sha256", getMasterKey())
    .update("hoppy:tg:payments")
    .digest();
}

/** Encrypt a claim URL for at-rest storage */
export function encryptClaimUrl(claimUrl: string): string {
  const key = derivePaymentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(claimUrl, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

/** Decrypt a claim URL from storage */
export function decryptClaimUrl(encryptedData: string): string {
  const key = derivePaymentKey();
  const [ivHex, tagHex, ciphertext] = encryptedData.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** Check if a value is in encrypted format (iv:tag:ciphertext) vs plaintext */
export function isEncryptedClaimUrl(value: string): boolean {
  const parts = value.split(":");
  // iv=24 hex chars (12 bytes), tag=32 hex chars (16 bytes), ciphertext varies
  return parts.length === 3 && parts[0].length === 24 && parts[1].length === 32;
}

// ============ Recipient Identifier Hashing ============

/** Hash a recipient identifier (username) for privacy-preserving storage */
export function hashIdentifier(identifier: string): string {
  return createHash("sha256")
    .update(identifier.toLowerCase())
    .digest("hex");
}
