/**
 * API Route: Create Privacy Cash Link
 * 
 * Sender chooses their privacy level:
 * - Basic: Sender → Eph → Pool (cheapest, sender traceable)
 * - Private: Sender → Pool → Eph → Pool (sender hidden via ZK)
 * 
 * Recipient chooses their privacy level when claiming.
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";
import {
  decodeCompositeSecret,
  type DoubleHopNote,
  type SenderPrivacy,
} from "@/lib/privacy/privacy-cash-adapter";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "devnet" | "mainnet-beta") || "devnet";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      amount,  // Pool amount (what recipient can claim from)
      compositeSecret: secretEncoded, 
      ephemeralAddress, 
      fundingTxHash,
      senderPrivacy: senderPrivacyRaw,
      senderAddress, // For reclaim feature
    } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid amount" },
        { status: 400 }
      );
    }

    // Validate and default sender privacy
    const senderPrivacy: SenderPrivacy = 
      (senderPrivacyRaw === "basic" || senderPrivacyRaw === "private") 
        ? senderPrivacyRaw 
        : "basic";

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

    console.log(`[API] Sender privacy: ${senderPrivacy}`);
    console.log(`[API] Pool amount: ${amount / 1e9} SOL`);
    
    // Verify ephemeral wallet has received the funds
    const ephemeralBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
    
    if (ephemeralBalance < amount) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Insufficient balance in ephemeral wallet. Expected ${amount / 1e9} SOL, got ${ephemeralBalance / 1e9} SOL. Transaction may still be processing.` 
        },
        { status: 400 }
      );
    }

    console.log(`[API] Ephemeral wallet balance: ${ephemeralBalance / 1e9} SOL`);
    console.log(`[API] Sender privacy: ${senderPrivacy}`);

    let depositTxHash: string | undefined;
    let fundsLocation: "ephemeral" | "pool";
    
    // 4. Conditionally deposit to Privacy Cash based on sender privacy
    if (senderPrivacy === "private") {
      // Private sender: deposit to pool for ZK privacy
      console.log(`[API] Private sender: depositing ${amount / 1e9} SOL to Privacy Cash pool`);
      
      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: true,
      });
      
      const depositResult = await privacyCashClient.deposit({
        lamports: amount,
      });

      depositTxHash = depositResult.tx;
      fundsLocation = "pool";
      console.log(`[API] Deposited to pool: ${depositTxHash}`);
    } else {
      // Basic sender: leave funds in ephemeral (no pool needed yet)
      console.log(`[API] Basic sender: funds staying in ephemeral wallet`);
      fundsLocation = "ephemeral";
    }

    // 5. Create the note
    const note: DoubleHopNote = {
      secret: compositeSecret.full,
      amount, // Amount available for recipient
      network: NETWORK,
      createdAt: Date.now(),
      ephemeralAddress,
      status: fundsLocation === "pool" ? "deposited" : "funded",
      senderPrivacy,
      senderAddress: senderPrivacy === "basic" ? senderAddress : undefined, // Only store for reclaim if basic
      fundsLocation,
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
