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
import { Connection, PublicKey } from "@solana/web3.js";
import { PrivacyCash } from "privacycash";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import bs58 from "bs58";
import {
  decodeCompositeSecret,
  generateCompositeSecret,
  type DoubleHopNote,
  type SenderPrivacy,
  type SupportedToken,
  getTokenInfo,
  SPL_SOL_BUFFER,
} from "@/lib/privacy/privacy-cash-adapter";
import { preseedUtxoOffset } from "@/lib/privacy/utxo-cache";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "devnet" | "mainnet-beta") || "devnet";

// Helper to get SPL token balance
async function getTokenBalance(connection: Connection, owner: PublicKey, mint: string): Promise<bigint> {
  try {
    const mintPubkey = new PublicKey(mint);
    const ata = await getAssociatedTokenAddress(mintPubkey, owner);
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch {
    return BigInt(0);
  }
}


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
      token: tokenRaw, // Token type (SOL, USDC, USDT)
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
    
    // Validate and default token (SOL for backwards compatibility)
    const token: SupportedToken = 
      (tokenRaw === "SOL" || tokenRaw === "USDC" || tokenRaw === "USDT")
        ? tokenRaw
        : "SOL";
    
    const tokenInfo = getTokenInfo(token);
    const isSOL = token === "SOL";

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
    const eph1Pubkey = compositeSecret.ephemeralKeypair.publicKey;
    const eph1Address = eph1Pubkey.toBase58();
    
    // For SOL: check SOL balance
    // For SPL: check token balance AND SOL balance (for gas)
    const solBalance = await connection.getBalance(eph1Pubkey);
    
    let tokenBalance: bigint = BigInt(0);
    if (!isSOL && tokenInfo.mint) {
      tokenBalance = await getTokenBalance(connection, eph1Pubkey, tokenInfo.mint);
      
      // For SPL tokens, we need both: token balance AND SOL for gas
      if (tokenBalance <= BigInt(0)) {
        return NextResponse.json(
          { 
            success: false, 
            error: `Ephemeral wallet has no ${token} balance. Funding transaction may still be processing.` 
          },
          { status: 400 }
        );
      }
      
      if (solBalance < SPL_SOL_BUFFER) {
        return NextResponse.json(
          { 
            success: false, 
            error: `Ephemeral wallet needs at least ${SPL_SOL_BUFFER / 1e9} SOL for gas fees. Current: ${solBalance / 1e9} SOL` 
          },
          { status: 400 }
        );
      }
    } else {
      // For SOL
      if (solBalance <= 0) {
        return NextResponse.json(
          { 
            success: false, 
            error: `Ephemeral wallet has no balance. Expected ~${amount / 1e9} SOL. Funding transaction may still be processing.` 
          },
          { status: 400 }
        );
      }
    }
    
    // Use the appropriate balance
    const ephemeralBalance = isSOL ? solBalance : Number(tokenBalance);

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
      
      // For SOL: leave buffer for tx fees
      // For SPL: use full token balance (SOL is separate for gas)
      const MIN_TX_BUFFER = isSOL ? 3_000_000 : 0; // ~0.003 SOL buffer for native SOL only
      const depositAmount = Math.max(0, ephemeralBalance - MIN_TX_BUFFER);
      
      // Privacy Cash fee: ~0.006 SOL base + 0.35% = minimum ~0.007 SOL for small amounts
      // For USDC: minimum ~$0.10 worth
      const MIN_AMOUNT_FOR_PRIVATE = isSOL ? 10_000_000 : 100_000; // 0.01 SOL or 0.1 USDC
      
      if (depositAmount <= MIN_AMOUNT_FOR_PRIVATE) {
        const minDisplay = isSOL ? "0.01 SOL" : `0.1 ${token}`;
        return NextResponse.json(
          { success: false, error: `Amount too small - need at least ${minDisplay} for private transfer` },
          { status: 400 }
        );
      }
      
      // Pre-seed UTXO offset so the SDK skips scanning all existing UTXOs
      await preseedUtxoOffset(compositeSecret.ephemeralKeypair.publicKey.toBase58());

      // Step 1: Create Privacy Cash client with Eph1 (sender's ephemeral)
      const eph1Client = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair, // Eph1
        enableDebug: false,
      });
      
      // Step 2: Deposit Eph1 → Pool (SOL or SPL)
      let depositResult;
      let lastError: any = null;
      
      // For SPL tokens, Privacy Cash expects amounts in WHOLE TOKENS, not base units
      // e.g., 10 USDC = 10 (not 10,000,000)
      const depositAmountForSDK = isSOL 
        ? depositAmount 
        : depositAmount / (10 ** tokenInfo.decimals);
      
      const TX_TIMEOUT_MS = 60_000; // 60s max per SDK call
      const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
        Promise.race([
          promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${TX_TIMEOUT_MS / 1000}s`)), TX_TIMEOUT_MS)
          ),
        ]);

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (isSOL) {
            depositResult = await withTimeout(eph1Client.deposit({
              lamports: depositAmount,
            }), 'deposit');
          } else {
            // SPL token deposit - amount in whole tokens
            depositResult = await withTimeout(eph1Client.depositSPL({
              amount: depositAmountForSDK,
              mintAddress: tokenInfo.mint!,
            }), 'depositSPL');
          }
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
      // 
      // IMPORTANT: Pass the FULL depositAmount to withdraw. The SDK will:
      // 1. Drain the entire UTXO (no change left behind)
      // 2. Deduct its fee automatically
      // 3. Send (depositAmount - fee) to Eph2
      
      let withdrawResult;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (isSOL) {
            withdrawResult = await eph1Client.withdraw({
              lamports: depositAmount, // Full amount - SDK handles fee deduction
              recipientAddress: eph2Address,
            });
          } else {
            // SPL token withdrawal - amount in whole tokens
            withdrawResult = await eph1Client.withdrawSPL({
              amount: depositAmountForSDK, // Use whole tokens, not base units
              mintAddress: tokenInfo.mint!,
              recipientAddress: eph2Address,
            });
          }
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
      // Wait a moment for the withdrawal to be confirmed
      await new Promise(r => setTimeout(r, 2000));
      
      // For SPL tokens: Eph2 only received tokens, NO SOL for gas!
      // Use Hoppy relayer to send SOL to Eph2 (preserves privacy - no link from Eph1 to Eph2)
      if (!isSOL) {
        const RELAYER_PRIVATE_KEY = process.env.HOPPY_RELAYER_PRIVATE_KEY;
        const SOL_FOR_EPH2 = 3_000_000; // 0.003 SOL for recipient to claim
        
        if (RELAYER_PRIVATE_KEY) {
          try {
            const { Transaction, SystemProgram, Keypair, sendAndConfirmTransaction } = await import("@solana/web3.js");
            const relayerKeypair = Keypair.fromSecretKey(bs58.decode(RELAYER_PRIVATE_KEY));
            
            // Verify Eph2 actually has tokens before sending SOL (prevent abuse)
            const eph2TokenBalance = await getTokenBalance(
              connection, 
              eph2Secret.ephemeralKeypair.publicKey, 
              tokenInfo.mint!
            );
            
            if (eph2TokenBalance > BigInt(0)) {
              // Check relayer has enough balance
              const relayerBalance = await connection.getBalance(relayerKeypair.publicKey);
              const MIN_RELAYER_BALANCE = 20_000_000; // 0.02 SOL minimum
              
              if (relayerBalance > MIN_RELAYER_BALANCE + SOL_FOR_EPH2) {
                const relayerTx = new Transaction().add(
                  SystemProgram.transfer({
                    fromPubkey: relayerKeypair.publicKey,
                    toPubkey: eph2Secret.ephemeralKeypair.publicKey,
                    lamports: SOL_FOR_EPH2,
                  })
                );
                await sendAndConfirmTransaction(connection, relayerTx, [relayerKeypair], { commitment: "confirmed" });
              } else {
                // Relayer balance too low - log warning but don't fail the transaction
                console.warn("[Relayer] Balance too low to subsidize gas. User will need to fund Eph2 manually.");
              }
            }
          } catch (relayerError) {
            // Relayer failed - non-critical, log and continue
            console.error("[Relayer] Failed to send SOL to Eph2:", relayerError);
          }
        }
      }
      
      // Get actual Eph2 balance to know what recipient can claim
      let eph2Balance: number;
      if (isSOL) {
        eph2Balance = await connection.getBalance(eph2Secret.ephemeralKeypair.publicKey);
      } else {
        const eph2TokenBalance = await getTokenBalance(
          connection, 
          eph2Secret.ephemeralKeypair.publicKey, 
          tokenInfo.mint!
        );
        eph2Balance = Number(eph2TokenBalance);
      }
      
      fundsLocation = "ephemeral";
      amount = eph2Balance; // Actual amount Eph2 received (after SDK fee deduction)
      
      // Use Eph2's secret for the link (NOT Eph1!)
      finalSecret = eph2Secret.full;
      finalEphemeralAddress = eph2Address;
      
      // Step 5: Sweep any remaining Eph1 SOL balance back to sender
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
      // Token info (defaults to SOL for backwards compatibility)
      token,
      tokenMint: tokenInfo.mint,
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
