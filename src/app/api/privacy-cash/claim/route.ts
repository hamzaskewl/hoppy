/**
 * API Route: Claim Privacy Cash Link
 * 
 * Recipient chooses their privacy level:
 * - Quick: Pool → Recipient (1 hop, sender can see)
 * - Private: Pool → Eph2 → Pool → Recipient (2 hops, hidden from everyone)
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";
import {
  decodeCompositeSecret,
  generateCompositeSecret,
  calculateRecipientReceives,
  RECIPIENT_PRIVACY,
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
    const privacyInfo = RECIPIENT_PRIVACY[recipientPrivacy];

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
    if (compositeSecret.ephemeralKeypair.publicKey.toBase58() !== doubleHopNote.ephemeralAddress) {
      return NextResponse.json(
        { success: false, error: "Ephemeral address mismatch" },
        { status: 400 }
      );
    }

    // ========================================================================
    // FLOW ROUTING: 4 possible combinations
    // ========================================================================
    
    const inPool = doubleHopNote.fundsLocation === "pool";
    const needsPrivacy = recipientPrivacy === "private";

    // Routing claim flow

    // ------------------------------------------------------------------------
    // FLOW 1: Funds in EPHEMERAL + QUICK recipient
    // Cheapest! Direct transfer, no pool needed
    // Sweep entire ephemeral balance minus tx fee
    // ------------------------------------------------------------------------
    if (!inPool && !needsPrivacy) {
      // Flow 1: Direct transfer
      
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

      // Transfer complete

      return NextResponse.json({
        success: true,
        withdrawTxHash: txHash,
        amountReceived: transferAmount,
        recipientPrivacy,
        hops: 0,
      });
    }

    // ------------------------------------------------------------------------
    // FLOW 2: Funds in EPHEMERAL + PRIVATE recipient  
    // Eph → Pool → Recipient
    // ------------------------------------------------------------------------
    if (!inPool && needsPrivacy) {
      // Flow 2: Ephemeral → Pool → Recipient

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
      
      // First deposit to pool
      await privacyCashClient.deposit({
        lamports: depositAmount,
      });

      // Then withdraw with ZK privacy (withdraw what we deposited)
      const withdrawResult = await privacyCashClient.withdraw({
        lamports: depositAmount,
        recipientAddress,
      });

      const receiveInfo = calculateRecipientReceives(depositAmount, "quick");

      return NextResponse.json({
        success: true,
        withdrawTxHash: withdrawResult.tx,
        amountReceived: receiveInfo.recipientReceives,
        recipientPrivacy,
        hops: 1,
      });
    }

    // ------------------------------------------------------------------------
    // FLOW 3: Funds in POOL + QUICK recipient
    // Pool → Recipient (simple withdrawal)
    // ------------------------------------------------------------------------
    if (inPool && !needsPrivacy) {
      // Flow 3: Pool → Recipient

      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: true,
      });

      const withdrawResult = await privacyCashClient.withdraw({
        lamports: doubleHopNote.amount,
        recipientAddress,
      });

      const receiveInfo = calculateRecipientReceives(doubleHopNote.amount, "quick");

      return NextResponse.json({
        success: true,
        withdrawTxHash: withdrawResult.tx,
        amountReceived: receiveInfo.recipientReceives,
        recipientPrivacy,
        hops: 1,
      });
    }

    // ------------------------------------------------------------------------
    // FLOW 4: Funds in POOL + PRIVATE recipient
    // Pool → Eph2 → Pool → Recipient (double ZK break)
    // ------------------------------------------------------------------------
    if (inPool && needsPrivacy) {
      // Flow 4: Double privacy hop

      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: true,
      });

      // Generate Eph2 for extra privacy hop
      const eph2Secret = generateCompositeSecret();
      const eph2Address = eph2Secret.ephemeralKeypair.publicKey.toBase58();

      // Routing through intermediate wallet

      // First withdrawal: Pool → Eph2
      await privacyCashClient.withdraw({
        lamports: doubleHopNote.amount,
        recipientAddress: eph2Address,
      });

      // First hop complete

      // Wait for Eph2 to receive funds
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Eph2 deposits to Pool
      const eph2Client = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: eph2Secret.ephemeralKeypair,
        enableDebug: true,
      });

      // Check actual Eph2 balance and deposit as much as possible
      // Eph2 only needs to cover tx fees since it just received funds and will deposit+withdraw
      const eph2Balance = await connection.getBalance(eph2Secret.ephemeralKeypair.publicKey);
      const MIN_TX_BUFFER = 3_000_000; // ~0.003 SOL - minimal buffer for tx fees
      const eph2DepositAmount = Math.max(0, eph2Balance - MIN_TX_BUFFER);
      
      if (eph2DepositAmount <= 0) {
        throw new Error("Eph2 balance too low to cover Privacy Cash overhead");
      }
      
      await eph2Client.deposit({
        lamports: eph2DepositAmount,
      });

      // Final withdrawal: Pool → Recipient (withdraw what we actually deposited)
      const finalWithdraw = await eph2Client.withdraw({
        lamports: eph2DepositAmount,
        recipientAddress,
      });

      const finalReceive = calculateRecipientReceives(eph2DepositAmount, "quick");
      console.log(`[API] Final withdrawal: ${finalWithdraw.tx}`);

      return NextResponse.json({
        success: true,
        withdrawTxHash: finalWithdraw.tx,
        amountReceived: finalReceive.recipientReceives,
        recipientPrivacy,
        hops: 2,
      });
    }

    // Should never reach here
    throw new Error("Invalid flow combination");
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
