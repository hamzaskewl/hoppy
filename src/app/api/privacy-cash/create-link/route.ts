/**
 * API Route: Create Privacy Cash Double Hop Link
 * 
 * This handles the server-side Privacy Cash operations since the SDK
 * requires Node.js modules that can't be bundled for the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";
import {
  decodeCompositeSecret,
  calculateTotalDeposit,
  type DoubleHopNote,
} from "@/lib/privacy/privacy-cash-adapter";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "devnet" | "mainnet-beta") || "devnet";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, compositeSecret: secretEncoded, ephemeralAddress, fundingTxHash } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid amount" },
        { status: 400 }
      );
    }

    if (!secretEncoded || !ephemeralAddress || !fundingTxHash) {
      return NextResponse.json(
        { success: false, error: "Missing composite secret, ephemeral address, or funding transaction hash" },
        { status: 400 }
      );
    }

    const connection = new Connection(RPC_URL, "confirmed");

    // Decode composite secret (already generated client-side)
    const compositeSecret = decodeCompositeSecret(secretEncoded);
    if (!compositeSecret) {
      return NextResponse.json(
        { success: false, error: "Invalid composite secret" },
        { status: 400 }
      );
    }

    // Verify ephemeral address matches
    if (compositeSecret.ephemeralKeypair.publicKey.toBase58() !== ephemeralAddress) {
      return NextResponse.json(
        { success: false, error: "Ephemeral address mismatch" },
        { status: 400 }
      );
    }

    // Verify funding transaction was confirmed
    let fundingTxStatus = await connection.getSignatureStatus(fundingTxHash);
    if (!fundingTxStatus.value || fundingTxStatus.value.err) {
      return NextResponse.json(
        { success: false, error: "Funding transaction failed or not confirmed" },
        { status: 400 }
      );
    }

    // Wait for transaction to be fully finalized (Privacy Cash needs confirmed balance)
    let retries = 0;
    while (retries < 10 && (!fundingTxStatus.value || fundingTxStatus.value.confirmationStatus !== "finalized")) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      fundingTxStatus = await connection.getSignatureStatus(fundingTxHash);
      retries++;
    }

    // Calculate deposit requirements
    const deposit = calculateTotalDeposit(amount);
    
    // Verify ephemeral wallet has received the funds
    const ephemeralBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
    
    if (ephemeralBalance < deposit.depositAmount) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Insufficient balance in ephemeral wallet. Expected ${deposit.depositAmount / 1e9} SOL, got ${ephemeralBalance / 1e9} SOL. Transaction may still be processing.` 
        },
        { status: 400 }
      );
    }

    console.log(`[API] Ephemeral wallet balance: ${ephemeralBalance / 1e9} SOL`);
    console.log(`[API] Depositing to Privacy Cash: ${deposit.depositAmount / 1e9} SOL`);
    console.log(`[API] Recipient will receive: ${deposit.recipientAmount / 1e9} SOL`);

    // 4. Ephemeral deposits to Privacy Cash
    const privacyCashClient = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: compositeSecret.ephemeralKeypair,
      enableDebug: true,
    });
    
    const depositResult = await privacyCashClient.deposit({
      lamports: deposit.depositAmount,
    });

    const depositTxHash = depositResult.tx || depositResult.txHash || depositResult.signature || "deposit-tx";

    // 5. Create the note
    const note: DoubleHopNote = {
      secret: compositeSecret.full,
      amount,
      network: NETWORK,
      createdAt: Date.now(),
      ephemeralAddress,
      status: "deposited",
    };

    return NextResponse.json({
      success: true,
      note,
      fundingTxHash,
      depositTxHash,
    });
  } catch (error) {
    console.error("[API] Create link error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create link",
      },
      { status: 500 }
    );
  }
}
