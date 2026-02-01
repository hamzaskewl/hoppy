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

    // Processing sender request
    
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

    // Balance verified

    let depositTxHash: string | undefined;
    let fundsLocation: "ephemeral" | "pool";
    
    // 4. Conditionally deposit to Privacy Cash based on sender privacy
    if (senderPrivacy === "private") {
      // SDK needs minimal buffer for tx fees (~0.002-0.003 SOL based on observed errors)
      // We want to deposit as much as possible to maximize pool amount
      const MIN_TX_BUFFER = 3_000_000; // ~0.003 SOL - minimal buffer for tx fees
      const depositAmount = Math.max(0, ephemeralBalance - MIN_TX_BUFFER);
      
      if (depositAmount <= 0) {
        return NextResponse.json(
          { success: false, error: "Balance too low to cover Privacy Cash overhead" },
          { status: 400 }
        );
      }
      
      // Private sender: preparing deposit
      
      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: true,
      });
      
      let depositResult;
      let lastError: any = null;
      
      // Retry up to 3 times for blockhash issues
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          depositResult = await privacyCashClient.deposit({
            lamports: depositAmount,
          });
          break; // Success, exit loop
        } catch (depositError: any) {
          lastError = depositError;
          const isBlockhashError = 
            depositError.message?.includes("Blockhash not found") || 
            depositError.message?.includes("expired") ||
            depositError.message?.includes("blockhash");
          
          if (isBlockhashError && attempt < 3) {
            await new Promise(r => setTimeout(r, 2000)); // Wait 2 seconds
            continue;
          }
          throw depositError;
        }
      }
      
      if (!depositResult) {
        throw lastError || new Error("Deposit failed after 3 attempts");
      }

      depositTxHash = depositResult.tx;
      fundsLocation = "pool";
      // Update amount to what was actually deposited
      amount = depositAmount;
      
      // Sweep any remainder back to sender if possible
      // Note: To close the ephemeral account and recover rent, we need to transfer ALL funds
      // The minimum rent-exempt balance is ~890,880 lamports
      if (senderAddress) {
        try {
          const remainingBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
          const TX_FEE = 5000;
          const MIN_RENT_EXEMPT = 890880; // ~0.00089 SOL
          
          // Only sweep if we can send more than dust AND close the account
          // To close account: send ALL balance - TX_FEE, account will be closed
          if (remainingBalance > MIN_RENT_EXEMPT + TX_FEE) {
            const sweepAmount = remainingBalance - TX_FEE;
            const { Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction } = await import("@solana/web3.js");
            const sweepTx = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: compositeSecret.ephemeralKeypair.publicKey,
                toPubkey: new PublicKey(senderAddress),
                lamports: sweepAmount,
              })
            );
            await sendAndConfirmTransaction(connection, sweepTx, [compositeSecret.ephemeralKeypair], { commitment: "confirmed" });
          }
        } catch {
          // Sweep failed - non-critical
        }
      }
    } else {
      // Basic sender: leave funds in ephemeral (no pool needed yet)
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
    // Error creating link
    
    // Build error response with recovery info
    const errorResponse: any = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create link",
    };
    
    // Try to get ephemeral key for recovery
    let secret: any = null;
    let recoveryAttempted = false;
    
    try {
      const body = await request.clone().json().catch(() => ({}));
      
      if (body.compositeSecret) {
        const { decodeCompositeSecret } = await import("@/lib/privacy/privacy-cash-adapter");
        const bs58 = await import("bs58");
        secret = decodeCompositeSecret(body.compositeSecret);
        
        if (secret) {
          // Include ephemeral address for tracking (but NOT private key)
          errorResponse.ephemeralAddress = secret.ephemeralKeypair.publicKey.toBase58();
          
          // Try to sweep funds back to sender automatically
          if (body.senderAddress) {
            recoveryAttempted = true;
            try {
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
                const sweepSig = await sendAndConfirmTransaction(conn, sweepTx, [secret.ephemeralKeypair], { commitment: "confirmed" });
                // Funds auto-recovered
                errorResponse.recoverySweepTx = sweepSig;
                errorResponse.recoverySuccess = true;
                errorResponse.sweptAmount = balance - TX_FEE;
              } else {
                errorResponse.ephemeralBalance = balance;
                errorResponse.recoverySuccess = false;
                errorResponse.recoveryNote = "Balance too low to sweep automatically";
              }
            } catch (sweepErr) {
              console.warn("[API] Error recovery sweep failed:", sweepErr);
              errorResponse.recoverySuccess = false;
              errorResponse.sweepError = sweepErr instanceof Error ? sweepErr.message : "Sweep failed";
            }
          }
        }
      }
    } catch {
      // Could not parse request for recovery
    }
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
