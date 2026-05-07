/**
 * API Route: Fund gas for an ephemeral wallet
 *
 * The web client calls this when doing a private send — the relayer
 * sends a small amount of SOL to the claimEph address so there is
 * no on-chain link between senderEph and claimEph.
 *
 * Rate-limited: max 1 request per address, capped at EPHEMERAL_GAS_BUFFER.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

/** Max gas we'll send per request (0.02 SOL — matches EPHEMERAL_GAS_BUFFER) */
const MAX_GAS_LAMPORTS = 20_000_000;

/** Simple in-memory set to prevent double-funding the same address */
const funded = new Set<string>();

export async function POST(req: NextRequest) {
  try {
    const { address, amount } = await req.json();

    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    // Validate Solana address
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(address);
    } catch {
      return NextResponse.json(
        { error: "Invalid Solana address" },
        { status: 400 }
      );
    }

    // Cap the amount
    const lamports = Math.min(
      typeof amount === "number" && amount > 0 ? amount : MAX_GAS_LAMPORTS,
      MAX_GAS_LAMPORTS
    );

    // Prevent double-funding
    if (funded.has(address)) {
      return NextResponse.json(
        { error: "Address already funded" },
        { status: 409 }
      );
    }

    const RELAYER_PRIVATE_KEY = process.env.HOPPY_RELAYER_PRIVATE_KEY;
    if (!RELAYER_PRIVATE_KEY) {
      return NextResponse.json(
        { error: "Relayer not configured" },
        { status: 503 }
      );
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const relayerKeypair = Keypair.fromSecretKey(bs58.decode(RELAYER_PRIVATE_KEY));

    // Verify relayer has enough balance
    const relayerBalance = await connection.getBalance(relayerKeypair.publicKey);
    if (relayerBalance < lamports + 10_000) {
      return NextResponse.json(
        { error: "Relayer balance too low" },
        { status: 503 }
      );
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: relayerKeypair.publicKey,
        toPubkey: pubkey,
        lamports,
      })
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [relayerKeypair], {
      commitment: "confirmed",
    });

    funded.add(address);

    // Evict old entries after 10 minutes to prevent unbounded growth
    setTimeout(() => funded.delete(address), 10 * 60 * 1000);

    return NextResponse.json({ success: true, signature: sig });
  } catch (error) {
    console.error("[Relayer Fund-Gas] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fund-gas failed" },
      { status: 500 }
    );
  }
}
