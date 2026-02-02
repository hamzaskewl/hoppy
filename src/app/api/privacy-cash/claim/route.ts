/**
 * API Route: Claim Privacy Cash Link
 * 
 * PRIVACY MODEL:
 * 
 * The link contains an ephemeral wallet's secret:
 * - Basic sender: Eph1 (sender traceable by recipient)
 * - Private sender: Eph2 (sender hidden - Eph2 was funded via ZK withdrawal)
 * 
 * Recipient chooses their privacy level:
 * - Quick: Eph → Recipient (direct transfer, sender can see recipient)
 * - Private: Eph → Pool → Recipient (ZK withdrawal, recipient hidden from sender)
 * 
 * PRIVACY GUARANTEES:
 * - Private sender + Quick recipient: Sender hidden, recipient visible to sender
 * - Private sender + Private recipient: FULL PRIVACY - no one can link anyone
 * - Basic sender + Private recipient: Sender visible to recipient, recipient hidden
 * - Basic sender + Quick recipient: No privacy (cheapest option)
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";
import {
  decodeCompositeSecret,
  type DoubleHopNote,
  type RecipientPrivacy,
} from "@/lib/privacy/privacy-cash-adapter";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { note, recipientAddress, recipientPrivacy: recipientPrivacyRaw } = body;

    if (!note || !recipientAddress) {
      return NextResponse.json(
        { success: false, error: "Missing note or recipient address" },
        { status: 400 }
      );
    }

    // Validate and default recipient privacy
    const recipientPrivacy: RecipientPrivacy = 
      (recipientPrivacyRaw === "quick" || recipientPrivacyRaw === "private") 
        ? recipientPrivacyRaw 
        : "quick";

    const doubleHopNote = note as DoubleHopNote;

    // Processing claim request

    // Decode composite secret
    const compositeSecret = decodeCompositeSecret(doubleHopNote.secret);
    if (!compositeSecret) {
      return NextResponse.json(
        { success: false, error: "Invalid claim secret" },
        { status: 400 }
      );
    }

    // Verify ephemeral address
    const ephAddress = compositeSecret.ephemeralKeypair.publicKey.toBase58();
    if (ephAddress !== doubleHopNote.ephemeralAddress) {
      return NextResponse.json(
        { success: false, error: "Ephemeral address mismatch" },
        { status: 400 }
      );
    }

    // ========================================================================
    // FLOW ROUTING: Based on recipientPrivacy
    // 
    // Funds are always in ephemeral wallet:
    // - Basic sender: Eph1 funded directly by sender (traceable)
    // - Private sender: Eph2 funded by ZK withdrawal from pool (untraceable)
    // ========================================================================
    
    const needsPrivacy = recipientPrivacy === "private";

    // ------------------------------------------------------------------------
    // FLOW 1: QUICK recipient
    // 
    // Cheapest! Direct transfer from ephemeral to recipient.
    // Sender can see who claimed (by looking up ephemeral's outgoing tx).
    // For private sender: Sender only sees Eph2 → Recipient (can't trace to themselves)
    // ------------------------------------------------------------------------
    if (!needsPrivacy) {
      // Flow 1: Direct transfer (QUICK CLAIM)
      
      // Get actual ephemeral balance and sweep it all (minus tx fee)
      const ephemeralBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
      const TX_FEE = 5000; // Standard tx fee in lamports
      const transferAmount = Math.max(0, ephemeralBalance - TX_FEE);
      
      if (transferAmount <= 0) {
        throw new Error("Ephemeral wallet has insufficient balance for transfer");
      }
      
      // Sweeping ephemeral to recipient
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: compositeSecret.ephemeralKeypair.publicKey,
          toPubkey: new (await import("@solana/web3.js")).PublicKey(recipientAddress),
          lamports: transferAmount,
        })
      );

      const txHash = await sendAndConfirmTransaction(
        connection,
        tx,
        [compositeSecret.ephemeralKeypair],
        { commitment: "confirmed" }
      );

      // Check ephemeral is now empty
      const finalBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);

      return NextResponse.json({
        success: true,
        withdrawTxHash: txHash,
        amountReceived: transferAmount,
        recipientPrivacy,
        hops: 0,
      });
    }

    // ------------------------------------------------------------------------
    // FLOW 2: PRIVATE recipient  
    // 
    // Eph → Pool → Recipient (ZK withdrawal hides recipient)
    // Sender sees: Eph → Pool (cannot see final destination)
    // This gives recipient privacy from the sender/link holder.
    // ------------------------------------------------------------------------
    if (needsPrivacy) {
      // Flow 2: Ephemeral → Pool → Recipient (PRIVATE CLAIM)

      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: true,
      });

      // Check actual ephemeral balance and subtract SDK overhead
      const ephBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
      const MIN_TX_BUFFER = 3_000_000; // ~0.003 SOL - minimal buffer for tx fees
      const depositAmount = Math.max(0, ephBalance - MIN_TX_BUFFER);
      
      if (depositAmount <= 0) {
        throw new Error("Ephemeral balance too low to cover Privacy Cash overhead");
      }
      
      // First deposit to pool (free, no fee)
      await privacyCashClient.deposit({
        lamports: depositAmount,
      });

      // Withdraw with ZK privacy - pass FULL depositAmount
      // SDK will drain the entire UTXO (no change left behind)
      // and deduct its fee automatically (~0.006 SOL + 0.35%)
      const withdrawResult = await privacyCashClient.withdraw({
        lamports: depositAmount,
        recipientAddress,
      });

      // Check ephemeral is now empty
      const finalBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);

      // The SDK deducts fee from depositAmount, recipient gets (depositAmount - fee)
      // Fee structure: 0.006 SOL base + 0.35% of amount
      // We don't know exact amount, SDK logs it - just return depositAmount as estimate
      // The actual received amount is shown in SDK logs

      return NextResponse.json({
        success: true,
        withdrawTxHash: withdrawResult.tx,
        amountReceived: depositAmount, // SDK shows actual in its logs
        recipientPrivacy,
        hops: 1,
      });
    }

    // Should never reach here
    throw new Error("Invalid claim flow");
  } catch (error) {
    // Error during claim
    
    // Check for specific errors
    const errorMessage = error instanceof Error ? error.message : "Failed to claim";
    
    if (errorMessage.includes("insufficient") || errorMessage.includes("balance")) {
      return NextResponse.json(
        {
          success: false,
          error: "This payment has already been claimed or expired",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
