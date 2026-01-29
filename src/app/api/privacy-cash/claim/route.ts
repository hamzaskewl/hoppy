/**
 * API Route: Claim Privacy Cash Link
 * 
 * Handles different privacy levels:
 * - Basic/Private: Withdraw directly to recipient
 * - Maximum: Withdraw to Eph2 (recipient-generated), recipient does final hop
 */

import { NextRequest, NextResponse } from "next/server";
import { PrivacyCash } from "privacycash";
import {
  decodeCompositeSecret,
  calculateTotalDeposit,
  generateCompositeSecret,
  PRIVACY_LEVELS,
  type DoubleHopNote,
} from "@/lib/privacy/privacy-cash-adapter";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { note, recipientAddress } = body;

    if (!note || !recipientAddress) {
      return NextResponse.json(
        { success: false, error: "Missing note or recipient address" },
        { status: 400 }
      );
    }

    const doubleHopNote = note as DoubleHopNote;
    const privacyLevel = doubleHopNote.privacyLevel || "basic";
    const levelInfo = PRIVACY_LEVELS[privacyLevel];

    console.log(`[API] Claiming with privacy level: ${privacyLevel}`);

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

    // Calculate how much was deposited to Privacy Cash
    const deposit = calculateTotalDeposit(doubleHopNote.amount, privacyLevel);

    // Initialize Privacy Cash client
    const privacyCashClient = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: compositeSecret.ephemeralKeypair,
      enableDebug: true,
    });

    // For MAXIMUM privacy: withdraw to a fresh Eph2, recipient does final hop
    if (privacyLevel === "maximum") {
      // Generate Eph2 for the recipient
      const eph2Secret = generateCompositeSecret();
      const eph2Address = eph2Secret.ephemeralKeypair.publicKey.toBase58();

      console.log(`[API] Maximum privacy: withdrawing to Eph2 ${eph2Address.slice(0, 8)}...`);
      console.log(`[API] Recipient will need to do final hop from Eph2`);

      // Withdraw to Eph2 (not final recipient)
      const withdrawResult = await privacyCashClient.withdraw({
        lamports: deposit.depositAmount,
        recipientAddress: eph2Address,
      });

      const withdrawTxHash = withdrawResult.tx || withdrawResult.txHash || withdrawResult.signature || "withdraw-tx";
      console.log(`[API] Withdrew to Eph2: ${withdrawTxHash}`);

      // Now Eph2 deposits to Privacy Cash
      const eph2Client = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: eph2Secret.ephemeralKeypair,
        enableDebug: true,
      });

      // Wait for Eph2 to receive funds
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Eph2 deposits to Pool
      const eph2DepositResult = await eph2Client.deposit({
        lamports: Math.floor(deposit.depositAmount * 0.99), // Account for first withdrawal fee
      });

      console.log(`[API] Eph2 deposited to Pool`);

      // Calculate what's left after 2 hops of fees
      const finalAmount = Math.floor(doubleHopNote.amount * 0.993); // Approximate after 2 withdrawal fees

      // Eph2 withdraws to final recipient
      const finalWithdrawResult = await eph2Client.withdraw({
        lamports: Math.floor(deposit.depositAmount * 0.99),
        recipientAddress,
      });

      const finalTxHash = finalWithdrawResult.tx || finalWithdrawResult.txHash || finalWithdrawResult.signature || "final-tx";
      console.log(`[API] Final withdrawal to recipient: ${finalTxHash}`);

      return NextResponse.json({
        success: true,
        withdrawTxHash: finalTxHash,
        amountReceived: finalAmount,
        privacyLevel,
        hops: 3,
      });
    }

    // For BASIC and PRIVATE: withdraw directly to recipient
    console.log(`[API] Withdrawing ${deposit.depositAmount / 1e9} SOL from Privacy Cash`);
    console.log(`[API] Recipient ${recipientAddress} should receive ~${doubleHopNote.amount / 1e9} SOL`);
    
    const withdrawResult = await privacyCashClient.withdraw({
      lamports: deposit.depositAmount,
      recipientAddress,
    });

    const withdrawTxHash = withdrawResult.tx || withdrawResult.txHash || withdrawResult.signature || "withdraw-tx";
    console.log(`[API] Privacy Cash withdrawal complete: ${withdrawTxHash}`);

    return NextResponse.json({
      success: true,
      withdrawTxHash,
      amountReceived: doubleHopNote.amount,
      privacyLevel,
      hops: levelInfo.hops,
    });
  } catch (error) {
    console.error("[API] Claim error:", error);
    
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
