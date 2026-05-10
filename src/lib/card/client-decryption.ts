/**
 * Client-side card decryption
 *
 * Uses Web Crypto API to decrypt redemption details in the browser.
 * The decryption key is ONLY in the URL hash and never sent to the server.
 */

export interface EncryptedCard {
  iv: string;      // Base64
  data: string;    // Base64
  tag: string;     // Base64
}

export interface CardDetails {
  productSlug: string;
  productName: string;
  value: number;
  currency: string;
  redemptionCode?: string;
  redemptionUrl?: string;
  pin?: string;
  instructions?: string;

  // Legacy raw-PAN fields (Starpay era). Old claim links still decode.
  number?: string;
  expiry?: string;
  cvv?: string;
  cardType?: string;
}

export async function decryptCardDetailsClient(
  encrypted: EncryptedCard,
  keyBase64url: string
): Promise<CardDetails> {
  const keyBytes = base64urlToBytes(keyBase64url);

  const keyBuffer = new ArrayBuffer(keyBytes.length);
  new Uint8Array(keyBuffer).set(keyBytes);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const iv = base64ToBytes(encrypted.iv);
  const ciphertext = base64ToBytes(encrypted.data);
  const authTag = base64ToBytes(encrypted.tag);

  const ivBuffer = new ArrayBuffer(iv.length);
  new Uint8Array(ivBuffer).set(iv);

  // Web Crypto expects ciphertext+tag concatenated
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.length);

  const combinedBuffer = new ArrayBuffer(combined.length);
  new Uint8Array(combinedBuffer).set(combined);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuffer },
    cryptoKey,
    combinedBuffer
  );

  const decoder = new TextDecoder();
  const json = decoder.decode(decrypted);

  return JSON.parse(json);
}

export function parseClaimHash(hash: string): { orderId: string; key: string } | null {
  const cleanHash = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!cleanHash || !cleanHash.includes(".")) return null;

  const dotIndex = cleanHash.indexOf(".");
  const orderId = cleanHash.slice(0, dotIndex);
  const key = cleanHash.slice(dotIndex + 1);

  if (!orderId || !key) return null;
  return { orderId, key };
}

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function base64urlToBytes(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return base64ToBytes(base64);
}
