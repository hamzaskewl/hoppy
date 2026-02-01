/**
 * Handle Privacy Cash deposit and withdrawal for private card purchase
 * 
 * This runs server-side where Privacy Cash SDK works.
 * Client sends the ephemeral keypair and we handle the pool operations.
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";
import bs58 from "bs58";

export async function POST(request: NextRequest) {
  let ephemeralKeypair: Keypair | null = null;
  let senderAddress: string | null = null;
  
  try {
    const body = await request.json();
    const { 
      ephemeralSecretKey, // Base64 encoded secret key
      starpayAddress,     // Starpay payment address
      amountLamports,     // Amount to send to Starpay
      returnAddress,      // User's wallet to return leftover SOL
    } = body;

    senderAddress = returnAddress;

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
    ephemeralKeypair = Keypair.fromSecretKey(secretKeyBytes);

    console.log("[PrivateDeposit] Ephemeral wallet:", ephemeralKeypair.publicKey.toBase58());
    console.log("[PrivateDeposit] Return address:", senderAddress);

    // Check ephemeral balance
    const balance = await connection.getBalance(ephemeralKeypair.publicKey);
    console.log("[PrivateDeposit] Ephemeral balance:", balance / LAMPORTS_PER_SOL, "SOL");

    // Calculate exact amounts needed
    // Privacy Cash withdrawal fee: 0.006 SOL flat + 0.35% of withdrawal amount
    // Fee is DEDUCTED from withdrawal, so we need to withdraw MORE to ensure Starpay gets amountLamports
    const TX_FEE = 5_000;
    const WITHDRAWAL_FLAT_FEE = 6_000_000; // 0.006 SOL
    const WITHDRAWAL_PERCENT = 0.0035; // 0.35%
    const SDK_OVERHEAD = 5_000_000; // For temp accounts during deposit
    
    // Calculate how much to withdraw so Starpay receives exactly amountLamports after fees
    // If we withdraw W, Starpay gets: W - (FLAT_FEE + W * PERCENT) = W * (1 - PERCENT) - FLAT_FEE
    // So: W * (1 - PERCENT) - FLAT_FEE = amountLamports
    // W = (amountLamports + FLAT_FEE) / (1 - PERCENT)
    const grossWithdrawal = Math.ceil((amountLamports + WITHDRAWAL_FLAT_FEE) / (1 - WITHDRAWAL_PERCENT));
    
    // Deposit needs to cover the gross withdrawal amount + SDK overhead
    const depositAmount = grossWithdrawal + SDK_OVERHEAD;

    console.log("[PrivateDeposit] Starpay needs:", amountLamports / LAMPORTS_PER_SOL, "SOL");
    console.log("[PrivateDeposit] Gross withdrawal (before fees):", grossWithdrawal / LAMPORTS_PER_SOL, "SOL");
    console.log("[PrivateDeposit] Deposit amount:", depositAmount / LAMPORTS_PER_SOL, "SOL");

    if (balance < depositAmount + TX_FEE * 2) {
      return NextResponse.json(
        { 
          error: `Insufficient balance. Have ${balance / LAMPORTS_PER_SOL} SOL, need ${(depositAmount + TX_FEE * 2) / LAMPORTS_PER_SOL} SOL`,
          ephemeralAddress: ephemeralKeypair.publicKey.toBase58(),
          ephemeralPrivateKey: bs58.encode(ephemeralKeypair.secretKey),
        },
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

    // Withdraw GROSS amount to Starpay (after fees, they receive amountLamports)
    console.log("[PrivateDeposit] Withdrawing", grossWithdrawal / LAMPORTS_PER_SOL, "SOL to Starpay:", starpayAddress);
    
    const withdrawResult = await privacyCash.withdraw({
      lamports: grossWithdrawal,
      recipientAddress: starpayAddress,
    });

    console.log("[PrivateDeposit] Withdraw tx:", withdrawResult.tx);
    console.log("[PrivateDeposit] Starpay should receive:", amountLamports / LAMPORTS_PER_SOL, "SOL (after fees)");

    // Sweep remaining balance back to user
    let sweepTx: string | null = null;
    if (senderAddress) {
      try {
        await new Promise(r => setTimeout(r, 1000));
        const remainingBalance = await connection.getBalance(ephemeralKeypair.publicKey);
        const sweepAmount = remainingBalance - TX_FEE;
        
        if (sweepAmount > 0) {
          console.log("[PrivateDeposit] Sweeping", sweepAmount / LAMPORTS_PER_SOL, "SOL back to user");
          
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: ephemeralKeypair.publicKey,
              toPubkey: new PublicKey(senderAddress),
              lamports: sweepAmount,
            })
          );
          
          sweepTx = await sendAndConfirmTransaction(connection, tx, [ephemeralKeypair]);
          console.log("[PrivateDeposit] Sweep tx:", sweepTx);
        }
      } catch (sweepErr) {
        console.error("[PrivateDeposit] Sweep failed (non-critical):", sweepErr);
      }
    }

    return NextResponse.json({
      success: true,
      depositTx: depositResult.tx,
      withdrawTx: withdrawResult.tx,
      sweepTx,
      depositedAmount: depositAmount,
      withdrawnAmount: amountLamports,
    });
  } catch (error) {
    console.error("[PrivateDeposit] Error:", error);
    
    // Return ephemeral key for recovery if we have it
    const errorResponse: any = { 
      error: error instanceof Error ? error.message : "Failed to process private deposit",
    };
    
    if (ephemeralKeypair) {
      errorResponse.ephemeralAddress = ephemeralKeypair.publicKey.toBase58();
      errorResponse.ephemeralPrivateKey = bs58.encode(ephemeralKeypair.secretKey);
      errorResponse.recoveryInstructions = "Import this private key into a wallet like Phantom to recover funds";
    }
    
    // Try to sweep funds back on error
    if (ephemeralKeypair && senderAddress) {
      try {
        const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
        const connection = new Connection(rpcUrl, "confirmed");
        const balance = await connection.getBalance(ephemeralKeypair.publicKey);
        const TX_FEE = 5_000;
        
        if (balance > TX_FEE) {
          console.log("[PrivateDeposit] Attempting error recovery sweep...");
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: ephemeralKeypair.publicKey,
              toPubkey: new PublicKey(senderAddress),
              lamports: balance - TX_FEE,
            })
          );
          const sweepTx = await sendAndConfirmTransaction(connection, tx, [ephemeralKeypair]);
          console.log("[PrivateDeposit] Recovery sweep successful:", sweepTx);
          errorResponse.recoverySweepTx = sweepTx;
          errorResponse.recoverySuccess = true;
        }
      } catch (sweepErr) {
        console.error("[PrivateDeposit] Recovery sweep failed:", sweepErr);
        errorResponse.recoverySuccess = false;
      }
    }
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
