import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// Get RPC URL from environment
export function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
}

// Get network from environment
export function getNetwork(): "devnet" | "mainnet-beta" {
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK;
  if (network === "mainnet-beta") return "mainnet-beta";
  return "devnet";
}

// Create connection instance
export function getConnection(): Connection {
  return new Connection(getRpcUrl(), "confirmed");
}

/**
 * Get account balance in lamports
 */
export async function getBalance(publicKey: PublicKey): Promise<number> {
  const connection = getConnection();
  return await connection.getBalance(publicKey);
}

/**
 * Create a transfer transaction
 */
export function createTransferTransaction(
  from: PublicKey,
  to: PublicKey,
  lamports: number
): Transaction {
  return new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports,
    })
  );
}

/**
 * Send and confirm a transaction with a keypair signer
 */
export async function sendTransaction(
  transaction: Transaction,
  signer: Keypair
): Promise<string> {
  const connection = getConnection();
  
  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = signer.publicKey;
  
  // Sign and send
  const signature = await sendAndConfirmTransaction(connection, transaction, [signer]);
  
  return signature;
}

/**
 * Request airdrop on devnet
 */
export async function requestAirdrop(publicKey: PublicKey, sol: number = 1): Promise<string> {
  const connection = getConnection();
  const signature = await connection.requestAirdrop(publicKey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(signature);
  return signature;
}

export { Connection, Keypair, PublicKey, Transaction, LAMPORTS_PER_SOL };
