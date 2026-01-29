"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, Check, Copy, ArrowRight, AlertTriangle, Shield, Lock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldingAnimation } from "./shielding-animation";
import { 
  extractDoubleHopNoteFromUrl,
  decodeCompositeSecret,
  calculateFees,
  PRIVACY_LEVELS,
  type DoubleHopNote,
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
  
  const hasStartedParsing = useRef(false);

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
    const walletAddress = getUserWalletAddress();
    
    if (!walletAddress || !state.note) {
      if (!authenticated) {
        login();
      }
      return;
    }

    setState((prev) => ({ ...prev, status: "claiming" }));
    setClaimProgress("Initializing withdrawal...");

    try {
      console.log("[Claim] Processing double hop claim...");
      console.log("[Claim] Recipient:", walletAddress.toBase58());

      setClaimProgress("Connecting to Privacy Cash...");
      
      // Call API route to handle Privacy Cash withdrawal (server-side)
      const response = await fetch("/api/privacy-cash/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          note: state.note,
          recipientAddress: walletAddress.toBase58(),
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
  const feeInfo = state.note ? calculateFees(state.note.amount) : null;

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
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-moss-500 mx-auto" />
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
            <CardContent className="py-8">
              {/* Success indicator */}
              <div className="flex justify-center mb-6">
                <div className="w-16 h-16 rounded-full bg-moss-500/20 flex items-center justify-center">
                  <Shield className="w-8 h-8 text-moss-400" />
                </div>
              </div>

              <h3 className="text-xl font-bold text-center mb-2">
                Private Payment Found
              </h3>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Connect your wallet to claim these funds
              </p>

              {/* Amount */}
              <div className="p-4 rounded-xl bg-moss-500/10 border border-moss-500/20 mb-4">
                <p className="text-sm text-muted-foreground text-center">You Will Receive</p>
                <p className="text-3xl font-bold text-moss-400 text-center">
                  {feeInfo ? formatSol(feeInfo.recipientReceives) : formatSol(state.note.amount)} SOL
                </p>
                {feeInfo && feeInfo.totalFee > 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-1">
                    (after {lamportsToSol(feeInfo.totalFee).toFixed(4)} SOL network fees)
                  </p>
                )}
              </div>

              {/* Privacy level indicator */}
              {state.note.privacyLevel && (
                <div className={`p-3 rounded-lg mb-4 ${
                  state.note.privacyLevel === "basic" ? "bg-yellow-500/10 border border-yellow-500/20" :
                  state.note.privacyLevel === "private" ? "bg-blue-500/10 border border-blue-500/20" :
                  "bg-moss-500/10 border border-moss-500/20"
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className={`w-4 h-4 ${
                      state.note.privacyLevel === "basic" ? "text-yellow-500" :
                      state.note.privacyLevel === "private" ? "text-blue-500" :
                      "text-moss-500"
                    }`} />
                    <span className="text-sm font-semibold">
                      {PRIVACY_LEVELS[state.note.privacyLevel].name} Privacy
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {PRIVACY_LEVELS[state.note.privacyLevel].description}
                  </p>
                </div>
              )}

              {/* Privacy notice */}
              <div className="p-3 rounded-lg bg-background border border-border mb-6">
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 text-moss-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    <span className="text-moss-300 font-medium">Shielded funds:</span> These funds 
                    are in a privacy pool. The sender&apos;s identity is {
                      state.note.privacyLevel === "basic" ? "discoverable if you look up the ephemeral wallet." :
                      "protected by zero-knowledge proofs."
                    }
                  </p>
                </div>
              </div>

              {/* Wallet connection / claim */}
              {authenticated && ready ? (
                getUserWalletAddress() ? (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-background border border-border">
                      <p className="text-xs text-muted-foreground mb-1">Claim to your wallet</p>
                      <p className="font-mono text-sm">
                        {shortenAddress(getUserWalletAddress()!.toBase58(), 6)}
                      </p>
                    </div>
                    <Button
                      onClick={handleClaim}
                      className="w-full"
                      size="lg"
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      Claim {feeInfo ? formatSol(feeInfo.recipientReceives) : formatSol(state.note.amount)} SOL
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <p className="text-xs text-yellow-400 font-medium mb-1">
                        ⚠️ No Solana Wallet Detected
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Please connect a Solana wallet (Phantom, Solflare) to claim.
                      </p>
                    </div>
                    <Button
                      onClick={logout}
                      className="w-full"
                      size="lg"
                      variant="outline"
                    >
                      Logout & Reconnect
                    </Button>
                  </div>
                )
              ) : (
                <Button 
                  onClick={login} 
                  className="w-full" 
                  size="lg"
                  disabled={!ready}
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  {ready ? "Connect Wallet to Claim" : "Loading..."}
                </Button>
              )}
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
                className="w-20 h-20 rounded-full bg-moss-500 flex items-center justify-center mx-auto"
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
              <div className="mt-4 p-3 rounded-lg bg-moss-500/10 border border-moss-500/20 inline-block">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-moss-400" />
                  <p className="text-xs text-moss-300">
                    Privacy preserved - no link to sender
                  </p>
                </div>
              </div>

              {/* Transaction Hash */}
              {state.withdrawTxHash && (
                <div className="mt-6 p-3 rounded-xl bg-background border border-border inline-block">
                  <button
                    onClick={() => handleCopyTxHash(state.withdrawTxHash!)}
                    className="flex items-center gap-2 text-sm font-mono text-moss-400 hover:text-moss-300"
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
