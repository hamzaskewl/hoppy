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
  RECIPIENT_PRIVACY,
  SENDER_PRIVACY,
  type DoubleHopNote,
  type RecipientPrivacy,
} from "@/lib/privacy";
import { formatSol, shortenAddress, lamportsToSol } from "@/lib/utils";
import { PublicKey } from "@solana/web3.js";

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
  
  const hasStartedParsing = useRef(false);
  
  // Calculate what recipient receives based on their privacy choice
  const receiveBreakdown = useMemo(() => {
    if (!state.note) return null;
    return calculateRecipientReceives(state.note.amount, recipientPrivacy);
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
    const solanaWallet = user?.linkedAccounts?.find((a: any) => 
      a.type === 'wallet' && a.chainType === 'solana'
    );
    
    if (solanaWallet?.address) {
      try {
        console.log("[Claim] Found Solana wallet:", solanaWallet.address);
        return new PublicKey(solanaWallet.address);
      } catch (error) {
        console.error("[Claim] Invalid Solana address:", error);
      }
    }
    
    // 2. Check if main wallet is Solana (not starting with 0x)
    const mainAddress = user?.wallet?.address;
    if (mainAddress && !mainAddress.startsWith('0x')) {
      try {
        console.log("[Claim] Main wallet is Solana:", mainAddress);
        return new PublicKey(mainAddress);
      } catch (error) {
        console.error("[Claim] Invalid main wallet address:", error);
      }
    }
    
    // 3. No Solana wallet found
    console.warn("[Claim] No Solana wallet found.");
    return null;
  }, [user]);

  // Parse note from URL on mount
  useEffect(() => {
    if (hasStartedParsing.current) return;
    hasStartedParsing.current = true;

    const parseNote = async () => {
      console.log("[Claim] Parsing double hop note from URL...");

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

        console.log("[Claim] Valid double hop note found!");
        console.log("[Claim] Amount:", lamportsToSol(note.amount), "SOL");
        console.log("[Claim] Ephemeral:", note.ephemeralAddress.slice(0, 8) + "...");

        // TODO: Check if already claimed by querying Privacy Cash balance
        // For now, we'll try to claim and handle errors

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
      console.log("[Claim] Processing claim...");
      console.log("[Claim] Recipient:", recipientAddress);
      console.log("[Claim] Privacy level:", recipientPrivacy);

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

      console.log("[Claim] Success! TxHash:", result.withdrawTxHash);
      console.log("[Claim] Amount received:", result.amountReceived);

      setState((prev) => ({
        ...prev,
        status: "complete",
        withdrawTxHash: result.withdrawTxHash || null,
        amountReceived: result.amountReceived || null,
      }));
    } catch (error) {
      console.error("[Claim] Claim error:", error);
      
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
                {lamportsToSol(state.note.amount).toFixed(4)} SOL available in pool
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
                    const receives = calculateRecipientReceives(state.note!.amount, level);
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
                          {lamportsToSol(receives.recipientReceives).toFixed(4)} SOL
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
                Claim {receiveBreakdown ? lamportsToSol(receiveBreakdown.recipientReceives).toFixed(4) : "0"} SOL
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
              
              <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-200/80">
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
                    <span className="font-semibold">{formatSol(state.note.amount)} SOL</span>
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
