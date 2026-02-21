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

    // Ephemeral wallet ready for deposit

    // Check ephemeral balance
    const balance = await connection.getBalance(ephemeralKeypair.publicKey);
    // Balance check

    // Calculate exact amounts needed
    // Privacy Cash withdrawal fee: 0.006 SOL flat + 0.35% of withdrawal amount
    // Fee is DEDUCTED from withdrawal, so we need to withdraw MORE to ensure Starpay gets amountLamports
    const TX_FEE = 5_000;
    const WITHDRAWAL_FLAT_FEE = 6_000_000; // 0.006 SOL
    const WITHDRAWAL_PERCENT = 0.0035; // 0.35%
    // Minimal buffer for tx fees during deposit + withdraw
    const MIN_TX_BUFFER = 5_000_000; // ~0.005 SOL for deposit+withdraw combo
    
    // Calculate how much to withdraw so Starpay receives exactly amountLamports after fees
    // If we withdraw W, Starpay gets: W - (FLAT_FEE + W * PERCENT) = W * (1 - PERCENT) - FLAT_FEE
    // So: W * (1 - PERCENT) - FLAT_FEE = amountLamports
    // W = (amountLamports + FLAT_FEE) / (1 - PERCENT)
    const grossWithdrawal = Math.ceil((amountLamports + WITHDRAWAL_FLAT_FEE) / (1 - WITHDRAWAL_PERCENT));
    
    // We deposit grossWithdrawal to pool, SDK uses the buffer for its internal fees
    // Ephemeral needs: grossWithdrawal + MIN_TX_BUFFER (for SDK fees)
    const requiredBalance = grossWithdrawal + MIN_TX_BUFFER;

    // Fee calculations complete

    if (balance < requiredBalance) {
      return NextResponse.json(
        { 
          error: `Insufficient balance. Have ${balance / LAMPORTS_PER_SOL} SOL, need ${requiredBalance / LAMPORTS_PER_SOL} SOL`,
          ephemeralAddress: ephemeralKeypair.publicKey.toBase58(),
        },
        { status: 400 }
      );
    }

    // Deposit to pool (buffer stays for SDK fees)

    // Initialize Privacy Cash
    const privacyCash = new PrivacyCash({
      RPC_url: rpcUrl,
      owner: ephemeralKeypair,
      enableDebug: false,
    });

    // Deposit grossWithdrawal to pool (buffer stays in wallet for SDK fees)
    const depositResult = await privacyCash.deposit({
      lamports: grossWithdrawal,
    });

    // Deposit complete

    // Wait a bit for confirmation
    await new Promise(r => setTimeout(r, 2000));

    // Withdraw to Starpay
    
    const withdrawResult = await privacyCash.withdraw({
      lamports: grossWithdrawal,
      recipientAddress: starpayAddress,
    });

    // Withdraw complete

    // Sweep remaining balance back to user
    let sweepTx: string | null = null;
    if (senderAddress) {
      try {
        await new Promise(r => setTimeout(r, 1000));
        const remainingBalance = await connection.getBalance(ephemeralKeypair.publicKey);
        const sweepAmount = remainingBalance - TX_FEE;
        
        if (sweepAmount > 0) {
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: ephemeralKeypair.publicKey,
              toPubkey: new PublicKey(senderAddress),
              lamports: sweepAmount,
            })
          );
          
          sweepTx = await sendAndConfirmTransaction(connection, tx, [ephemeralKeypair]);
        }
      } catch {
        // Sweep failed - non-critical
      }
    }

    return NextResponse.json({
      success: true,
      depositTx: depositResult.tx,
      withdrawTx: withdrawResult.tx,
      sweepTx,
      depositedAmount: grossWithdrawal,
      withdrawnAmount: amountLamports,
    });
  } catch (error) {
    // Error during deposit
    
    // Return ephemeral key for recovery if we have it
    const errorResponse: any = { 
      error: error instanceof Error ? error.message : "Failed to process private deposit",
    };
    
    if (ephemeralKeypair) {
      // Include ephemeral address for tracking (but NOT private key for security)
      errorResponse.ephemeralAddress = ephemeralKeypair.publicKey.toBase58();
    }
    
    // Try to sweep funds back on error
    if (ephemeralKeypair && senderAddress) {
      try {
        const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
        const connection = new Connection(rpcUrl, "confirmed");
        const balance = await connection.getBalance(ephemeralKeypair.publicKey);
        const TX_FEE = 5_000;
        
        if (balance > TX_FEE) {
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: ephemeralKeypair.publicKey,
              toPubkey: new PublicKey(senderAddress),
              lamports: balance - TX_FEE,
            })
          );
          const sweepTx = await sendAndConfirmTransaction(connection, tx, [ephemeralKeypair]);
          errorResponse.recoverySweepTx = sweepTx;
          errorResponse.recoverySuccess = true;
        }
      } catch (sweepErr) {
        // Recovery sweep failed - funds may be stuck
        errorResponse.recoverySuccess = false;
      }
    }
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
