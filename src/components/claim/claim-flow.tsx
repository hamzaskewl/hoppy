"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, Check, Copy, ArrowRight, AlertTriangle, Lock, Zap, Home } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShieldingAnimation } from "./shielding-animation";
import {
  extractNoteFromUrl,
  decodeCompositeSecret,
  CLAIM_MODES,
  WSOL_MINT,
  TOKEN_MINTS,
  createUmbraClientFromKeypair,
  ensureRegistered,
  type UmbraNote,
  type ClaimMode,
} from "@/lib/privacy";
import { formatSol, shortenAddress, lamportsToSol } from "@/lib/utils";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";

type ClaimStatus =
  | "parsing"      // Extracting note from URL
  | "ready"        // Note valid, waiting for wallet connection
  | "claiming"     // Processing claim via Umbra SDK
  | "complete"     // Claim successful
  | "already-claimed" // Note was already used
  | "error";       // Something went wrong

interface ClaimState {
  status: ClaimStatus;
  note: UmbraNote | null;
  withdrawTxHash: string | null;
  amountReceived: number | null;
  error: string | null;
}

/**
 * ClaimFlow Component - Claims via Umbra Privacy SDK (client-side)
 *
 * Flow:
 * 1. Parse Umbra note from URL hash → reconstruct ephemeral keypair
 * 2. Create Umbra client with ephemeral signer
 * 3. Fetch claimable UTXOs
 * 4. User connects wallet or pastes address
 * 5. Claim UTXO → transfer tokens to recipient
 */
