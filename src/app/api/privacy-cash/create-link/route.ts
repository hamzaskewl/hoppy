/**
 * API Route: Create Privacy Cash Link
 * 
 * TRUE SENDER PRIVACY IMPLEMENTATION:
 * 
 * - Basic: Sender → Eph1 (direct transfer, sender traceable to Eph1)
 *   Link contains: Eph1 keypair
 *   Recipient sees: who funded Eph1 (sender visible)
 * 
 * - Private: Sender → Eph1 → Pool → Eph2 (ZK withdrawal breaks link!)
 *   Link contains: Eph2 keypair (NOT Eph1!)
 *   Recipient sees: Pool → Eph2 (cannot trace to sender)
 *   Eph1 is never revealed to recipient
 * 
 * The key difference: for "private" mode, we generate a FRESH ephemeral (Eph2)
 * after the ZK withdrawal, and ONLY Eph2 goes in the link.
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";
import {
  decodeCompositeSecret,
  generateCompositeSecret,
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
    let withdrawTxHash: string | undefined;
    let fundsLocation: "ephemeral" | "pool";
    
    // These will hold the final secret/address for the link
    // For basic: Eph1 (sender traceable)
    // For private: Eph2 (sender hidden via ZK)
    let finalSecret: string;
    let finalEphemeralAddress: string;
    
    // 4. Conditionally process based on sender privacy
    if (senderPrivacy === "private") {
      // ================================================================
      // PRIVATE SENDER FLOW: Sender → Eph1 → Pool → Eph2
      // 
      // 1. Eph1 deposits to Privacy Cash pool
      // 2. Generate fresh Eph2 (this is what goes in the link!)
      // 3. Eph1 withdraws from pool → Eph2 (ZK breaks the link!)
      // 4. Link contains Eph2 - recipient cannot trace back to sender
      // ================================================================
      
      // SDK needs minimal buffer for tx fees (~0.003 SOL)
      const MIN_TX_BUFFER = 3_000_000; // ~0.003 SOL
      const depositAmount = Math.max(0, ephemeralBalance - MIN_TX_BUFFER);
      
      if (depositAmount <= 0) {
        return NextResponse.json(
          { success: false, error: "Balance too low to cover Privacy Cash overhead" },
          { status: 400 }
        );
      }
      
      // Privacy Cash fee structure: 0.006 SOL base + 0.35% of amount
      const PRIVACY_CASH_BASE_FEE = 6_000_000; // 0.006 SOL in lamports
      const PRIVACY_CASH_PERCENT_FEE = 0.0035; // 0.35%
      const withdrawalFee = PRIVACY_CASH_BASE_FEE + Math.floor(depositAmount * PRIVACY_CASH_PERCENT_FEE);
      
      // Ensure we have enough for the withdrawal fee
      if (depositAmount <= withdrawalFee + 1_000_000) {
        return NextResponse.json(
          { success: false, error: "Amount too small - need at least 0.01 SOL for private transfer" },
          { status: 400 }
        );
      }
      
      // Step 1: Create Privacy Cash client with Eph1 (sender's ephemeral)
      const eph1Client = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair, // Eph1
        enableDebug: true,
      });
      
      // Step 2: Deposit Eph1 → Pool
      let depositResult;
      let lastError: any = null;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          depositResult = await eph1Client.deposit({
            lamports: depositAmount,
          });
          break;
        } catch (depositError: any) {
          lastError = depositError;
          const isBlockhashError = 
            depositError.message?.includes("Blockhash not found") || 
            depositError.message?.includes("expired") ||
            depositError.message?.includes("blockhash");
          
          if (isBlockhashError && attempt < 3) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          throw depositError;
        }
      }
      
      if (!depositResult) {
        throw lastError || new Error("Deposit failed after 3 attempts");
      }
      
      depositTxHash = depositResult.tx;
      
      // Step 3: Generate fresh Eph2 - THIS IS THE KEY TO PRIVACY!
      // Eph2 is a completely new keypair that will appear in the link
      // Recipient will only ever see Eph2, never Eph1
      const eph2Secret = generateCompositeSecret();
      const eph2Address = eph2Secret.ephemeralKeypair.publicKey.toBase58();
      
      // Step 4: ZK Withdrawal from Pool → Eph2
      // This is what breaks the on-chain link!
      // On-chain, it will show: Pool → Eph2 (no trace to Eph1 or Sender)
      const withdrawAmount = depositAmount - withdrawalFee;
      
      let withdrawResult;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          withdrawResult = await eph1Client.withdraw({
            lamports: withdrawAmount,
            recipientAddress: eph2Address,
          });
          break;
        } catch (withdrawError: any) {
          lastError = withdrawError;
          const isBlockhashError = 
            withdrawError.message?.includes("Blockhash not found") || 
            withdrawError.message?.includes("expired") ||
            withdrawError.message?.includes("blockhash");
          
          if (isBlockhashError && attempt < 3) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          throw withdrawError;
        }
      }
      
      if (!withdrawResult) {
        throw lastError || new Error("ZK withdrawal to Eph2 failed after 3 attempts");
      }
      
      withdrawTxHash = withdrawResult.tx;
      
      // Funds are now in Eph2 (funded by the pool via ZK - untraceable!)
      fundsLocation = "ephemeral";
      amount = withdrawAmount; // What Eph2 actually received
      
      // Use Eph2's secret for the link (NOT Eph1!)
      finalSecret = eph2Secret.full;
      finalEphemeralAddress = eph2Address;
      
      // Step 5: Sweep any remaining Eph1 balance back to sender
      if (senderAddress) {
        try {
          const remainingBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
          const TX_FEE = 5000;
          
          if (remainingBalance > TX_FEE + 10000) {
            const { Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction } = await import("@solana/web3.js");
            const sweepTx = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: compositeSecret.ephemeralKeypair.publicKey,
                toPubkey: new PublicKey(senderAddress),
                lamports: remainingBalance - TX_FEE,
              })
            );
            await sendAndConfirmTransaction(connection, sweepTx, [compositeSecret.ephemeralKeypair], { commitment: "confirmed" });
          }
        } catch {
          // Sweep failed - non-critical, just dust left in Eph1
        }
      }
    } else {
      // ================================================================
      // BASIC SENDER FLOW: Sender → Eph1
      // 
      // Funds stay in Eph1, link contains Eph1's secret
      // Recipient CAN trace back to sender by looking up Eph1's funding tx
      // This is cheaper but not private for sender
      // ================================================================
      
      fundsLocation = "ephemeral";
      amount = ephemeralBalance;
      
      // Use Eph1's secret for the link
      finalSecret = compositeSecret.full;
      finalEphemeralAddress = ephemeralAddress;
    }

    // 5. Create the note with the correct secret (Eph1 for basic, Eph2 for private)
    const note: DoubleHopNote = {
      secret: finalSecret,
      amount,
      network: NETWORK,
      createdAt: Date.now(),
      ephemeralAddress: finalEphemeralAddress,
      status: "funded", // Funds are always in an ephemeral wallet now
      senderPrivacy,
      senderAddress: senderPrivacy === "basic" ? senderAddress : undefined, // Only store for reclaim if basic
      fundsLocation,
    };

    return NextResponse.json({
      success: true,
      note,
      fundingTxHash,
      depositTxHash,
      withdrawTxHash, // ZK withdrawal to Eph2 (only for private sender)
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
