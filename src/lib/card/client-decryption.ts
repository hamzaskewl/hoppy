/**
 * Client-side card decryption
 * 
 * Uses Web Crypto API to decrypt card details in the browser.
 * The decryption key is ONLY in the URL hash and never sent to the server.
 */

export interface EncryptedCard {
  iv: string;      // Base64
  data: string;    // Base64
  tag: string;     // Base64
}

export interface CardDetails {
  number: string;
  expiry: string;
  cvv: string;
  value: number;
  cardType: string;
}

/**
 * Decrypt card details using Web Crypto API (browser)
 */
export async function decryptCardDetailsClient(
  encrypted: EncryptedCard, 
  keyBase64url: string
): Promise<CardDetails> {
  // Convert base64url key to ArrayBuffer
  const keyBytes = base64urlToBytes(keyBase64url);
  
  // Create a fresh ArrayBuffer copy (avoids SharedArrayBuffer issues)
  const keyBuffer = new ArrayBuffer(keyBytes.length);
  new Uint8Array(keyBuffer).set(keyBytes);
  
  // Import the key
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  
  // Decode encrypted data
  const iv = base64ToBytes(encrypted.iv);
  const ciphertext = base64ToBytes(encrypted.data);
  const authTag = base64ToBytes(encrypted.tag);
  
  // Create fresh ArrayBuffer for IV
  const ivBuffer = new ArrayBuffer(iv.length);
  new Uint8Array(ivBuffer).set(iv);
  
  // Combine ciphertext and auth tag (Web Crypto expects them together)
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.length);
  
  // Create fresh ArrayBuffer for combined data
  const combinedBuffer = new ArrayBuffer(combined.length);
  new Uint8Array(combinedBuffer).set(combined);
  
  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuffer },
    cryptoKey,
    combinedBuffer
  );
  
  // Decode to string
  const decoder = new TextDecoder();
  const json = decoder.decode(decrypted);
  
  return JSON.parse(json);
}

/**
 * Parse claim link hash to get order ID and key
 */
export function parseClaimHash(hash: string): { orderId: string; key: string } | null {
  // Remove leading # if present
  const cleanHash = hash.startsWith("#") ? hash.slice(1) : hash;
  
  if (!cleanHash || !cleanHash.includes(".")) return null;
  
  const dotIndex = cleanHash.indexOf(".");
  const orderId = cleanHash.slice(0, dotIndex);
  const key = cleanHash.slice(dotIndex + 1);
  
  if (!orderId || !key) return null;
  return { orderId, key };
}

// Helper: base64 to Uint8Array
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper: base64url to Uint8Array
function base64urlToBytes(base64url: string): Uint8Array {
  // Convert base64url to base64
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  while (base64.length % 4) {
    base64 += "=";
  }
  return base64ToBytes(base64);
}
