"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, Check, Copy, ArrowRight, AlertTriangle, Shield, Lock, Zap, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShieldingAnimation } from "./shielding-animation";
import { 
  extractDoubleHopNoteFromUrl,
  decodeCompositeSecret,
  calculateRecipientReceives,
  calculateSPLRecipientReceives,
  RECIPIENT_PRIVACY,
  SENDER_PRIVACY,
  type DoubleHopNote,
  type RecipientPrivacy,
} from "@/lib/privacy";
import { formatSol, shortenAddress, lamportsToSol } from "@/lib/utils";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

type ClaimStatus = 
  | "parsing"      // Extracting note from URL
  | "ready"        // Note valid, waiting for wallet connection
  | "claiming"     // Processing claim transaction (withdrawal from Privacy Cash)
  | "complete"     // Claim successful
  | "already-claimed" // Note was already used
  | "error";       // Something went wrong

interface ClaimState {
  status: ClaimStatus;
  note: DoubleHopNote | null;
  withdrawTxHash: string | null;
  amountReceived: number | null;
  error: string | null;
}

/**
 * ClaimFlow Component - Double Hop Claims via Privacy Cash
 * 
 * Flow:
 * 1. Parse double hop note from URL hash
 * 2. Validate note structure and extract ephemeral keypair
 * 3. User connects wallet (destination address)
 * 4. Execute withdrawal from Privacy Cash using ephemeral wallet
 * 5. Funds sent to user's actual wallet (privacy preserved!)
 * 
 * The ephemeral wallet holds the Privacy Cash balance.
 * The recipient's address is only revealed in the final withdrawal.
 */
