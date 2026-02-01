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
      amount: requestedAmount,  // Pool amount (what recipient can claim from)
      compositeSecret: secretEncoded, 
      ephemeralAddress, 
      fundingTxHash,
      senderPrivacy: senderPrivacyRaw,
      senderAddress, // For reclaim feature
    } = body;

    // Mutable: may be adjusted if we need to leave rent reserve
    let amount = requestedAmount as number;

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
    
    // Verify ephemeral wallet has received funds
    const ephemeralBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
    
    if (ephemeralBalance <= 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Ephemeral wallet has no balance. Expected ~${amount / 1e9} SOL. Funding transaction may still be processing.` 
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
      // SDK needs: ~5000 lamports tx fee + ~0.00089 SOL per UTXO account rent (2 accounts)
      // Minimum overhead: ~1.8M lamports, use 2M to be safe
      const SDK_OVERHEAD = 2_000_000; // ~0.002 SOL
      const depositAmount = Math.max(0, ephemeralBalance - SDK_OVERHEAD);
      
      if (depositAmount <= 0) {
        return NextResponse.json(
          { success: false, error: "Balance too low to cover Privacy Cash overhead" },
          { status: 400 }
        );
      }
      
      console.log(`[API] Private sender: depositing ${depositAmount / 1e9} SOL (balance: ${ephemeralBalance / 1e9}, SDK overhead reserve: ${SDK_OVERHEAD / 1e9})`);
      
      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: true,
      });
      
      let depositResult;
      try {
        depositResult = await privacyCashClient.deposit({
          lamports: depositAmount,
        });
      } catch (depositError: any) {
        // If blockhash expired during the long UTXO scan, try one immediate retry
        if (depositError.message?.includes("Blockhash not found") || depositError.message?.includes("expired")) {
          console.warn("[API] Blockhash expired during UTXO scan, retrying deposit...");
          depositResult = await privacyCashClient.deposit({
            lamports: depositAmount,
          });
        } else {
          throw depositError;
        }
      }

      depositTxHash = depositResult.tx;
      fundsLocation = "pool";
      // Update amount to what was actually deposited
      amount = depositAmount;
      console.log(`[API] Deposited to pool: ${depositTxHash}`);
      
      // Sweep any remainder back to sender if possible
      if (senderAddress) {
        try {
          const remainingBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
          const TX_FEE = 5000;
          if (remainingBalance > TX_FEE + 1000) { // Only sweep if worth it (> ~$0.001)
            const { Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction } = await import("@solana/web3.js");
            const sweepTx = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: compositeSecret.ephemeralKeypair.publicKey,
                toPubkey: new PublicKey(senderAddress),
                lamports: remainingBalance - TX_FEE,
              })
            );
            await sendAndConfirmTransaction(connection, sweepTx, [compositeSecret.ephemeralKeypair], { commitment: "confirmed" });
            console.log(`[API] Swept ${(remainingBalance - TX_FEE) / 1e9} SOL back to sender`);
          }
        } catch (sweepError) {
          console.warn("[API] Failed to sweep remainder (non-critical):", sweepError);
        }
      }
    } else {
      // Basic sender: leave funds in ephemeral (no pool needed yet)
      // Store actual ephemeral balance as the amount (will be swept on claim)
      console.log(`[API] Basic sender: funds staying in ephemeral wallet (${ephemeralBalance / 1e9} SOL)`);
      fundsLocation = "ephemeral";
      amount = ephemeralBalance; // Use actual balance, not requested amount
    }

    // 5. Create the note
    const note: DoubleHopNote = {
      secret: compositeSecret.full,
      amount, // Actual amount available for recipient (may be slightly less due to rent reserve)
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
    
    // Try to sweep any remaining funds back to sender on failure
    // This requires we have the composite secret and sender address
    const body = await request.clone().json().catch(() => ({}));
    if (body.compositeSecret && body.senderAddress) {
      try {
        const { decodeCompositeSecret } = await import("@/lib/privacy/privacy-cash-adapter");
        const secret = decodeCompositeSecret(body.compositeSecret);
        if (secret) {
          const conn = new Connection(RPC_URL, "confirmed");
          const balance = await conn.getBalance(secret.ephemeralKeypair.publicKey);
          const TX_FEE = 5000;
          if (balance > TX_FEE + 1000) {
            const { Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction } = await import("@solana/web3.js");
            const sweepTx = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: secret.ephemeralKeypair.publicKey,
                toPubkey: new PublicKey(body.senderAddress),
                lamports: balance - TX_FEE,
              })
            );
            await sendAndConfirmTransaction(conn, sweepTx, [secret.ephemeralKeypair], { commitment: "confirmed" });
            console.log(`[API] Error recovery: swept ${(balance - TX_FEE) / 1e9} SOL back to sender`);
          }
        }
      } catch (sweepErr) {
        console.warn("[API] Error recovery sweep failed:", sweepErr);
      }
    }
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create link",
      },
      { status: 500 }
    );
  }
}