export function ClaimFlow() {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [state, setState] = useState<ClaimState>({
    status: "parsing",
    note: null,
    withdrawTxHash: null,
    amountReceived: null,
    error: null,
  });
  const [copied, setCopied] = useState(false);
  const [claimProgress, setClaimProgress] = useState<string>("");
  const [claimMode, setClaimMode] = useState<ClaimMode>("quick");
  const [pasteAddress, setPasteAddress] = useState<string>("");
  const [useCustomAddress, setUseCustomAddress] = useState(false);
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [reclaimSuccess, setReclaimSuccess] = useState<string | null>(null);
  
  const hasStartedParsing = useRef(false);

  // In Umbra, fees are on the deposit side. Recipient gets the full UTXO amount.
  const receiveBreakdown = useMemo(() => {
    if (!state.note) return null;
    return {
      recipientReceives: state.note.amount,
      fee: 0,
      privacyInfo: CLAIM_MODES[claimMode],
    };
  }, [state.note, claimMode]);

  // Validate paste address
  const isValidPasteAddress = useMemo(() => {
    if (!pasteAddress) return false;
    try {
      new PublicKey(pasteAddress);
      return true;
    } catch {
      return false;
    }
  }, [pasteAddress]);

  // Get user's connected wallet address
  const getUserWalletAddress = useCallback((): PublicKey | null => {
    return publicKey ?? null;
  }, [publicKey]);

  // Parse note from URL on mount
  useEffect(() => {
    if (hasStartedParsing.current) return;
    hasStartedParsing.current = true;

    const parseNote = async () => {

      try {
        const note = extractNoteFromUrl();
        
        if (!note) {
          setState({
            status: "error",
            note: null,
            withdrawTxHash: null,
            amountReceived: null,
            error: "Invalid or missing claim note in URL",
          });
          return;
        }

        // Validate the composite secret can be decoded
        const compositeSecret = decodeCompositeSecret(note.secret);
        if (!compositeSecret) {
          setState({
            status: "error",
            note: null,
            withdrawTxHash: null,
            amountReceived: null,
            error: "Claim note is malformed or corrupted",
          });
          return;
        }

        // Verify ephemeral address matches
        if (compositeSecret.ephemeralKeypair.publicKey.toBase58() !== note.ephemeralAddress) {
          setState({
            status: "error",
            note: null,
            withdrawTxHash: null,
            amountReceived: null,
            error: "Ephemeral wallet mismatch - invalid note",
          });
          return;
        }

        // Check if already claimed by verifying funds still exist
        const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
        const connection = new Connection(rpcUrl, "confirmed");
        
        if (note.fundsLocation === "ephemeral") {
          const ephemeralPubkey = new PublicKey(note.ephemeralAddress);
          
          // Check the appropriate balance based on token type
          const isSOL = !note.token || note.token === "SOL";
          
          if (isSOL) {
            // For SOL, check native balance
            const ephemeralBalance = await connection.getBalance(ephemeralPubkey);
            
            if (ephemeralBalance === 0) {
              setState({
                status: "already-claimed",
                note,
                withdrawTxHash: null,
                amountReceived: null,
                error: "This payment has already been claimed or expired",
              });
              return;
            }
          } else {
            // For SPL tokens, check token balance
            try {
              const { getAssociatedTokenAddress, getAccount } = await import("@solana/spl-token");
              const mintPubkey = new PublicKey(note.tokenMint!);
              const ata = await getAssociatedTokenAddress(mintPubkey, ephemeralPubkey);
              const account = await getAccount(connection, ata);
              
              if (account.amount === BigInt(0)) {
                setState({
                  status: "already-claimed",
                  note,
                  withdrawTxHash: null,
                  amountReceived: null,
                  error: "This payment has already been claimed or expired",
                });
                return;
              }
              
              // Update note amount with actual token balance (in case it differs)
              note.amount = Number(account.amount);
            } catch {
              // Token account doesn't exist = already claimed or never funded
              setState({
                status: "already-claimed",
                note,
                withdrawTxHash: null,
                amountReceived: null,
                error: "This payment has already been claimed or expired",
              });
              return;
            }
          }
        }
        // For pool funds, we'll verify during claim attempt (SDK checks UTXOs)

        setState({
          status: "ready",
          note,
          withdrawTxHash: null,
          amountReceived: null,
          error: null,
        });
      } catch (error) {
        console.error("[Claim] Parse error:", error);
        setState({
          status: "error",
          note: null,
          withdrawTxHash: null,
          amountReceived: null,
          error: error instanceof Error ? error.message : "Failed to parse claim note",
        });
      }
    };

    parseNote();
  }, []);

  // Handle claim — quick/basic: direct transfer from ephemeral to recipient (no Umbra)
  const handleClaim = async () => {
    // Get recipient address from either paste or connected wallet
    let recipientAddress: string;

    if (useCustomAddress) {
      if (!isValidPasteAddress) {
        return;
      }
      recipientAddress = pasteAddress;
    } else {
      const walletAddress = getUserWalletAddress();
      if (!walletAddress) {
        if (!connected) {
          setVisible(true);
        }
        return;
      }
      recipientAddress = walletAddress.toBase58();
    }

    if (!state.note) {
      return;
    }

    setState((prev) => ({ ...prev, status: "claiming" }));
    setClaimProgress("Initializing...");

    try {
      // Reconstruct ephemeral keypair from note
      const compositeSecret = decodeCompositeSecret(state.note.secret);
      if (!compositeSecret) {
        throw new Error("Invalid claim secret");
      }
      const ephemeralKeypair = compositeSecret.ephemeralKeypair;

      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      const recipientPubkey = new PublicKey(recipientAddress);
      const ephemeralPubkey = ephemeralKeypair.publicKey;
      const isSOL = !state.note.token || state.note.token === "SOL";
      const tokenMint = state.note.tokenMint || TOKEN_MINTS[state.note.token || "SOL"].mint;

      setClaimProgress("Preparing transfer...");

      let transferSig: string | null = null;

      // ── Private send: funds are in Umbra pool, need to claim UTXO first ──
      if (state.note.fundsLocation === "pool" && isSOL) {
        setClaimProgress("Loading ZK circuits...");
        const { getCdnZkAssetProvider } = await import("@umbra-privacy/web-zk-prover");
        const zkProvider = getCdnZkAssetProvider({ baseUrl: `${window.location.origin}/umbra-zk` });

        // Reconstruct Umbra client from ephemeral
        const umbraClient = await createUmbraClientFromKeypair(ephemeralKeypair);

        // Claim self-claimable UTXO into public wSOL balance
        setClaimProgress("Claiming from privacy pool...");
        const { getSelfClaimableUtxoToPublicBalanceClaimerFunction, getClaimableUtxoScannerFunction, getUmbraRelayer, getBatchMerkleProofFetcher } =
          await import("@umbra-privacy/sdk");
        const { getClaimSelfClaimableUtxoIntoPublicBalanceProver } =
          await import("@umbra-privacy/web-zk-prover");
        const { getUmbraConfig } = await import("@/lib/privacy");
        const config = getUmbraConfig();
        const relayer = getUmbraRelayer({
          apiEndpoint: config.relayerUrl,
        } as any);
        const fetchBatchMerkleProof = getBatchMerkleProofFetcher({ apiEndpoint: config.indexerUrl });
        const claimProver = getClaimSelfClaimableUtxoIntoPublicBalanceProver({ assetProvider: zkProvider });
        const claimFn = getSelfClaimableUtxoToPublicBalanceClaimerFunction(
          { client: umbraClient },
          { zkProver: claimProver, relayer, fetchBatchMerkleProof }
        );

        const scanUtxos = getClaimableUtxoScannerFunction({ client: umbraClient });
        const fetchResult = await scanUtxos(BigInt(0) as any, BigInt(0) as any, BigInt(10000) as any);
        const utxos = (fetchResult as any).self || [];
        if (utxos.length === 0) throw new Error("No claimable UTXOs found — payment may have already been claimed");
        await claimFn(utxos);

        // Close wSOL ATA to unwrap → native SOL
        setClaimProgress("Unwrapping SOL...");
        const wsolMint = new PublicKey(WSOL_MINT);
        const wsolAta = await getAssociatedTokenAddress(wsolMint, ephemeralPubkey);
        try {
          const closeTx = new Transaction().add(
            createCloseAccountInstruction(wsolAta, ephemeralPubkey, ephemeralPubkey)
          );
          const { blockhash: closeHash } = await connection.getLatestBlockhash();
          closeTx.recentBlockhash = closeHash;
          closeTx.feePayer = ephemeralPubkey;
          closeTx.sign(ephemeralKeypair);
          const closeSig = await connection.sendRawTransaction(closeTx.serialize());
          await connection.confirmTransaction(closeSig, "confirmed");
        } catch {
          // ATA may not exist if claim went to native balance
        }

        // Transfer all SOL to recipient (same drain logic as basic)
        setClaimProgress("Sending to your wallet...");
        const balance = await connection.getBalance(ephemeralPubkey);
        if (balance > 0) {
          const { blockhash } = await connection.getLatestBlockhash();
          const dummyTx = new Transaction();
          dummyTx.recentBlockhash = blockhash;
          dummyTx.feePayer = ephemeralPubkey;
          dummyTx.add(SystemProgram.transfer({ fromPubkey: ephemeralPubkey, toPubkey: recipientPubkey, lamports: balance }));
          const fee = Number((await connection.getFeeForMessage(dummyTx.compileMessage()))?.value ?? 5000);
          const toSend = balance - fee;
          if (toSend > 0) {
            const finalTx = new Transaction().add(
              SystemProgram.transfer({ fromPubkey: ephemeralPubkey, toPubkey: recipientPubkey, lamports: toSend })
            );
            finalTx.recentBlockhash = blockhash;
            finalTx.feePayer = ephemeralPubkey;
            finalTx.sign(ephemeralKeypair);
            transferSig = await connection.sendRawTransaction(finalTx.serialize());
            await connection.confirmTransaction(transferSig, "confirmed");
          }
        }
      } else if (isSOL) {
        // ── Basic send: funds are native SOL on the ephemeral ──
        // Step 1: Close wSOL ATA if it exists (unwrap leftover wSOL back to native SOL)
        const wsolMint = new PublicKey(WSOL_MINT);
        const wsolAta = await getAssociatedTokenAddress(wsolMint, ephemeralPubkey);
        try {
          await getAccount(connection, wsolAta);
          const closeTx = new Transaction().add(
            createCloseAccountInstruction(wsolAta, ephemeralPubkey, ephemeralPubkey)
          );
          const { blockhash: closeHash } = await connection.getLatestBlockhash();
          closeTx.recentBlockhash = closeHash;
          closeTx.feePayer = ephemeralPubkey;
          closeTx.sign(ephemeralKeypair);
          const closeSig = await connection.sendRawTransaction(closeTx.serialize());
          await connection.confirmTransaction(closeSig, "confirmed");
        } catch {
          // No wSOL ATA — funds are already native SOL
        }

        // Step 2: Transfer all SOL to recipient (drain ephemeral to exactly 0)
        setClaimProgress("Sending to your wallet...");
        const balance = await connection.getBalance(ephemeralPubkey);

        if (balance > 0) {
          // Build a dummy transfer to calculate the exact fee
          const { blockhash } = await connection.getLatestBlockhash();
          const transferTx = new Transaction();
          transferTx.recentBlockhash = blockhash;
          transferTx.feePayer = ephemeralPubkey;
          transferTx.add(
            SystemProgram.transfer({
              fromPubkey: ephemeralPubkey,
              toPubkey: recipientPubkey,
              lamports: balance, // placeholder
            })
          );
          // Get the actual fee for this tx
          const feeRaw = (await connection.getFeeForMessage(transferTx.compileMessage()))?.value ?? 5000;
          const fee = Number(feeRaw);
          const toSend = balance - fee;

          if (toSend > 0) {
            // Rebuild with correct amount
            const finalTx = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: ephemeralPubkey,
                toPubkey: recipientPubkey,
                lamports: toSend,
              })
            );
            finalTx.recentBlockhash = blockhash;
            finalTx.feePayer = ephemeralPubkey;
            finalTx.sign(ephemeralKeypair);
            transferSig = await connection.sendRawTransaction(finalTx.serialize());
            await connection.confirmTransaction(transferSig, "confirmed");
          }
        }
      } else {
        // SPL token transfer
        setClaimProgress("Sending tokens to your wallet...");
        const transferTx = new Transaction();
        const mintPubkey = new PublicKey(tokenMint);
        const ephemeralAta = await getAssociatedTokenAddress(mintPubkey, ephemeralPubkey);
        const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);

        // Create recipient ATA if it doesn't exist
        try {
          await getAccount(connection, recipientAta);
        } catch {
          transferTx.add(
            createAssociatedTokenAccountInstruction(ephemeralPubkey, recipientAta, recipientPubkey, mintPubkey)
          );
        }

        // Get token balance and transfer
        const account = await getAccount(connection, ephemeralAta);
        if (account.amount > BigInt(0)) {
          transferTx.add(
            createTransferInstruction(
              ephemeralAta, recipientAta, ephemeralPubkey,
              account.amount, [], TOKEN_PROGRAM_ID
            )
          );
        }

        // Also drain remaining SOL to recipient
        // Add a placeholder transfer to calculate the fee accurately
        const solBalance = await connection.getBalance(ephemeralPubkey);
        transferTx.add(
          SystemProgram.transfer({
            fromPubkey: ephemeralPubkey,
            toPubkey: recipientPubkey,
            lamports: solBalance, // placeholder
          })
        );

        if (transferTx.instructions.length > 0) {
          const { blockhash } = await connection.getLatestBlockhash();
          transferTx.recentBlockhash = blockhash;
          transferTx.feePayer = ephemeralPubkey;

          // Calculate exact fee, then fix the SOL transfer amount
          const fee = Number((await connection.getFeeForMessage(transferTx.compileMessage()))?.value ?? 10000);
          const solToSend = Math.max(0, solBalance - fee);

          // Rebuild with correct SOL amount
          const finalTx = new Transaction();
          // Re-add all instructions except the last (placeholder SOL transfer)
          for (let i = 0; i < transferTx.instructions.length - 1; i++) {
            finalTx.add(transferTx.instructions[i]);
          }
          if (solToSend > 0) {
            finalTx.add(
              SystemProgram.transfer({
                fromPubkey: ephemeralPubkey,
                toPubkey: recipientPubkey,
                lamports: solToSend,
              })
            );
          }
          finalTx.recentBlockhash = blockhash;
          finalTx.feePayer = ephemeralPubkey;
          finalTx.sign(ephemeralKeypair);
          transferSig = await connection.sendRawTransaction(finalTx.serialize());
          await connection.confirmTransaction(transferSig, "confirmed");
        }
      }

      setState((prev) => ({
        ...prev,
        status: "complete",
        withdrawTxHash: transferSig,
        amountReceived: state.note!.amount,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Claim failed";

      if (errorMessage.includes("insufficient") || errorMessage.includes("balance") || errorMessage.includes("already")) {
        setState((prev) => ({
          ...prev,
          status: "already-claimed",
          error: "This payment has already been claimed or expired",
        }));
      } else {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: errorMessage,
        }));
      }
    } finally {
      setClaimProgress("");
    }
  };

  const handleCopyTxHash = async (hash: string) => {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReclaimEphemeral = async () => {
    if (!state.note) return;
    setIsReclaiming(true);
    setReclaimSuccess(null);
    try {
      // Determine destination address (same logic as claim)
      let recipientAddress: string;
      if (useCustomAddress) {
        if (!isValidPasteAddress) {
          throw new Error("Invalid recipient address");
        }
        recipientAddress = pasteAddress;
      } else {
        const walletAddress = getUserWalletAddress();
        if (!walletAddress) throw new Error("Connect a Solana wallet first");
        recipientAddress = walletAddress.toBase58();
      }

      const compositeSecret = decodeCompositeSecret(state.note.secret);
      if (!compositeSecret) throw new Error("Invalid claim secret");

      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      const tx = new Transaction();
      const ephPubkey = compositeSecret.ephemeralKeypair.publicKey;

      // Close wSOL ATA if it exists (unwraps back to SOL)
      try {
        const wsolMint = new PublicKey(WSOL_MINT);
        const wsolAta = await getAssociatedTokenAddress(wsolMint, ephPubkey);
        await getAccount(connection, wsolAta);
        tx.add(createCloseAccountInstruction(wsolAta, ephPubkey, ephPubkey));
      } catch {
        // No wSOL ATA
      }

      const balance = await connection.getBalance(ephPubkey);
      // Account for rent recovered from ATA closes (~0.00204 SOL each)
      const ataCloseCount = tx.instructions.length; // all instructions so far are ATA closes
      const totalBalance = balance + (ataCloseCount * 2039280);
      if (totalBalance <= 0 && tx.instructions.length === 0) throw new Error("No funds left in ephemeral wallet");

      // Add placeholder SOL transfer to calculate exact fee
      const recipientPubkey = new PublicKey(recipientAddress);
      tx.add(
        SystemProgram.transfer({
          fromPubkey: ephPubkey,
          toPubkey: recipientPubkey,
          lamports: totalBalance || 1, // placeholder
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = ephPubkey;

      // Calculate exact fee, then rebuild with correct drain amount
      const fee = Number((await connection.getFeeForMessage(tx.compileMessage()))?.value ?? 5000);
      const toSend = Math.max(0, totalBalance - fee);

      const finalTx = new Transaction();
      // Re-add all instructions except the last (placeholder SOL transfer)
      for (let i = 0; i < tx.instructions.length - 1; i++) {
        finalTx.add(tx.instructions[i]);
      }
      if (toSend > 0) {
        finalTx.add(
          SystemProgram.transfer({
            fromPubkey: ephPubkey,
            toPubkey: recipientPubkey,
            lamports: toSend,
          })
        );
      }
      finalTx.recentBlockhash = blockhash;
      finalTx.feePayer = ephPubkey;
      finalTx.sign(compositeSecret.ephemeralKeypair);
      const sig = await connection.sendRawTransaction(finalTx.serialize(), { preflightCommitment: "confirmed" });
      await connection.confirmTransaction(sig, "confirmed");
      setReclaimSuccess("Reclaimed from ephemeral wallet. Check your balance.");
      setTimeout(() => setReclaimSuccess(null), 8000);
    } catch (e) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: e instanceof Error ? e.message : "Reclaim failed",
      }));
    } finally {
      setIsReclaiming(false);
    }
  };

  // Calculate fees for display
  return (
    <Card className="w-full max-w-md mx-auto overflow-hidden">
      <AnimatePresence mode="wait">
        {/* Parsing State */}
        {state.status === "parsing" && (
          <motion.div
            key="parsing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CardContent className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-hop-500 mx-auto" />
              <h3 className="mt-6 text-lg font-semibold">Reading Payment Link...</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Validating your private payment
              </p>
            </CardContent>
          </motion.div>
        )}

        {/* Ready State - Waiting for wallet */}
        {state.status === "ready" && state.note && (
          <motion.div
            key="ready"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CardContent className="py-6">
              {/* Header */}
              <div className="flex justify-center mb-4">
                <div className="w-24 h-24">
                  <Image 
                    src="/bunnypriv.png" 
                    alt="Privacy" 
                    width={96} 
                    height={96}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              <h3 className="text-xl font-bold text-center mb-1">
                Payment Ready to Claim
              </h3>
              <p className="text-sm text-muted-foreground text-center mb-4">
                {(() => {
                  const isSOL = !state.note.token || state.note.token === "SOL";
                  if (isSOL) {
                    return `${lamportsToSol(state.note.amount).toFixed(4)} SOL`;
                  } else {
                    // SPL token - USDC/USDT have 6 decimals
                    const decimals = state.note.token === "USDC" || state.note.token === "USDT" ? 6 : 9;
                    return `${(state.note.amount / (10 ** decimals)).toFixed(2)} ${state.note.token}`;
                  }
                })()} available to claim
              </p>

              {/* Sender privacy info — only show for private sends */}
              {state.note.senderPrivacy === "private" && (
                <div className="p-2 rounded-lg mb-4 bg-hop-500/10 border border-hop-500/20">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-hop-500" />
                    <span className="text-xs">Sender is hidden (ZK mixer protected)</span>
                  </div>
                </div>
              )}

              {/* Your Claim Mode Selector */}
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-2 block">Claim Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(CLAIM_MODES) as ClaimMode[]).map((mode) => {
                    const info = CLAIM_MODES[mode];
                    const isSelected = claimMode === mode;
                    const amount = state.note!.amount;
                    return (
                      <button
                        key={mode}
                        onClick={() => setClaimMode(mode)}
                        className={`p-3 rounded-xl border-2 transition-all text-left relative ${
                          isSelected
                            ? mode === "quick"
                              ? "border-yellow-500 bg-yellow-500/10 ring-2 ring-yellow-500/30"
                              : "border-hop-500 bg-hop-500/20 ring-2 ring-hop-500/50"
                            : "border-border hover:border-muted-foreground/50 bg-background"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {mode === "quick" && <Zap className={`w-4 h-4 ${isSelected ? "text-yellow-600" : "text-yellow-500"}`} />}
                          {mode === "private" && (
                            <Image src="/bunnypriv.png" alt="Private" width={28} height={28} className="w-7 h-7" />
                          )}
                          <span className={`text-sm font-semibold ${isSelected && mode === "private" ? "text-hop-700 dark:text-hop-300" : ""}`}>
                            {info.name}
                          </span>
                        </div>
                        <p className={`text-lg font-bold ${isSelected && mode === "private" ? "text-hop-700 dark:text-hop-300" : ""}`}>
                          {(() => {
                            const isSOL = !state.note!.token || state.note!.token === "SOL";
                            if (isSOL) {
                              return `${lamportsToSol(amount).toFixed(4)} SOL`;
                            } else {
                              const decimals = state.note!.token === "USDC" || state.note!.token === "USDT" ? 6 : 9;
                              return `${(amount / (10 ** decimals)).toFixed(2)} ${state.note!.token}`;
                            }
                          })()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {info.recipientHidden ? "You stay hidden" : "Sender can see you"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Claim mode explanation */}
              <div className={`p-3 rounded-lg mb-4 ${
                claimMode === "quick" ? "bg-yellow-500/5 border border-yellow-500/20" :
                "bg-hop-500/5 border border-hop-500/20"
              }`}>
                <p className="text-xs text-muted-foreground">
                  {CLAIM_MODES[claimMode].description}
                </p>
              </div>

              {/* Destination Address */}
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-2 block">Receive To</label>
                
                {/* Toggle between paste and connect */}
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setUseCustomAddress(false)}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm transition-all ${
                      !useCustomAddress ? "bg-hop-500/20 border border-hop-500" : "bg-background border border-border"
                    }`}
                  >
                    Connect Wallet
                  </button>
                  <button
                    onClick={() => setUseCustomAddress(true)}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm transition-all ${
                      useCustomAddress ? "bg-hop-500/20 border border-hop-500" : "bg-background border border-border"
                    }`}
                  >
                    Paste Address
                  </button>
                </div>

                {useCustomAddress ? (
                  <div className="space-y-2">
                    <Input
                      type="text"
                      placeholder="Enter Solana address..."
                      value={pasteAddress}
                      onChange={(e) => setPasteAddress(e.target.value)}
                      className={`font-mono text-sm ${
                        pasteAddress && !isValidPasteAddress ? "border-red-500" : ""
                      }`}
                    />
                    {pasteAddress && !isValidPasteAddress && (
                      <p className="text-xs text-red-400">Invalid Solana address</p>
                    )}
                  </div>
                ) : (
                  <>
                    {connected && publicKey ? (
                      <div className="p-3 rounded-xl bg-background border border-border">
                        <p className="font-mono text-sm">
                          {shortenAddress(publicKey.toBase58(), 8)}
                        </p>
                      </div>
                    ) : (
                      <Button
                        onClick={() => setVisible(true)}
                        className="w-full"
                        variant="outline"
                      >
                        <Wallet className="w-4 h-4 mr-2" />
                        Connect Wallet
                      </Button>
                    )}
                  </>
                )}
              </div>

              {/* Claim Button */}
              <Button
                onClick={handleClaim}
                className="w-full"
                size="lg"
                disabled={
                  useCustomAddress ? !isValidPasteAddress : (!connected || !publicKey)
                }
              >
                <Zap className="w-4 h-4 mr-2" />
                Claim {(() => {
                  if (!receiveBreakdown || !state.note) return "0";
                  const isSOL = !state.note.token || state.note.token === "SOL";
                  if (isSOL) {
                    return `${lamportsToSol(receiveBreakdown.recipientReceives).toFixed(4)} SOL`;
                  } else {
                    const decimals = state.note.token === "USDC" || state.note.token === "USDT" ? 6 : 9;
                    return `${(receiveBreakdown.recipientReceives / (10 ** decimals)).toFixed(2)} ${state.note.token}`;
                  }
                })()}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </motion.div>
        )}

        {/* Claiming State */}
        {state.status === "claiming" && (
          <motion.div
            key="claiming"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CardContent className="py-8">
              <ShieldingAnimation status="shielding" />
              
              <p className="text-center text-sm text-muted-foreground mt-4">
                {claimProgress || "Processing your claim..."}
              </p>
              
              <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-800 dark:text-amber-200/80 font-medium">
                    Processing your private claim. Do not close this page.
                  </p>
                </div>
              </div>
            </CardContent>
          </motion.div>
        )}

        {/* Complete State */}
        {state.status === "complete" && state.note && (
          <motion.div
            key="complete"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <CardContent className="py-8 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-20 h-20 rounded-full flex items-center justify-center mx-auto bg-hop-500"
              >
                <Check className="w-10 h-10 text-white" />
              </motion.div>
              
              <h3 className="mt-6 text-2xl font-bold">Claim Complete!</h3>
              <p className="mt-2 text-muted-foreground">
                {state.error ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    {state.error}
                  </span>
                ) : (
                  (() => {
                    const amount = state.amountReceived || state.note.amount;
                    const isSOL = !state.note.token || state.note.token === "SOL";
                    if (isSOL) {
                      return `${formatSol(amount)} SOL sent to your wallet`;
                    } else {
                      const decimals = state.note.token === "USDC" || state.note.token === "USDT" ? 6 : 9;
                      return `${(amount / (10 ** decimals)).toFixed(2)} ${state.note.token} sent to your wallet`;
                    }
                  })()
                )}
              </p>

              {/* Privacy confirmation */}
              {state.note.senderPrivacy === "private" && (
                <div className="mt-4 p-3 rounded-lg bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400/50 inline-block">
                  <div className="flex items-center gap-2">
                    <Image src="/bunnypriv.png" alt="Privacy" width={24} height={24} className="w-6 h-6" />
                    <p className="text-xs text-hop-700 dark:text-hop-300 font-medium">
                      Privacy preserved - no link to sender
                    </p>
                  </div>
                </div>
              )}

              {/* Transaction Hash */}
              {state.withdrawTxHash && (
                <div className="mt-6 p-3 rounded-xl bg-card border-2 border-border inline-block">
                  <button
                    onClick={() => handleCopyTxHash(state.withdrawTxHash!)}
                    className="flex items-center gap-2 text-sm font-mono text-hop-600 dark:text-hop-400 hover:text-hop-700 dark:hover:text-hop-300"
                  >
                    Tx: {shortenAddress(state.withdrawTxHash, 8)}
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              )}

              <div className="mt-8 flex gap-3 justify-center">
                <Button
                  variant="outline"
                  onClick={() => window.location.href = "/"}
                  className="rounded-full"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Home
                </Button>
              </div>
            </CardContent>
          </motion.div>
        )}

        {/* Already Claimed State */}
        {state.status === "already-claimed" && (
          <motion.div
            key="already-claimed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CardHeader>
              <CardTitle>Already Claimed</CardTitle>
              <CardDescription>
                This payment has already been claimed or has expired
              </CardDescription>
            </CardHeader>
            <CardContent>
              {state.note && (
                <div className="p-4 rounded-xl bg-background border border-border mb-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Original Amount</span>
                    <span className="font-semibold">
                      {(() => {
                        const isSOL = !state.note.token || state.note.token === "SOL";
                        if (isSOL) {
                          return `${formatSol(state.note.amount)} SOL`;
                        } else {
                          const decimals = state.note.token === "USDC" || state.note.token === "USDT" ? 6 : 9;
                          return `${(state.note.amount / (10 ** decimals)).toFixed(2)} ${state.note.token}`;
                        }
                      })()}
                    </span>
                  </div>
                </div>
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.location.href = "/"}
              >
                Go Home
              </Button>
            </CardContent>
          </motion.div>
        )}

        {/* Error State */}
        {state.status === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CardContent className="py-8">
              <ShieldingAnimation status="error" message={state.error || undefined} />

              {/* NOTE: Recovery options removed for security - only sender has recovery access */}
              <p className="mt-4 text-sm text-muted-foreground text-center">
                If you received this link and it&apos;s not working, please contact the sender.
              </p>
              
              <div className="mt-6 flex gap-3 justify-center">
                <Button
                  variant="outline"
                  onClick={() => window.location.reload()}
                >
                  Try Again
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.location.href = "/"}
                >
                  Go Home
                </Button>
              </div>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
