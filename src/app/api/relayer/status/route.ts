/**
 * API Route: Check Hoppy Relayer Status
 * 
 * Returns the relayer's SOL balance and whether SPL private transfers are available.
 * Used by the UI to show warnings when relayer balance is low.
 */

import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

// Minimum relayer balance to allow SPL private transfers
const MIN_RELAYER_BALANCE_LAMPORTS = 20_000_000; // 0.02 SOL
// Warning threshold
const WARNING_THRESHOLD_LAMPORTS = 50_000_000; // 0.05 SOL

export async function GET() {
  try {
    const RELAYER_PRIVATE_KEY = process.env.HOPPY_RELAYER_PRIVATE_KEY;
    
    if (!RELAYER_PRIVATE_KEY) {
      return NextResponse.json({
        available: false,
        reason: "Relayer not configured",
        balance: 0,
        balanceSOL: 0,
      });
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const relayerKeypair = Keypair.fromSecretKey(bs58.decode(RELAYER_PRIVATE_KEY));
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    const balanceSOL = balance / 1e9;

    // Determine status
    const available = balance >= MIN_RELAYER_BALANCE_LAMPORTS;
    const warning = balance < WARNING_THRESHOLD_LAMPORTS && balance >= MIN_RELAYER_BALANCE_LAMPORTS;

    return NextResponse.json({
      available,
      warning,
      balance,
      balanceSOL: parseFloat(balanceSOL.toFixed(4)),
      minRequired: MIN_RELAYER_BALANCE_LAMPORTS / 1e9,
      // Don't expose the actual address for security
      message: !available 
        ? "SPL private transfers temporarily unavailable (relayer balance low)"
        : warning 
          ? "Relayer balance running low"
          : "Relayer operational",
    });
  } catch (error) {
    console.error("[Relayer Status] Error:", error);
    return NextResponse.json({
      available: false,
      reason: "Failed to check relayer status",
      balance: 0,
      balanceSOL: 0,
    });
  }
}
