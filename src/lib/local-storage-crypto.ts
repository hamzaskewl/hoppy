/**
 * Wallet-keyed AES-GCM helpers for browser localStorage.
 *
 * Pattern lifted from src/components/create/create-link-form.tsx so payroll and
 * (eventually) the link history use the same primitive. Each caller picks its
 * own STORAGE_KEY and salt; this file just exposes the crypto.
 */

export interface CryptoConfig {
  /** Salt used during PBKDF2 derivation. Must be stable per caller. */
  salt: string;
  /** Suffix appended to the wallet address before key derivation. Must be stable per caller. */
  keyMaterialSuffix: string;
}

async function deriveKey(
  walletAddress: string,
  config: CryptoConfig,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(walletAddress + config.keyMaterialSuffix),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(config.salt),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptData(
  data: string,
  walletAddress: string,
  config: CryptoConfig,
): Promise<string> {
  const key = await deriveKey(walletAddress, config);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(data),
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptData(
  encryptedBase64: string,
  walletAddress: string,
  config: CryptoConfig,
): Promise<string | null> {
  try {
    const key = await deriveKey(walletAddress, config);

    let combined: Uint8Array;
    try {
      combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }

    if (combined.length <= 12) return null;

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    // Decrypt failure usually means the data was written under a different
    // wallet. Return null and let the caller decide whether to clear.
    return null;
  }
}
