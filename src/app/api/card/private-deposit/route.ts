/**
 * Handle Privacy Cash deposit and withdrawal for private card purchase
 * 
 * This runs server-side where Privacy Cash SDK works.
 * Client sends the ephemeral keypair and we handle the pool operations.
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      ephemeralSecretKey, // Base64 encoded secret key
      starpayAddress,     // Starpay payment address
      amountLamports,     // Amount to send to Starpay
    } = body;

    if (!ephemeralSecretKey || !starpayAddress || !amountLamports) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");

    // Reconstruct ephemeral keypair from secret key (base64 encoded)
    const secretKeyBytes = new Uint8Array(Buffer.from(ephemeralSecretKey, "base64"));
    const ephemeralKeypair = Keypair.fromSecretKey(secretKeyBytes);

    console.log("[PrivateDeposit] Ephemeral wallet:", ephemeralKeypair.publicKey.toBase58());

    // Check ephemeral balance
    const balance = await connection.getBalance(ephemeralKeypair.publicKey);
    console.log("[PrivateDeposit] Ephemeral balance:", balance / LAMPORTS_PER_SOL, "SOL");

    // Calculate deposit amount (leave some for withdrawal tx)
    const TX_FEE = 5000;
    const WITHDRAW_BUFFER = 2_000_000; // 0.002 SOL buffer
    const depositAmount = balance - WITHDRAW_BUFFER;

    if (depositAmount <= 0) {
      return NextResponse.json(
        { error: "Insufficient balance in ephemeral wallet" },
        { status: 400 }
      );
    }

    console.log("[PrivateDeposit] Depositing:", depositAmount / LAMPORTS_PER_SOL, "SOL");

    // Initialize Privacy Cash
    const privacyCash = new PrivacyCash({
      RPC_url: rpcUrl,
      owner: ephemeralKeypair,
      enableDebug: true,
    });

    // Deposit to pool
    const depositResult = await privacyCash.deposit({
      lamports: depositAmount,
    });

    console.log("[PrivateDeposit] Deposit tx:", depositResult.tx);

    // Wait a bit for confirmation
    await new Promise(r => setTimeout(r, 2000));

    // Withdraw to Starpay address
    console.log("[PrivateDeposit] Withdrawing to Starpay:", starpayAddress);
    
    const withdrawResult = await privacyCash.withdraw({
      lamports: amountLamports,
      recipientAddress: starpayAddress,
    });

    console.log("[PrivateDeposit] Withdraw tx:", withdrawResult.tx);

    return NextResponse.json({
      success: true,
      depositTx: depositResult.tx,
      withdrawTx: withdrawResult.tx,
      depositedAmount: depositAmount,
      withdrawnAmount: amountLamports,
    });
  } catch (error) {
    console.error("[PrivateDeposit] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process private deposit" },
      { status: 500 }
    );
  }
}
