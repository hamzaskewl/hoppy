/**
 * Umbra client + ZK prover + relayer factories.
 *
 * One IUmbraClient per signer (escrow or stealth). Cached per process so
 * sequential issuance calls reuse warm clients.
 */

import {
  createSignerFromPrivateKeyBytes,
  getPollingComputationMonitor,
  getPollingTransactionForwarder,
  getUmbraClient,
  getUmbraRelayer,
} from "@umbra-privacy/sdk";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";

// IUmbraRelayer isn't re-exported from /interfaces in this SDK version;
// derive its type from the factory.
type IUmbraRelayer = ReturnType<typeof getUmbraRelayer>;
import {
  getCreateReceiverClaimableUtxoFromEncryptedBalanceProver,
  getClaimSelfClaimableUtxoIntoPublicBalanceProver,
  getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getUserRegistrationProver,
} from "@umbra-privacy/web-zk-prover";
import type { Keypair } from "@solana/web3.js";

export type UmbraNetwork = "devnet" | "mainnet-beta";

function env(name: string, fallback?: string): string {
  const raw = process.env[name];
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} env var is required`);
}

function assertHttpUrl(url: string, source: string): string {
  // The Umbra SDK / @solana/kit validates URL format and throws a cryptic
  // "Endpoint URL must start with `http:` or `https:`." deep inside its
  // internals. Catch the bad value here with a useful message so a
  // misconfigured Railway env doesn't burn user deposits.
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(
      `[umbra/client] RPC URL from ${source} is invalid: ${JSON.stringify(url)}. ` +
        `Set NEXT_PUBLIC_SOLANA_RPC_URL (or UMBRA_RPC_URL) to a full https:// URL ` +
        `(e.g. https://mainnet.helius-rpc.com/?api-key=...).`,
    );
  }
  return url;
}

function rpcUrl(): string {
  const explicit = (process.env.UMBRA_RPC_URL ?? "").trim();
  if (explicit.length > 0) return assertHttpUrl(explicit, "UMBRA_RPC_URL");

  const nextPublic = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "").trim();
  if (nextPublic.length > 0) return assertHttpUrl(nextPublic, "NEXT_PUBLIC_SOLANA_RPC_URL");

  // Last-resort default. Logged loudly so it can't silently mask a misconfig
  // in production.
  console.warn(
    "[umbra/client] No RPC URL configured (UMBRA_RPC_URL / NEXT_PUBLIC_SOLANA_RPC_URL). " +
      "Falling back to public devnet — this WILL fail on mainnet card/payroll flows.",
  );
  return "https://api.devnet.solana.com";
}

function rpcSubscriptionsUrl(): string {
  // Default: derive ws:// from the http RPC URL.
  const explicit = process.env.UMBRA_RPC_SUBSCRIPTIONS_URL;
  if (explicit) return explicit;
  return rpcUrl().replace(/^http/, "ws");
}

function indexerUrl(): string {
  const defaultUrl =
    networkName() === "mainnet-beta"
      ? "https://utxo-indexer.api.umbraprivacy.com"
      : "https://utxo-indexer.api-devnet.umbraprivacy.com";
  return env("UMBRA_INDEXER_URL", defaultUrl);
}

function relayerUrl(): string {
  return env("UMBRA_RELAYER_URL", "https://relayer.api.umbraprivacy.com");
}

function networkName(): UmbraNetwork {
  return (process.env.UMBRA_NETWORK as UmbraNetwork) ?? "devnet";
}

const clientCache = new Map<string, Promise<IUmbraClient>>();

/**
 * Build (or fetch from cache) an Umbra client for the given Solana keypair.
 * Cached by base58 pubkey so repeated calls with the same signer are cheap.
 */
export async function umbraClientFor(kp: Keypair): Promise<IUmbraClient> {
  const cacheKey = kp.publicKey.toBase58();
  let promise = clientCache.get(cacheKey);
  if (promise) return promise;

  promise = (async () => {
    const signer = await createSignerFromPrivateKeyBytes(kp.secretKey);
    const url = rpcUrl();
    return await getUmbraClient(
      {
        signer,
        network: networkName() === "mainnet-beta" ? "mainnet" : "devnet",
        rpcUrl: url,
        rpcSubscriptionsUrl: rpcSubscriptionsUrl(),
        indexerApiEndpoint: indexerUrl(),
      },
      {
        transactionForwarder: getPollingTransactionForwarder({ rpcUrl: url }),
        computationMonitor: getPollingComputationMonitor({ rpcUrl: url }),
      },
    );
  })();

  clientCache.set(cacheKey, promise);
  return promise;
}

let relayerInstance: IUmbraRelayer | null = null;
export function umbraRelayer(): IUmbraRelayer {
  if (!relayerInstance) {
    relayerInstance = getUmbraRelayer({ apiEndpoint: relayerUrl() });
  }
  return relayerInstance;
}

// ZK provers are stateless function-bundle objects; one per process is fine.
let createReceiverUtxoProverInstance: ReturnType<
  typeof getCreateReceiverClaimableUtxoFromEncryptedBalanceProver
> | null = null;
let claimUtxoProverInstance: ReturnType<
  typeof getClaimSelfClaimableUtxoIntoPublicBalanceProver
> | null = null;
let registrationProverInstance: ReturnType<
  typeof getUserRegistrationProver
> | null = null;

/**
 * Receiver-claimable UTXO prover (encrypted-balance source). Used for payroll:
 * the escrow signs the create, but the resulting UTXO is encrypted to the
 * stealth's on-chain user commitment so only the stealth can claim. A
 * self-claimable UTXO would be claim-bound to the escrow's master seed +
 * generation index — the stealth in the URL has neither, so payroll links
 * built that way are unclaimable.
 */
export function createReceiverUtxoProver() {
  if (!createReceiverUtxoProverInstance) {
    createReceiverUtxoProverInstance =
      getCreateReceiverClaimableUtxoFromEncryptedBalanceProver();
  }
  return createReceiverUtxoProverInstance;
}

export function claimUtxoProver() {
  if (!claimUtxoProverInstance) {
    claimUtxoProverInstance =
      getClaimSelfClaimableUtxoIntoPublicBalanceProver();
  }
  return claimUtxoProverInstance;
}

let claimReceiverIntoEncryptedProverInstance: ReturnType<
  typeof getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver
> | null = null;

/**
 * Claim a RECEIVER-CLAIMABLE UTXO into the receiver's ENCRYPTED balance.
 * This is the prover the stealth uses in the card flow to pull the UTXO
 * the escrow created for it.
 */
export function claimReceiverIntoEncryptedProver() {
  if (!claimReceiverIntoEncryptedProverInstance) {
    claimReceiverIntoEncryptedProverInstance =
      getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver();
  }
  return claimReceiverIntoEncryptedProverInstance;
}

export function registrationProver() {
  if (!registrationProverInstance) {
    registrationProverInstance = getUserRegistrationProver();
  }
  return registrationProverInstance;
}

export { networkName, rpcUrl };
