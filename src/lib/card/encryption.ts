/**
 * Card Details Encryption/Decryption
 *
 * Uses AES-256-GCM for symmetric encryption.
 * Key is generated per-order and only exists in the claim link URL fragment.
 * Server stores ciphertext, can't decrypt without the key.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

/**
 * Generic redemption payload returned to the recipient. Covers brand gift
 * cards (code + URL), open-loop prepaid Visa (code + perfectgift redeem URL),
 * and legacy raw-PAN cards (number/expiry/cvv) for backwards compatibility.
 */
export interface CardDetails {
  productSlug: string;
  productName: string;
  value: number;
  currency: string;
  redemptionCode?: string;
  redemptionUrl?: string;
  pin?: string;
  instructions?: string;

  // Legacy raw-PAN fields (Starpay era). Kept so old claim links keep working.
  number?: string;
  expiry?: string;
  cvv?: string;
  cardType?: string;
}

export interface EncryptedCard {
  iv: string;      // Base64
  data: string;    // Base64 encrypted data
  tag: string;     // Base64 auth tag
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

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

export function createClaimLink(orderId: string, encryptionKey: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hoppy.cash";
  return `${baseUrl}/card/claim#${orderId}.${encryptionKey}`;
}

export function parseClaimLink(hash: string): { orderId: string; key: string } | null {
  if (!hash || !hash.includes(".")) return null;
  const [orderId, key] = hash.split(".");
  if (!orderId || !key) return null;
  return { orderId, key };
}
