/**
 * API Route: Claim Privacy Cash Double Hop Link
 * 
 * This handles the server-side Privacy Cash withdrawal operations.
 * The entire deposit amount is withdrawn in a single transaction -
 * no sweep needed since we deposit everything to Privacy Cash.
 */

import { NextRequest, NextResponse } from "next/server";
import { PrivacyCash } from "privacycash";
import {
  decodeCompositeSecret,
  calculateTotalDeposit,
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
    // doubleHopNote.amount = what recipient should receive
    // deposit.depositAmount = what was actually deposited (includes fees)
    const deposit = calculateTotalDeposit(doubleHopNote.amount);

    // Withdraw from Privacy Cash
    // The relayer handles everything - no gas needed from ephemeral wallet
    const privacyCashClient = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: compositeSecret.ephemeralKeypair,
      enableDebug: true,
    });

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
