"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, Check, Copy, ArrowRight, AlertTriangle, Shield, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldingAnimation } from "./shielding-animation";
import { 
  createShieldedPoolAdapter, 
  extractNoteFromUrl,
  type ClaimNote,
  isValidNote,
} from "@/lib/privacy";
import { formatSol, shortenAddress, lamportsToSol } from "@/lib/utils";
import { PublicKey } from "@solana/web3.js";

type ClaimStatus = 
  | "parsing"      // Extracting note from URL
  | "ready"        // Note valid, waiting for wallet connection
  | "claiming"     // Processing claim transaction
  | "complete"     // Claim successful
  | "already-claimed" // Note was already used
  | "error";       // Something went wrong

interface ClaimState {
  status: ClaimStatus;
  note: ClaimNote | null;
  claimTxHash: string | null;
  error: string | null;
}

/**
 * ClaimFlow Component - Note-Based Claims
 * 
 * Flow:
 * 1. Parse claim note from URL hash
 * 2. Validate note structure
 * 3. User connects wallet (destination address)
 * 4. Execute claim transaction
 * 5. Funds sent to user's wallet
 * 
 * The funds are already in the shielded pool - we just need a destination address.
 * The note proves ownership - we just need a destination address.
 */
export function ClaimFlow() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const [state, setState] = useState<ClaimState>({
    status: "parsing",
    note: null,
    claimTxHash: null,
    error: null,
  });
  const [copied, setCopied] = useState(false);
  
  const hasStartedParsing = useRef(false);

  // Get user's wallet address (Solana only) - look for chainType: 'solana'
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
    
    // 3. No Solana wallet found - log debug info
    console.warn("[Claim] No Solana wallet found. User wallets:", 
      user?.linkedAccounts?.filter((a: any) => a.type === 'wallet').map((a: any) => ({
        address: a.address,
        chainType: a.chainType,
        chainId: a.chainId,
      }))
    );
    
    return null;
  }, [user]);

  // Parse note from URL on mount
  useEffect(() => {
    if (hasStartedParsing.current) return;
    hasStartedParsing.current = true;

    const parseNote = async () => {
      console.log("[Claim] Parsing claim note from URL...");

      try {
        const note = await extractNoteFromUrl();
        
        if (!note) {
          setState({
            status: "error",
            note: null,
            claimTxHash: null,
            error: "Invalid or missing claim note in URL",
          });
          return;
        }

        if (!isValidNote(note)) {
          setState({
            status: "error",
            note: null,
            claimTxHash: null,
            error: "Claim note is malformed or corrupted",
          });
          return;
        }

        console.log("[Claim] Valid note found!");
        console.log("[Claim] Amount:", lamportsToSol(note.amount), "SOL");
        console.log("[Claim] Commitment:", note.commitment.slice(0, 12) + "...");

        // Check if already claimed
        const adapter = createShieldedPoolAdapter();
        const noteStatus = await adapter.getNoteStatus(note.commitment);
        
        if (noteStatus?.claimed) {
          console.log("[Claim] Note already claimed by:", noteStatus.claimedBy);
          setState({
            status: "already-claimed",
            note,
            claimTxHash: null,
            error: `Already claimed${noteStatus.claimedBy ? ` by ${shortenAddress(noteStatus.claimedBy)}` : ""}`,
          });
          return;
        }

        setState({
          status: "ready",
          note,
          claimTxHash: null,
          error: null,
        });
      } catch (error) {
        console.error("[Claim] Parse error:", error);
        setState({
          status: "error",
          note: null,
          claimTxHash: null,
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
      // Only call login if not already authenticated
      if (!authenticated) {
        login();
      }
      return;
    }

    setState((prev) => ({ ...prev, status: "claiming" }));

    try {
      console.log("[Claim] Processing claim...");
      console.log("[Claim] Recipient:", walletAddress.toBase58());

      const adapter = createShieldedPoolAdapter();
      
      const result = await adapter.claimWithNote({
        note: state.note,
        recipient: walletAddress,
      });

      if (!result.success) {
        throw new Error(result.error || "Claim failed");
      }

      console.log("[Claim] Success! TxHash:", result.txHash);

      setState((prev) => ({
        ...prev,
        status: "complete",
        claimTxHash: result.txHash || null,
      }));
    } catch (error) {
      console.error("[Claim] Claim error:", error);
      setState((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "Claim failed",
      }));
    }
  };

  const handleCopyTxHash = async (hash: string) => {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
              <h3 className="mt-6 text-lg font-semibold">Reading Claim Note...</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Validating your payment link
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
                <p className="text-sm text-muted-foreground text-center">Amount</p>
                <p className="text-3xl font-bold text-moss-400 text-center">
                  {formatSol(state.note.amount)} SOL
                </p>
              </div>

              {/* Privacy notice */}
              <div className="p-3 rounded-lg bg-background border border-border mb-6">
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    These funds are in a shielded pool. Only you (with this link) 
                    and the sender can see your destination address.
                  </p>
                </div>
              </div>

              {/* Wallet connection / claim */}
              {authenticated && ready ? (
                getUserWalletAddress() ? (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-background border border-border">
                      <p className="text-xs text-muted-foreground mb-1">Claim to</p>
                      <p className="font-mono text-sm">
                        {shortenAddress(getUserWalletAddress()!.toBase58(), 6)}
                      </p>
                    </div>
                    <Button
                      onClick={handleClaim}
                      className="w-full"
                      size="lg"
                    >
                      <Wallet className="w-4 h-4 mr-2" />
                      Claim {formatSol(state.note.amount)} SOL
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
                        Please connect a Solana wallet (Phantom, Solflare) or configure Solana in your Privy dashboard.
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
              
              <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-200/80">
                    Processing your claim. Do not close this page.
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
                {formatSol(state.note.amount)} SOL sent to your wallet
              </p>

              {/* Transaction Hash */}
              {state.claimTxHash && (
                <div className="mt-6 p-3 rounded-xl bg-background border border-border inline-block">
                  <button
                    onClick={() => handleCopyTxHash(state.claimTxHash!)}
                    className="flex items-center gap-2 text-sm font-mono text-moss-400 hover:text-moss-300"
                  >
                    Tx: {shortenAddress(state.claimTxHash, 8)}
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
                This payment has already been claimed
              </CardDescription>
            </CardHeader>
            <CardContent>
              {state.note && (
                <div className="p-4 rounded-xl bg-background border border-border mb-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold">{formatSol(state.note.amount)} SOL</span>
                  </div>
                  {state.error && state.error.includes("by") && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Claimed by</span>
                      <span className="font-mono text-xs">
                        {state.error.split("by ")[1]}
                      </span>
                    </div>
                  )}
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
