/**
 * Card Details Encryption/Decryption
 * 
 * Uses AES-256-GCM for symmetric encryption.
 * Key is generated per-order and only exists in the claim link URL.
 * Server stores encrypted data, can't decrypt without the key.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface CardDetails {
  number: string;
  expiry: string;
  cvv: string;
  value: number;
  cardType: string;
}

export interface EncryptedCard {
  iv: string;      // Base64
  data: string;    // Base64 encrypted data
  tag: string;     // Base64 auth tag
}

/**
 * Generate a random 256-bit encryption key
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Encrypt card details with a key
 */
export function encryptCardDetails(card: CardDetails, keyBase64: string): EncryptedCard {
  const key = Buffer.from(keyBase64, "base64url");
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const plaintext = JSON.stringify(card);
  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString("base64"),
    data: encrypted.toString("base64"),
    tag: authTag.toString("base64"),
  };
}

/**
 * Decrypt card details with a key (client-side compatible version below)
 */
export function decryptCardDetails(encrypted: EncryptedCard, keyBase64: string): CardDetails {
  const key = Buffer.from(keyBase64, "base64url");
  const iv = Buffer.from(encrypted.iv, "base64");
  const data = Buffer.from(encrypted.data, "base64");
  const authTag = Buffer.from(encrypted.tag, "base64");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(data);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return JSON.parse(decrypted.toString("utf8"));
}

/**
 * Create a claim link with the order ID and encryption key
 */
export function createClaimLink(orderId: string, encryptionKey: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hoppy.cash";
  // Format: /card/claim#orderId.key
  return `${baseUrl}/card/claim#${orderId}.${encryptionKey}`;
}

/**
 * Parse a claim link to extract order ID and key
 */
export function parseClaimLink(hash: string): { orderId: string; key: string } | null {
  if (!hash || !hash.includes(".")) return null;
  const [orderId, key] = hash.split(".");
  if (!orderId || !key) return null;
  return { orderId, key };
}