export function ClaimFlow() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const [state, setState] = useState<ClaimState>({
    status: "parsing",
    note: null,
    withdrawTxHash: null,
    amountReceived: null,
    error: null,
  });
  const [copied, setCopied] = useState(false);
  const [claimProgress, setClaimProgress] = useState<string>("");
  const [recipientPrivacy, setRecipientPrivacy] = useState<RecipientPrivacy>("quick");
  const [pasteAddress, setPasteAddress] = useState<string>("");
  const [useCustomAddress, setUseCustomAddress] = useState(false);
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [reclaimSuccess, setReclaimSuccess] = useState<string | null>(null);
  
  const hasStartedParsing = useRef(false);
  
  // Calculate what recipient receives based on their privacy choice
  // IMPORTANT: The calculation depends on WHERE the funds currently are:
  // - If funds are in ephemeral: Quick = direct (0 fee), Private = 1 hop (1 fee)
  // - If funds are in pool: Quick = 1 hop (1 fee), Private = 2 hops (2 fees)
  const receiveBreakdown = useMemo(() => {
    if (!state.note) return null;
    
    const amount = state.note.amount;
    const inEphemeral = state.note.fundsLocation === "ephemeral";
    const isSOL = !state.note.token || state.note.token === "SOL";
    const decimals = state.note.token === "USDC" || state.note.token === "USDT" ? 6 : 9;
    
    // Helper to calculate receives with correct params
    const calcReceives = (amt: number, privacy: "quick" | "private") => {
      if (isSOL) {
        return calculateRecipientReceives(amt, privacy);
      }
      return calculateSPLRecipientReceives(amt, privacy, decimals);
    };
    
    if (inEphemeral) {
      // Funds in ephemeral wallet
      if (recipientPrivacy === "quick") {
        // Direct transfer from ephemeral - no pool fee, just tiny tx fee
        return {
          poolAmount: amount,
          recipientReceives: amount, // Full amount (tx fee is negligible)
          fee: 0,
          privacyInfo: RECIPIENT_PRIVACY[recipientPrivacy],
        };
      } else {
        // Private: ephemeral → pool → recipient (1 withdrawal fee)
        return calcReceives(amount, "quick"); // "quick" = 1 hop
      }
    } else {
      // Funds in pool (shouldn't happen with current implementation, but handle it)
      return calcReceives(amount, recipientPrivacy);
    }
  }, [state.note, recipientPrivacy]);
  
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

  // Get user's wallet address (Solana only)
  const getUserWalletAddress = useCallback((): PublicKey | null => {
    // 1. Check linkedAccounts for Solana wallet by chainType
    const solanaWallet = user?.linkedAccounts?.find((a) => {
      const account = a as any;
      return account.type === 'wallet' && account.chainType === 'solana';
    }) as any;
    
    if (solanaWallet?.address) {
      try {
        return new PublicKey(solanaWallet.address);
      } catch {
        // Invalid Solana address
      }
    }
    
    // 2. Check if main wallet is Solana (not starting with 0x)
    const mainAddress = user?.wallet?.address;
    if (mainAddress && !mainAddress.startsWith('0x')) {
      try {
        return new PublicKey(mainAddress);
      } catch {
        // Invalid main wallet address
      }
    }
    
    // 3. No Solana wallet found
    return null;
  }, [user]);

  // Parse note from URL on mount
  useEffect(() => {
    if (hasStartedParsing.current) return;
    hasStartedParsing.current = true;

    const parseNote = async () => {

      try {
        const note = extractDoubleHopNoteFromUrl();
        
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

  // Handle claim
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
        if (!authenticated) {
          login();
        }
        return;
      }
      recipientAddress = walletAddress.toBase58();
    }
    
    if (!state.note) {
      return;
    }

    setState((prev) => ({ ...prev, status: "claiming" }));
    setClaimProgress("Initializing withdrawal...");

    try {
      setClaimProgress(recipientPrivacy === "private" 
        ? "Routing through privacy layer..." 
        : "Connecting to Privacy Cash...");
      
      // Call API route to handle Privacy Cash withdrawal (server-side)
      const response = await fetch("/api/privacy-cash/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          note: state.note,
          recipientAddress,
          recipientPrivacy,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Claim failed");
      }

      setState((prev) => ({
        ...prev,
        status: "complete",
        withdrawTxHash: result.withdrawTxHash || null,
        amountReceived: result.amountReceived || null,
      }));
    } catch (error) {
      
      // Check for specific errors
      const errorMessage = error instanceof Error ? error.message : "Claim failed";
      
      if (errorMessage.includes("insufficient") || errorMessage.includes("balance")) {
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
      // Only applicable when funds are still in the ephemeral wallet
      if (state.note.fundsLocation !== "ephemeral") {
        throw new Error("Funds are in the pool; reclaim by retrying claim.");
      }
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
      const balance = await connection.getBalance(compositeSecret.ephemeralKeypair.publicKey);
      const feeReserve = 5000;
      const toSend = Math.max(0, balance - feeReserve);
      if (toSend <= 0) throw new Error("No SOL left in ephemeral wallet");

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: compositeSecret.ephemeralKeypair.publicKey,
          toPubkey: new PublicKey(recipientAddress),
          lamports: toSend,
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = compositeSecret.ephemeralKeypair.publicKey;
      tx.sign(compositeSecret.ephemeralKeypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
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
                <div className="w-14 h-14 rounded-full bg-hop-200 dark:bg-hop-500/20 border-2 border-hop-400/50 flex items-center justify-center">
                  <Shield className="w-7 h-7 text-hop-600 dark:text-hop-400" />
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

              {/* Sender privacy indicator */}
              <div className={`p-2 rounded-lg mb-4 ${
                state.note.senderPrivacy === "basic" ? "bg-yellow-500/10 border border-yellow-500/20" :
                "bg-hop-500/10 border border-hop-500/20"
              }`}>
                <div className="flex items-center gap-2">
                  {state.note.senderPrivacy === "basic" ? (
                    <Eye className="w-4 h-4 text-yellow-500" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-hop-500" />
                  )}
                  <span className="text-xs">
                    Sender: {state.note.senderPrivacy === "basic" ? "Traceable (you can look up who sent this)" : "Hidden (ZK protected)"}
                  </span>
                </div>
              </div>

              {/* Your Privacy Level Selector */}
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-2 block">Your Privacy Level</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(RECIPIENT_PRIVACY) as RecipientPrivacy[]).map((level) => {
                    const info = RECIPIENT_PRIVACY[level];
                    const isSelected = recipientPrivacy === level;
                    // Calculate based on fundsLocation and token type
                    const amount = state.note!.amount;
                    const inEphemeral = state.note!.fundsLocation === "ephemeral";
                    const isSOL = !state.note!.token || state.note!.token === "SOL";
                    const decimals = state.note!.token === "USDC" || state.note!.token === "USDT" ? 6 : 9;
                    const calcReceives = (amt: number, priv: "quick" | "private") => 
                      isSOL ? calculateRecipientReceives(amt, priv) : calculateSPLRecipientReceives(amt, priv, decimals);
                    let receives;
                    if (inEphemeral) {
                      if (level === "quick") {
                        // Direct transfer - no pool fee
                        receives = { recipientReceives: amount, fee: 0 };
                      } else {
                        // Private: 1 hop through pool
                        receives = calcReceives(amount, "quick");
                      }
                    } else {
                      receives = calcReceives(amount, level);
                    }
                    return (
                      <button
                        key={level}
                        onClick={() => setRecipientPrivacy(level)}
                        className={`p-3 rounded-xl border-2 transition-all text-left ${
                          isSelected
                            ? level === "quick" ? "border-yellow-500 bg-yellow-500/10" : "border-hop-500 bg-hop-500/10"
                            : "border-border hover:border-muted-foreground/50 bg-background"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {level === "quick" && <Eye className="w-4 h-4 text-yellow-500" />}
                          {level === "private" && <EyeOff className="w-4 h-4 text-hop-500" />}
                          <span className="text-sm font-semibold">{info.name}</span>
                        </div>
                        <p className="text-lg font-bold">
                          {(() => {
                            const isSOL = !state.note!.token || state.note!.token === "SOL";
                            if (isSOL) {
                              return `${lamportsToSol(receives.recipientReceives).toFixed(4)} SOL`;
                            } else {
                              const decimals = state.note!.token === "USDC" || state.note!.token === "USDT" ? 6 : 9;
                              return `${(receives.recipientReceives / (10 ** decimals)).toFixed(2)} ${state.note!.token}`;
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

              {/* Privacy explanation */}
              <div className={`p-3 rounded-lg mb-4 ${
                recipientPrivacy === "quick" ? "bg-yellow-500/5 border border-yellow-500/20" :
                "bg-hop-500/5 border border-hop-500/20"
              }`}>
                <p className="text-xs text-muted-foreground">
                  {RECIPIENT_PRIVACY[recipientPrivacy].description}
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
                    {authenticated && ready ? (
                      getUserWalletAddress() ? (
                        <div className="p-3 rounded-xl bg-background border border-border">
                          <p className="font-mono text-sm">
                            {shortenAddress(getUserWalletAddress()!.toBase58(), 8)}
                          </p>
                        </div>
                      ) : (
                        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                          <p className="text-xs text-yellow-400">
                            No Solana wallet found. Try paste address instead.
                          </p>
                        </div>
                      )
                    ) : (
                      <Button 
                        onClick={login} 
                        className="w-full" 
                        variant="outline"
                        disabled={!ready}
                      >
                        <Wallet className="w-4 h-4 mr-2" />
                        {ready ? "Connect Wallet" : "Loading..."}
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
                  useCustomAddress 
                    ? !isValidPasteAddress 
                    : (!authenticated || !getUserWalletAddress())
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
              
              <p className="text-xs text-muted-foreground text-center mt-2">
                Gasless - no SOL needed to claim
              </p>
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
                {claimProgress || "Processing withdrawal from Privacy Cash..."}
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
                className="w-20 h-20 rounded-full bg-hop-500 flex items-center justify-center mx-auto"
              >
                <Check className="w-10 h-10 text-white" />
              </motion.div>
              
              <h3 className="mt-6 text-2xl font-bold">Claim Complete!</h3>
              <p className="mt-2 text-muted-foreground">
                {state.amountReceived 
                  ? `${formatSol(state.amountReceived)} SOL sent to your wallet`
                  : `${formatSol(state.note.amount)} SOL sent to your wallet`
                }
              </p>

              {/* Privacy confirmation */}
              <div className="mt-4 p-3 rounded-lg bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400/50 inline-block">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-hop-600 dark:text-hop-400" />
                  <p className="text-xs text-hop-700 dark:text-hop-300 font-medium">
                    Privacy preserved - no link to sender
                  </p>
                </div>
              </div>

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

              <div className="mt-8">
                <Button
                  variant="outline"
                  onClick={() => window.location.href = "/"}
                >
                  Back to Home
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
