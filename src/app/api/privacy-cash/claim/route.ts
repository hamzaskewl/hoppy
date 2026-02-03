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
import { Connection, Transaction, SystemProgram, sendAndConfirmTransaction, PublicKey, Keypair } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";
import { 
  getAssociatedTokenAddress, 
  getAccount, 
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  decodeCompositeSecret,
  type DoubleHopNote,
  type RecipientPrivacy,
  getTokenInfo,
  type SupportedToken,
} from "@/lib/privacy/privacy-cash-adapter";
import bs58 from "bs58";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Sweep leftover SOL from ephemeral back to relayer (non-blocking)
async function sweepToRelayer(ephemeralKeypair: Keypair) {
  try {
    const RELAYER_PRIVATE_KEY = process.env.HOPPY_RELAYER_PRIVATE_KEY;
    if (!RELAYER_PRIVATE_KEY) return;
    
    const relayerKeypair = Keypair.fromSecretKey(bs58.decode(RELAYER_PRIVATE_KEY));
    const balance = await connection.getBalance(ephemeralKeypair.publicKey);
    
    // Only sweep if there's enough to cover tx fee + have something left
    const TX_FEE = 5000;
    const MIN_SWEEP = 100_000; // 0.0001 SOL minimum to bother sweeping
    
    if (balance > TX_FEE + MIN_SWEEP) {
      const sweepAmount = balance - TX_FEE;
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: ephemeralKeypair.publicKey,
          toPubkey: relayerKeypair.publicKey,
          lamports: sweepAmount,
        })
      );
      await sendAndConfirmTransaction(connection, tx, [ephemeralKeypair], { commitment: "confirmed" });
    }
  } catch {
    // Non-critical - just log and continue
    console.warn("[Claim] Failed to sweep leftover SOL to relayer");
  }
}

