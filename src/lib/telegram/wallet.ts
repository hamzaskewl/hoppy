import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";
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
