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
 * - Private Partial: Eph → EphRemainder → Pool → partial to Recipient, remainder stays in pool
 * 
 * PRIVACY GUARANTEES:
 * - Private sender + Quick recipient: Sender hidden, recipient visible to sender
 * - Private sender + Private recipient: FULL PRIVACY - no one can link anyone
 * - Basic sender + Private recipient: Sender visible to recipient, recipient hidden
 * - Basic sender + Quick recipient: No privacy (cheapest option)
 * 
 * PARTIAL CLAIMS (Private only):
 * - User can claim a portion and get a new link for the remainder
 * - Flow: Eph → EphRemainder → Pool → partial withdraw → remainder stays in pool
 * - New link has EphRemainder secret, funds already in pool (no deposit needed)
 * - Original sender cannot access remainder (doesn't have EphRemainder keypair)
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
  generateCompositeSecret,
  createDoubleHopClaimUrl,
  type DoubleHopNote,
  type RecipientPrivacy,
  getTokenInfo,
  type SupportedToken,
} from "@/lib/privacy/privacy-cash-adapter";
import bs58 from "bs58";
import { preseedUtxoOffset } from "@/lib/privacy/utxo-cache";
import { incrementLinksClaimed } from "@/lib/card/db";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://hoppy.cash";
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
    const { 
      note, 
      recipientAddress, 
      recipientPrivacy: recipientPrivacyRaw,
      partialAmount: partialAmountRaw,  // Optional: if set, do partial claim (private only)
    } = body;

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

    // Parse partial amount (ensure it's a number)
    const partialAmount = typeof partialAmountRaw === 'number' ? partialAmountRaw : parseInt(partialAmountRaw) || 0;
    
    // Partial claims only allowed for private recipient
    const isPartialClaim = partialAmount > 0 && recipientPrivacy === "private";
    
    console.log("[Claim] Request:", { 
      recipientPrivacy, 
      partialAmountRaw, 
      partialAmount,
      isPartialClaim,
      noteAmount: note?.amount,
      fundsLocation: note?.fundsLocation 
    });

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
    // FLOW ROUTING: Based on recipientPrivacy and fundsLocation
    // 
    // Funds can be in:
    // - ephemeral: Normal link (Basic/Private sender)
    // - pool: Remainder link from partial claim (already deposited)
    // ========================================================================
    
    const needsPrivacy = recipientPrivacy === "private";
    const fundsInPool = doubleHopNote.fundsLocation === "pool";

    // Track claim (no PII, just a counter)
    incrementLinksClaimed().catch(() => {});
    
    // ------------------------------------------------------------------------
    // SPECIAL CASE: Funds already in pool (from partial claim remainder)
    // 
    // Just withdraw directly - no need to deposit!
    // This is the gas-efficient path for claiming remainder links.
    // ------------------------------------------------------------------------
    if (fundsInPool) {
      await preseedUtxoOffset(compositeSecret.ephemeralKeypair.publicKey.toBase58());
      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: false,
      });
      
      if (isSOL) {
        // Get actual pool balance
        const poolBalance = await privacyCashClient.getPrivateBalance();
        
        if (poolBalance.lamports <= 0) {
          throw new Error("This payment has already been claimed or expired");
        }
        
        // Check if this is a partial claim from pool
        if (isPartialClaim && partialAmount < poolBalance.lamports) {
          // Partial withdraw from pool
          const withdrawResult = await privacyCashClient.withdraw({
            lamports: partialAmount,
            recipientAddress,
          });
          
          // Check remaining balance
          const remainingBalance = await privacyCashClient.getPrivateBalance();
          
          // Create new remainder note (same keypair, funds still in pool)
          const remainderNote: DoubleHopNote = {
            secret: doubleHopNote.secret, // Same secret - funds still controlled by this keypair
            amount: remainingBalance.lamports,
            network: doubleHopNote.network,
            createdAt: Date.now(),
            ephemeralAddress: doubleHopNote.ephemeralAddress,
            status: "funded",
            senderPrivacy: "private",
            fundsLocation: "pool",
            token: "SOL",
            tokenMint: null,
          };
          
          const remainderLink = createDoubleHopClaimUrl(remainderNote, BASE_URL);
          
          return NextResponse.json({
            success: true,
            withdrawTxHash: withdrawResult.tx,
            amountReceived: withdrawResult.amount_in_lamports || partialAmount,
            recipientPrivacy,
            hops: 0, // Already in pool, just withdraw
            token,
            isPartialClaim: true,
            remainderNote,
            remainderLink,
            remainderAmount: remainingBalance.lamports,
          });
        }
        
        // Full withdraw from pool
        const withdrawResult = await privacyCashClient.withdraw({
          lamports: poolBalance.lamports,
          recipientAddress,
        });
        
        return NextResponse.json({
          success: true,
          withdrawTxHash: withdrawResult.tx,
          amountReceived: withdrawResult.amount_in_lamports || poolBalance.lamports,
          recipientPrivacy,
          hops: 0,
          token,
        });
        
      } else {
        // SPL Token from pool
        const poolBalance = await privacyCashClient.getPrivateBalanceSpl(tokenInfo.mint!);
        const poolAmountBaseUnits = Math.floor(poolBalance.amount * (10 ** tokenInfo.decimals));
        
        if (poolAmountBaseUnits <= 0) {
          throw new Error("This payment has already been claimed or expired");
        }
        
        // Check if partial claim
        if (isPartialClaim && partialAmount < poolAmountBaseUnits) {
          const partialAmountWholeTokens = partialAmount / (10 ** tokenInfo.decimals);
          
          const withdrawResult = await privacyCashClient.withdrawSPL({
            amount: partialAmountWholeTokens,
            mintAddress: tokenInfo.mint!,
            recipientAddress,
          });
          
          const remainingBalance = await privacyCashClient.getPrivateBalanceSpl(tokenInfo.mint!);
          const remainingAmountBaseUnits = Math.floor(remainingBalance.amount * (10 ** tokenInfo.decimals));
          
          const remainderNote: DoubleHopNote = {
            secret: doubleHopNote.secret,
            amount: remainingAmountBaseUnits,
            network: doubleHopNote.network,
            createdAt: Date.now(),
            ephemeralAddress: doubleHopNote.ephemeralAddress,
            status: "funded",
            senderPrivacy: "private",
            fundsLocation: "pool",
            token,
            tokenMint: tokenInfo.mint,
          };
          
          const remainderLink = createDoubleHopClaimUrl(remainderNote, BASE_URL);
          
          return NextResponse.json({
            success: true,
            withdrawTxHash: withdrawResult.tx,
            amountReceived: partialAmount,
            recipientPrivacy,
            hops: 0,
            token,
            isPartialClaim: true,
            remainderNote,
            remainderLink,
            remainderAmount: remainingAmountBaseUnits,
          });
        }
        
        // Full withdraw
        const withdrawAmountWholeTokens = poolBalance.amount;
        
        const withdrawResult = await privacyCashClient.withdrawSPL({
          amount: withdrawAmountWholeTokens,
          mintAddress: tokenInfo.mint!,
          recipientAddress,
        });
        
        return NextResponse.json({
          success: true,
          withdrawTxHash: withdrawResult.tx,
          amountReceived: poolAmountBaseUnits,
          recipientPrivacy,
          hops: 0,
          token,
        });
      }
    }

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
    // FLOW 2: PRIVATE PARTIAL CLAIM
    // 
    // For partial claims, we need to:
    // 1. Generate fresh EphRemainder (so sender can't access remainder)
    // 2. Move funds from original Eph → EphRemainder
    // 3. EphRemainder deposits ALL to pool
    // 4. Partial withdraw to recipient
    // 5. Remainder stays in pool, controlled by EphRemainder
    // 6. Return new link with EphRemainder (funds already in pool!)
    // ------------------------------------------------------------------------
    if (needsPrivacy && isPartialClaim) {
      const ephPubkey = compositeSecret.ephemeralKeypair.publicKey;
      
      console.log("[Claim] Starting partial claim flow");
      console.log("[Claim] Partial amount requested:", partialAmount, "lamports");
      
      // Step 1: Generate fresh EphRemainder - sender will never know this keypair
      const ephRemainderSecret = generateCompositeSecret();
      const ephRemainderPubkey = ephRemainderSecret.ephemeralKeypair.publicKey;
      const ephRemainderAddress = ephRemainderPubkey.toBase58();
      
      // CRITICAL: Log recovery info BEFORE any transfers in case of failure
      // This allows manual recovery if something goes wrong
      console.log("[Claim] RECOVERY INFO - EphRemainder Address:", ephRemainderAddress);
      console.log("[Claim] RECOVERY INFO - EphRemainder Secret:", ephRemainderSecret.full);
      
      if (isSOL) {
        // Get current balance
        const ephBalance = await connection.getBalance(ephPubkey);
        const TX_FEE = 5000;
        const transferAmount = Math.max(0, ephBalance - TX_FEE);
        
        console.log("[Claim] Ephemeral balance:", ephBalance, "lamports");
        console.log("[Claim] Transfer amount (after tx fee):", transferAmount, "lamports");
        
        if (transferAmount <= 0) {
          throw new Error("Ephemeral wallet has insufficient balance");
        }
        
        // Validate partial amount is less than available (accounting for fees)
        // Need to leave room for: transfer fee + deposit buffer + withdrawal fee
        const MIN_OVERHEAD = 10_000_000; // 0.01 SOL for all overhead
        if (partialAmount >= transferAmount - MIN_OVERHEAD) {
          console.log("[Claim] Partial amount too large:", partialAmount, "vs max:", transferAmount - MIN_OVERHEAD);
          throw new Error("Partial amount must be less than total available (minus fees)");
        }
        
        // Step 2: Transfer ALL from original Eph → EphRemainder
        console.log("[Claim] Transferring", transferAmount, "lamports from Eph to EphRemainder");
        const transferTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: ephPubkey,
            toPubkey: ephRemainderPubkey,
            lamports: transferAmount,
          })
        );
        
        try {
          await sendAndConfirmTransaction(
            connection,
            transferTx,
            [compositeSecret.ephemeralKeypair],
            { commitment: "confirmed" }
          );
          console.log("[Claim] Transfer to EphRemainder successful");
        } catch (transferError) {
          console.error("[Claim] Transfer to EphRemainder failed:", transferError);
          throw new Error("Failed to initiate partial claim - funds still in original link");
        }
        
        // =====================================================================
        // CRITICAL SAFETY NET: Once transfer succeeds, we MUST return recovery
        // info no matter what else fails. Wrap everything in try-catch.
        // =====================================================================
        
        // Pre-calculate the recovery link BEFORE any other operations
        const expectedEphRemainderBalance = transferAmount;
        const makeRecoveryLink = (fundsLocation: "ephemeral" | "pool", amount: number) => {
          return createDoubleHopClaimUrl({
            secret: ephRemainderSecret.full,
            amount,
            network: doubleHopNote.network,
            createdAt: Date.now(),
            ephemeralAddress: ephRemainderAddress,
            status: "funded",
            senderPrivacy: "private",
            fundsLocation,
            token: "SOL",
            tokenMint: null,
          }, BASE_URL);
        };
        
        // Track where funds are for recovery purposes
        let fundsAreInPool = false;
        let depositedAmount = 0;
        
        try {
          // Step 3: EphRemainder deposits ALL to pool
          await preseedUtxoOffset(ephRemainderSecret.ephemeralKeypair.publicKey.toBase58());
          const ephRemainderClient = new PrivacyCash({
            RPC_url: RPC_URL,
            owner: ephRemainderSecret.ephemeralKeypair,
            enableDebug: false,
          });

          const MIN_TX_BUFFER = 3_000_000; // ~0.003 SOL for tx fees
          depositedAmount = Math.max(0, expectedEphRemainderBalance - MIN_TX_BUFFER);
          
          console.log("[Claim] Expected EphRemainder balance:", expectedEphRemainderBalance, "lamports");
          console.log("[Claim] Deposit amount to pool:", depositedAmount, "lamports");
          
          if (depositedAmount <= 0) {
            throw new Error("Amount too small for pool deposit after fees");
          }
          
          console.log("[Claim] Depositing to Privacy Cash pool...");
          await ephRemainderClient.deposit({
            lamports: depositedAmount,
          });
          console.log("[Claim] Deposit successful");
          fundsAreInPool = true;
          
          // Step 4: Partial withdraw to recipient
          console.log("[Claim] Withdrawing partial amount:", partialAmount, "lamports to", recipientAddress);
          const withdrawResult = await ephRemainderClient.withdraw({
            lamports: partialAmount,
            recipientAddress,
          });
          console.log("[Claim] Withdraw successful:", withdrawResult.tx);
          
          // Step 5: Check remaining balance in pool
          const remainingBalance = await ephRemainderClient.getPrivateBalance();
          
          // Step 6: Create new note for remainder (funds already in pool!)
          const remainderNote: DoubleHopNote = {
            secret: ephRemainderSecret.full,
            amount: remainingBalance.lamports,
            network: doubleHopNote.network,
            createdAt: Date.now(),
            ephemeralAddress: ephRemainderAddress,
            status: "funded",
            senderPrivacy: "private",
            fundsLocation: "pool",
            token: "SOL",
            tokenMint: null,
          };
          
          const remainderLink = createDoubleHopClaimUrl(remainderNote, BASE_URL);
          
          // Sweep leftover SOL from both ephemerals back to relayer
          sweepToRelayer(compositeSecret.ephemeralKeypair).catch(() => {});
          sweepToRelayer(ephRemainderSecret.ephemeralKeypair).catch(() => {});
          
          return NextResponse.json({
            success: true,
            withdrawTxHash: withdrawResult.tx,
            amountReceived: withdrawResult.amount_in_lamports || partialAmount,
            recipientPrivacy,
            hops: 1,
            token,
            isPartialClaim: true,
            remainderNote,
            remainderLink,
            remainderAmount: remainingBalance.lamports,
          });
          
        } catch (postTransferError) {
          // =====================================================================
          // SAFETY NET: Any error after transfer MUST return recovery link
          // This ensures funds are NEVER lost
          // =====================================================================
          console.error("[Claim] Post-transfer error:", postTransferError);
          
          const recoveryAmount = fundsAreInPool ? depositedAmount : expectedEphRemainderBalance;
          const recoveryLocation = fundsAreInPool ? "pool" : "ephemeral";
          
          return NextResponse.json({
            success: false,
            error: `Partial claim failed: ${postTransferError instanceof Error ? postTransferError.message : "Unknown error"}. Your funds are safe - use the recovery link.`,
            recoveryNote: {
              secret: ephRemainderSecret.full,
              amount: recoveryAmount,
              ephemeralAddress: ephRemainderAddress,
              fundsLocation: recoveryLocation,
            },
            recoveryLink: makeRecoveryLink(recoveryLocation, recoveryAmount),
          }, { status: 400 });
        }
        
      } else {
        // SPL Token partial claim
        const tokenBalance = await getTokenBalance(ephPubkey, tokenInfo.mint!);
        
        if (tokenBalance <= BigInt(0)) {
          throw new Error(`Ephemeral wallet has no ${token} balance`);
        }
        
        const totalAmountBaseUnits = Number(tokenBalance);
        
        // Validate partial amount
        if (partialAmount >= totalAmountBaseUnits) {
          throw new Error("Partial amount must be less than total available");
        }
        
        // Step 2: Transfer ALL tokens from original Eph → EphRemainder
        const mintPubkey = new PublicKey(tokenInfo.mint!);
        const ephAta = await getAssociatedTokenAddress(mintPubkey, ephPubkey);
        const ephRemainderAta = await getAssociatedTokenAddress(mintPubkey, ephRemainderPubkey);
        
        const transferTx = new Transaction();
        
        // Also transfer SOL for gas
        const solBalance = await connection.getBalance(ephPubkey);
        const TX_FEE = 10000;
        const solToTransfer = Math.max(0, solBalance - TX_FEE);
        
        if (solToTransfer > 0) {
          transferTx.add(
            SystemProgram.transfer({
              fromPubkey: ephPubkey,
              toPubkey: ephRemainderPubkey,
              lamports: solToTransfer,
            })
          );
        }
        
        // Create EphRemainder's ATA
        transferTx.add(
          createAssociatedTokenAccountInstruction(
            ephPubkey, // payer
            ephRemainderAta,
            ephRemainderPubkey,
            mintPubkey
          )
        );
        
        // Transfer all tokens
        transferTx.add(
          createTransferInstruction(
            ephAta,
            ephRemainderAta,
            ephPubkey,
            tokenBalance,
            [],
            TOKEN_PROGRAM_ID
          )
        );
        
        try {
          await sendAndConfirmTransaction(
            connection,
            transferTx,
            [compositeSecret.ephemeralKeypair],
            { commitment: "confirmed" }
          );
          console.log("[Claim] SPL transfer to EphRemainder successful");
        } catch (transferError) {
          console.error("[Claim] SPL transfer failed:", transferError);
          throw new Error("Failed to initiate partial claim - funds still in original link");
        }
        
        // =====================================================================
        // CRITICAL SAFETY NET: Once transfer succeeds, we MUST return recovery
        // info no matter what else fails. Wrap everything in try-catch.
        // =====================================================================
        
        const makeSplRecoveryLink = (fundsLocation: "ephemeral" | "pool", amount: number) => {
          return createDoubleHopClaimUrl({
            secret: ephRemainderSecret.full,
            amount,
            network: doubleHopNote.network,
            createdAt: Date.now(),
            ephemeralAddress: ephRemainderAddress,
            status: "funded",
            senderPrivacy: "private",
            fundsLocation,
            token,
            tokenMint: tokenInfo.mint,
          }, BASE_URL);
        };
        
        let splFundsAreInPool = false;
        
        try {
          // Step 3: EphRemainder deposits ALL to pool
          await preseedUtxoOffset(ephRemainderSecret.ephemeralKeypair.publicKey.toBase58());
          const ephRemainderClient = new PrivacyCash({
            RPC_url: RPC_URL,
            owner: ephRemainderSecret.ephemeralKeypair,
            enableDebug: false,
          });

          const depositAmountWholeTokens = totalAmountBaseUnits / (10 ** tokenInfo.decimals);
          const partialAmountWholeTokens = partialAmount / (10 ** tokenInfo.decimals);
          
          await ephRemainderClient.depositSPL({
            amount: depositAmountWholeTokens,
            mintAddress: tokenInfo.mint!,
          });
          console.log("[Claim] SPL deposit to pool successful");
          splFundsAreInPool = true;
          
          // Step 4: Partial withdraw to recipient
          const withdrawResult = await ephRemainderClient.withdrawSPL({
            amount: partialAmountWholeTokens,
            mintAddress: tokenInfo.mint!,
            recipientAddress,
          });
          console.log("[Claim] SPL withdraw successful");
          
          // Step 5: Check remaining balance in pool
          const remainingBalance = await ephRemainderClient.getPrivateBalanceSpl(tokenInfo.mint!);
          const remainingAmountBaseUnits = Math.floor(remainingBalance.amount * (10 ** tokenInfo.decimals));
          
          // Step 6: Create new note for remainder
          const remainderNote: DoubleHopNote = {
            secret: ephRemainderSecret.full,
            amount: remainingAmountBaseUnits,
            network: doubleHopNote.network,
            createdAt: Date.now(),
            ephemeralAddress: ephRemainderAddress,
            status: "funded",
            senderPrivacy: "private",
            fundsLocation: "pool",
            token,
            tokenMint: tokenInfo.mint,
          };
          
          const remainderLink = createDoubleHopClaimUrl(remainderNote, BASE_URL);
          
          // Sweep leftover SOL
          sweepToRelayer(compositeSecret.ephemeralKeypair).catch(() => {});
          sweepToRelayer(ephRemainderSecret.ephemeralKeypair).catch(() => {});
          
          return NextResponse.json({
            success: true,
            withdrawTxHash: withdrawResult.tx,
            amountReceived: partialAmount,
            recipientPrivacy,
            hops: 1,
            token,
            isPartialClaim: true,
            remainderNote,
            remainderLink,
            remainderAmount: remainingAmountBaseUnits,
          });
          
        } catch (splPostTransferError) {
          // =====================================================================
          // SAFETY NET: Any error after transfer MUST return recovery link
          // =====================================================================
          console.error("[Claim] SPL post-transfer error:", splPostTransferError);
          
          const recoveryLocation = splFundsAreInPool ? "pool" : "ephemeral";
          
          return NextResponse.json({
            success: false,
            error: `Partial claim failed: ${splPostTransferError instanceof Error ? splPostTransferError.message : "Unknown error"}. Your funds are safe - use the recovery link.`,
            recoveryNote: {
              secret: ephRemainderSecret.full,
              amount: totalAmountBaseUnits,
              ephemeralAddress: ephRemainderAddress,
              fundsLocation: recoveryLocation,
            },
            recoveryLink: makeSplRecoveryLink(recoveryLocation, totalAmountBaseUnits),
          }, { status: 400 });
        }
      }
    }

    // ------------------------------------------------------------------------
    // FLOW 3: PRIVATE recipient (full claim)
    // 
    // Eph → Pool → Recipient (ZK withdrawal hides recipient)
    // Sender sees: Eph → Pool (cannot see final destination)
    // This gives recipient privacy from the sender/link holder.
    // ------------------------------------------------------------------------
    if (needsPrivacy) {
      // Flow 3: Ephemeral → Pool → Recipient (PRIVATE CLAIM)
      const ephPubkey = compositeSecret.ephemeralKeypair.publicKey;

      await preseedUtxoOffset(ephPubkey.toBase58());
      const privacyCashClient = new PrivacyCash({
        RPC_url: RPC_URL,
        owner: compositeSecret.ephemeralKeypair,
        enableDebug: false,
      });

      const TX_TIMEOUT_MS = 60_000; // 60s max per SDK call
      const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
        Promise.race([
          promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${TX_TIMEOUT_MS / 1000}s`)), TX_TIMEOUT_MS)
          ),
        ]);

      if (isSOL) {
        // SOL: Check actual ephemeral balance and subtract SDK overhead
        const ephBalance = await connection.getBalance(ephPubkey);
        const MIN_TX_BUFFER = 3_000_000; // ~0.003 SOL - minimal buffer for tx fees
        const depositAmount = Math.max(0, ephBalance - MIN_TX_BUFFER);

        if (depositAmount <= 0) {
          throw new Error("Ephemeral balance too low to cover Privacy Cash overhead");
        }

        // First deposit to pool (free, no fee)
        await withTimeout(privacyCashClient.deposit({
          lamports: depositAmount,
        }), 'deposit');

        // Withdraw with ZK privacy
        const withdrawResult = await withTimeout(privacyCashClient.withdraw({
          lamports: depositAmount,
          recipientAddress,
        }), 'withdraw');

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
        await withTimeout(privacyCashClient.depositSPL({
          amount: depositAmountWholeTokens,
          mintAddress: tokenInfo.mint!,
        }), 'depositSPL');

        // Withdraw SPL with ZK privacy
        const withdrawResult = await withTimeout(privacyCashClient.withdrawSPL({
          amount: depositAmountWholeTokens,
          mintAddress: tokenInfo.mint!,
          recipientAddress,
        }), 'withdrawSPL');

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
    console.error("[Claim] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Failed to claim";
    
    // More specific error handling
    if (errorMessage.includes("already been claimed")) {
      return NextResponse.json(
        { success: false, error: "This payment has already been claimed or expired" },
        { status: 400 }
      );
    }
    
    if (errorMessage.includes("Partial amount must be less")) {
      return NextResponse.json(
        { success: false, error: "Partial amount is too large. Try a smaller amount." },
        { status: 400 }
      );
    }
    
    if (errorMessage.includes("Insufficient balance after transfer")) {
      return NextResponse.json(
        { success: false, error: "Not enough balance to complete partial claim. Try claiming more or the full amount." },
        { status: 400 }
      );
    }
    
    if (errorMessage.includes("Failed to initiate partial claim")) {
      return NextResponse.json(
        { success: false, error: "Failed to start partial claim. Please try again - your funds are safe in the original link." },
        { status: 400 }
      );
    }
    
    // Generic insufficient balance - could be empty ephemeral or pool
    if (errorMessage.includes("insufficient") || errorMessage.includes("no balance") || errorMessage.includes("No enough balance") || errorMessage.includes("has insufficient balance")) {
      return NextResponse.json(
        { success: false, error: "This payment has already been claimed or expired" },
        { status: 400 }
      );
    }

    // Return the actual error message for debugging
    console.error("[Claim] Unhandled error:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Claim failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
