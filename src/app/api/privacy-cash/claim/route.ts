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

    console.log(`[API] Claiming with recipient privacy: ${recipientPrivacy}`);
    console.log(`[API] Funds location: ${doubleHopNote.fundsLocation}`);
    console.log(`[API] Sender privacy: ${doubleHopNote.senderPrivacy}`);

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

    console.log(`[API] Flow: funds=${inPool ? 'pool' : 'ephemeral'}, recipient=${recipientPrivacy}`);

    // ------------------------------------------------------------------------
    // FLOW 1: Funds in EPHEMERAL + QUICK recipient
    // Cheapest! Direct transfer, no pool needed
    // Sweep entire ephemeral balance minus tx fee
    // ------------------------------------------------------------------------
    if (!inPool && !needsPrivacy) {
      console.log(`[API] Flow 1: Ephemeral → Recipient (direct transfer, full sweep)`);
      
      // Get actual ephemeral balance and sweep it all (minus tx fee)
      const ephemeralBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
      const TX_FEE = 5000; // Standard tx fee in lamports
      const transferAmount = Math.max(0, ephemeralBalance - TX_FEE);
      
      if (transferAmount <= 0) {
        throw new Error("Ephemeral wallet has insufficient balance for transfer");
      }
      
      console.log(`[API] Sweeping ephemeral: ${ephemeralBalance / 1e9} SOL → ${transferAmount / 1e9} SOL (${TX_FEE} lamports for tx fee)`);
      
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

      console.log(`[API] Direct transfer complete: ${txHash}`);

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
      console.log(`[API] Flow 2: Ephemeral → Pool → Recipient`);

      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: true,
      });

      // Check actual ephemeral balance and subtract SDK overhead
      const ephBalance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
      const SDK_OVERHEAD = 5_000_000; // ~0.005 SOL for tx fees + temp account rent
      const depositAmount = Math.max(0, ephBalance - SDK_OVERHEAD);
      
      if (depositAmount <= 0) {
        throw new Error("Ephemeral balance too low to cover Privacy Cash overhead");
      }
      
      console.log(`[API] Ephemeral balance: ${ephBalance / 1e9} SOL, depositing: ${depositAmount / 1e9} SOL`);
      
      // First deposit to pool
      await privacyCashClient.deposit({
        lamports: depositAmount,
      });
      console.log(`[API] Deposited ${depositAmount / 1e9} SOL to pool`);

      // Then withdraw with ZK privacy (withdraw what we deposited)
      const withdrawResult = await privacyCashClient.withdraw({
        lamports: depositAmount,
        recipientAddress,
      });

      const receiveInfo = calculateRecipientReceives(depositAmount, "quick");
      console.log(`[API] Withdrew to recipient: ${withdrawResult.tx}`);

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
      console.log(`[API] Flow 3: Pool → Recipient (ZK withdrawal)`);

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
      console.log(`[API] Withdrew to recipient: ${withdrawResult.tx}`);

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
      console.log(`[API] Flow 4: Pool → Eph2 → Pool → Recipient`);

      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: true,
      });

      // Generate Eph2 for extra privacy hop
      const eph2Secret = generateCompositeSecret();
      const eph2Address = eph2Secret.ephemeralKeypair.publicKey.toBase58();

      console.log(`[API] Routing through Eph2: ${eph2Address.slice(0, 8)}...`);

      // First withdrawal: Pool → Eph2
      await privacyCashClient.withdraw({
        lamports: doubleHopNote.amount,
        recipientAddress: eph2Address,
      });

      console.log(`[API] Withdrew to Eph2`);

      // Wait for Eph2 to receive funds
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Eph2 deposits to Pool
      const eph2Client = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: eph2Secret.ephemeralKeypair,
        enableDebug: true,
      });

      // Check actual Eph2 balance and subtract SDK overhead
      const eph2Balance = await connection.getBalance(eph2Secret.ephemeralKeypair.publicKey);
      const SDK_OVERHEAD = 5_000_000; // ~0.005 SOL for tx fees + temp account rent
      const eph2DepositAmount = Math.max(0, eph2Balance - SDK_OVERHEAD);
      
      if (eph2DepositAmount <= 0) {
        throw new Error("Eph2 balance too low to cover Privacy Cash overhead");
      }
      
      console.log(`[API] Eph2 balance: ${eph2Balance / 1e9} SOL, depositing: ${eph2DepositAmount / 1e9} SOL`);
      
      await eph2Client.deposit({
        lamports: eph2DepositAmount,
      });

      console.log(`[API] Eph2 deposited ${eph2DepositAmount / 1e9} SOL to Pool`);

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