// Helper to get SPL token balance
async function getTokenBalance(owner: PublicKey, mint: string): Promise<bigint> {
  try {
    const mintPubkey = new PublicKey(mint);
    const ata = await getAssociatedTokenAddress(mintPubkey, owner);
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch {
    return BigInt(0);
  }
}

// Helper to check if ATA exists
async function ataExists(owner: PublicKey, mint: string): Promise<boolean> {
  try {
    const mintPubkey = new PublicKey(mint);
    const ata = await getAssociatedTokenAddress(mintPubkey, owner);
    await getAccount(connection, ata);
    return true;
  } catch {
    return false;
  }
}

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

    // Get token info from note (defaults to SOL for backwards compatibility)
    const token: SupportedToken = doubleHopNote.token || "SOL";
    const tokenInfo = getTokenInfo(token);
    const isSOL = token === "SOL";

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
      const recipientPubkey = new PublicKey(recipientAddress);
      const ephPubkey = compositeSecret.ephemeralKeypair.publicKey;
      
      if (isSOL) {
        // SOL: Get actual ephemeral balance and sweep it all (minus tx fee)
        const ephemeralBalance = await connection.getBalance(ephPubkey);
        const TX_FEE = 5000; // Standard tx fee in lamports
        const transferAmount = Math.max(0, ephemeralBalance - TX_FEE);
        
        if (transferAmount <= 0) {
          throw new Error("Ephemeral wallet has insufficient balance for transfer");
        }
        
        // Sweeping ephemeral SOL to recipient
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: ephPubkey,
            toPubkey: recipientPubkey,
            lamports: transferAmount,
          })
        );

        const txHash = await sendAndConfirmTransaction(
          connection,
          tx,
          [compositeSecret.ephemeralKeypair],
          { commitment: "confirmed" }
        );

        return NextResponse.json({
          success: true,
          withdrawTxHash: txHash,
          amountReceived: transferAmount,
          recipientPrivacy,
          hops: 0,
          token,
        });
      } else {
        // SPL Token: Transfer token from ephemeral to recipient
        const mintPubkey = new PublicKey(tokenInfo.mint!);
        const ephAta = await getAssociatedTokenAddress(mintPubkey, ephPubkey);
        const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
        
        // Get token balance
        const tokenBalance = await getTokenBalance(ephPubkey, tokenInfo.mint!);
        if (tokenBalance <= BigInt(0)) {
          throw new Error(`Ephemeral wallet has no ${token} balance`);
        }
        
        const tx = new Transaction();
        
        // Create recipient ATA if needed
        const recipientAtaExists = await ataExists(recipientPubkey, tokenInfo.mint!);
        if (!recipientAtaExists) {
          tx.add(
            createAssociatedTokenAccountInstruction(
              ephPubkey, // payer
              recipientAta,
              recipientPubkey,
              mintPubkey
            )
          );
        }
        
        // Transfer all tokens
        tx.add(
          createTransferInstruction(
            ephAta,
            recipientAta,
            ephPubkey,
            tokenBalance,
            [],
            TOKEN_PROGRAM_ID
          )
        );

        const txHash = await sendAndConfirmTransaction(
          connection,
          tx,
          [compositeSecret.ephemeralKeypair],
          { commitment: "confirmed" }
        );

        // Sweep leftover SOL back to relayer (non-blocking)
        sweepToRelayer(compositeSecret.ephemeralKeypair).catch(() => {});

        return NextResponse.json({
          success: true,
          withdrawTxHash: txHash,
          amountReceived: Number(tokenBalance),
          recipientPrivacy,
          hops: 0,
          token,
        });
      }
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
      const ephPubkey = compositeSecret.ephemeralKeypair.publicKey;

      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: false,
      });

      if (isSOL) {
        // SOL: Check actual ephemeral balance and subtract SDK overhead
        const ephBalance = await connection.getBalance(ephPubkey);
        const MIN_TX_BUFFER = 3_000_000; // ~0.003 SOL - minimal buffer for tx fees
        const depositAmount = Math.max(0, ephBalance - MIN_TX_BUFFER);
        
        if (depositAmount <= 0) {
          throw new Error("Ephemeral balance too low to cover Privacy Cash overhead");
        }
        
        // First deposit to pool (free, no fee)
        await privacyCashClient.deposit({
          lamports: depositAmount,
        });

        // Withdraw with ZK privacy
        const withdrawResult = await privacyCashClient.withdraw({
          lamports: depositAmount,
          recipientAddress,
        });

        // Sweep leftover SOL back to relayer (non-blocking)
        sweepToRelayer(compositeSecret.ephemeralKeypair).catch(() => {});

        return NextResponse.json({
          success: true,
          withdrawTxHash: withdrawResult.tx,
          amountReceived: depositAmount,
          recipientPrivacy,
          hops: 1,
          token,
        });
      } else {
        // SPL Token: Deposit and withdraw via Privacy Cash SPL methods
        const tokenBalance = await getTokenBalance(ephPubkey, tokenInfo.mint!);
        
        if (tokenBalance <= BigInt(0)) {
          throw new Error(`Ephemeral wallet has no ${token} balance`);
        }
        
        const depositAmountBaseUnits = Number(tokenBalance);
        // Privacy Cash expects amounts in WHOLE TOKENS, not base units
        const depositAmountWholeTokens = depositAmountBaseUnits / (10 ** tokenInfo.decimals);
        
        // Deposit SPL to pool
        await privacyCashClient.depositSPL({
          amount: depositAmountWholeTokens,
          mintAddress: tokenInfo.mint!,
        });

        // Withdraw SPL with ZK privacy
        const withdrawResult = await privacyCashClient.withdrawSPL({
          amount: depositAmountWholeTokens,
          mintAddress: tokenInfo.mint!,
          recipientAddress,
        });

        // Sweep leftover SOL back to relayer (non-blocking)
        sweepToRelayer(compositeSecret.ephemeralKeypair).catch(() => {});

        return NextResponse.json({
          success: true,
          withdrawTxHash: withdrawResult.tx,
          amountReceived: depositAmountBaseUnits, // Return in base units for UI consistency
          recipientPrivacy,
          hops: 1,
          token,
        });
      }
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
