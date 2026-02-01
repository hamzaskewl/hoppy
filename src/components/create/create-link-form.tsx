"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Shield, Wallet, ArrowRight, Lock, Info, AlertTriangle, Eye, EyeOff, Save, History, Trash2, ExternalLink, ChevronDown, Settings2 } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  createDoubleHopClaimUrl,
  generateCompositeSecret,
  calculateSenderCost,
  calculateRecipientReceives,
  calculateDepositForRecipientAmount,
  SENDER_PRIVACY,
  RECIPIENT_PRIVACY,
  type DoubleHopNote,
  type SenderPrivacy,
} from "@/lib/privacy";
import { shortenAddress, solToLamports, lamportsToSol } from "@/lib/utils";
import { Connection, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import bs58 from "bs58";


type Step = "connect" | "amount" | "depositing" | "complete";

/** Shown when funding succeeded but create-link API failed so user can reclaim SOL from ephemeral. */
interface FailedDepositRecovery {
  ephemeralSecretKeyBase58: string;
  ephemeralAddress: string;
  userWallet: string;
}

// ============================================================================
// Encrypted Local Storage for Links
// ============================================================================

interface SavedLink {
  id: string;
  claimUrl: string;
  amount: number; // lamports
  createdAt: number;
  status: "active" | "claimed" | "unknown";
  senderPrivacy: SenderPrivacy;
  recipientAddress?: string;
}

const STORAGE_KEY = "hoppy_links_v1";

// Simple encryption using Web Crypto API with a derived key
async function deriveKey(walletAddress: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(walletAddress + "_hoppy_local_key"),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("hoppy_salt_v1"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(data: string, walletAddress: string): Promise<string> {
  const key = await deriveKey(walletAddress);
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(data)
  );
  
  // Combine IV + encrypted data and encode as base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

async function decryptData(encryptedBase64: string, walletAddress: string): Promise<string | null> {
  try {
    const key = await deriveKey(walletAddress);
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error("[Storage] Decryption failed:", error);
    return null;
  }
}

async function saveLink(link: SavedLink, walletAddress: string): Promise<void> {
  try {
    const existingLinks = await loadLinks(walletAddress);
    const updatedLinks = [link, ...existingLinks.filter(l => l.id !== link.id)];
    
    // Keep only last 50 links
    const trimmedLinks = updatedLinks.slice(0, 50);
    
    const encrypted = await encryptData(JSON.stringify(trimmedLinks), walletAddress);
    localStorage.setItem(STORAGE_KEY, encrypted);
    console.log("[Storage] Link saved successfully");
  } catch (error) {
    console.error("[Storage] Failed to save link:", error);
  }
}

async function loadLinks(walletAddress: string): Promise<SavedLink[]> {
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY);
    if (!encrypted) return [];
    
    const decrypted = await decryptData(encrypted, walletAddress);
    if (!decrypted) return [];
    
    return JSON.parse(decrypted) as SavedLink[];
  } catch (error) {
    console.error("[Storage] Failed to load links:", error);
    return [];
  }
}

async function deleteLink(linkId: string, walletAddress: string): Promise<void> {
  try {
    const existingLinks = await loadLinks(walletAddress);
    const updatedLinks = existingLinks.filter(l => l.id !== linkId);
    
    const encrypted = await encryptData(JSON.stringify(updatedLinks), walletAddress);
    localStorage.setItem(STORAGE_KEY, encrypted);
  } catch (error) {
    console.error("[Storage] Failed to delete link:", error);
  }
}

export function CreateLinkForm() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const [step, setStep] = useState<Step>("connect");
  const [amount, setAmount] = useState<string>("0.1");
  const [currency, setCurrency] = useState<"SOL" | "USD">("SOL");
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [senderPrivacy, setSenderPrivacy] = useState<SenderPrivacy>("basic");
  const [sponsorFees, setSponsorFees] = useState(true); // Sender sponsors recipient's fees by default
  const [showAdvanced, setShowAdvanced] = useState(false); // Hide advanced options by default
  const [isDepositing, setIsDepositing] = useState(false);
  const [doubleHopNote, setDoubleHopNote] = useState<DoubleHopNote | null>(null);
  const [claimUrl, setClaimUrl] = useState<string>("");
  const [fundingTxHash, setFundingTxHash] = useState<string | null>(null);
  const [depositTxHash, setDepositTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositProgress, setDepositProgress] = useState<string>("");
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [failedDepositRecovery, setFailedDepositRecovery] = useState<FailedDepositRecovery | null>(null);
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [reclaimSuccess, setReclaimSuccess] = useState<string | null>(null);

  // Get Solana wallet address - look for chainType: 'solana'
  const getSolanaAddress = useCallback((): string | null => {
    // 1. Check linkedAccounts for Solana wallet by chainType
    const solanaWallet = user?.linkedAccounts?.find((a) => {
      const account = a as any;
      return account.type === 'wallet' && account.chainType === 'solana';
    }) as any;
    
    if (solanaWallet?.address) {
      return solanaWallet.address as string;
    }
    
    // 2. Check if main wallet is Solana (not starting with 0x)
    const mainAddress = user?.wallet?.address;
    if (mainAddress && !mainAddress.startsWith('0x')) {
      return mainAddress;
    }
    
    return null;
  }, [user]);

  // Load saved links on mount
  useEffect(() => {
    const loadSavedLinks = async () => {
      const address = getSolanaAddress();
      if (address) {
        const links = await loadLinks(address);
        setSavedLinks(links);
      }
    };
    if (authenticated) {
      loadSavedLinks();
    }
  }, [authenticated, getSolanaAddress]);

  // Fetch SOL/USD price for amount step
  useEffect(() => {
    if (step !== "amount") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sol-price");
        if (!res.ok || cancelled) return;
        const { usd } = (await res.json()) as { usd?: number };
        if (typeof usd === "number" && usd > 0 && !cancelled) setSolPrice(usd);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [step]);

  // Calculate costs based on amount and sender privacy
  const costBreakdown = useMemo(() => {
    const amountNum = parseFloat(amount) || 0;
    if (amountNum <= 0) return null;
    
    // Base amount user wants recipient to receive
    const baseRecipientAmount = solToLamports(amountNum);
    
    // Calculate what to put in pool/ephemeral for recipient
    // If sponsoring fees, we need to deposit more so recipient gets the full amount after their claim
    let poolAmount: number;
    let senderPays: number;
    let senderFee: number;
    
    const inPool = senderPrivacy === "private";
    
    // 3% buffer added to ALL transfers to ensure recipient gets enough after on-chain costs
    const BUFFER_PERCENTAGE = 0.03;
    
    if (sponsorFees) {
      // Sponsor fees: Calculate how much to deposit so recipient gets baseRecipientAmount
      // after doing a "quick" claim (1 withdrawal hop)
      if (inPool) {
        // Private sender + sponsor: Sender→Pool→Eph→Pool, recipient withdraws and gets baseRecipientAmount
        // Need to calculate: deposit X so that after 1 withdrawal, recipient gets baseRecipientAmount
        poolAmount = calculateDepositForRecipientAmount(baseRecipientAmount);
        
        // Private sender: SDK needs minimal buffer for tx fees + 3% buffer
        const MIN_TX_BUFFER = 3_000_000; // lamports (~0.003 SOL) - minimal buffer for tx fees
        const bufferAmount = Math.ceil(poolAmount * BUFFER_PERCENTAGE);
        senderPays = poolAmount + MIN_TX_BUFFER + bufferAmount;
        senderFee = senderPays - baseRecipientAmount;
      } else {
        // Basic sender + sponsor: Sender→Eph, recipient claims from ephemeral
        // Add 3% buffer to ensure enough funds arrive
        poolAmount = baseRecipientAmount;
        const bufferAmount = Math.ceil(poolAmount * BUFFER_PERCENTAGE);
        senderPays = baseRecipientAmount + bufferAmount;
        senderFee = bufferAmount;
      }
    } else {
      // Don't sponsor: Recipient pays fees from the amount
      poolAmount = baseRecipientAmount;
      const bufferAmount = Math.ceil(poolAmount * BUFFER_PERCENTAGE);
      
      if (inPool) {
        // Private sender, no sponsor: pay minimal tx buffer + 3% buffer
        const MIN_TX_BUFFER = 3_000_000;
        senderPays = baseRecipientAmount + MIN_TX_BUFFER + bufferAmount;
        senderFee = MIN_TX_BUFFER + bufferAmount;
      } else {
        // Basic sender, no sponsor: just add 3% buffer
        senderPays = baseRecipientAmount + bufferAmount;
        senderFee = bufferAmount;
      }
    }
    
    // Calculate what recipient gets based on pool amount
    // Quick = 1 withdrawal (0.006 + 0.35%). Private = 2 withdrawals (fee applied twice).
    let recipientQuick, recipientPrivate;
    if (inPool) {
      // Funds in pool: recipient pays withdrawal fee(s)
      recipientQuick = calculateRecipientReceives(poolAmount, "quick");   // 1 hop → ~0.094 on 0.1 SOL
      recipientPrivate = calculateRecipientReceives(poolAmount, "private"); // 2 hops → ~0.087 on 0.1 SOL
    } else {
      // Funds in ephemeral: quick = no fee; private = 1 hop fee
      recipientQuick = { recipientReceives: poolAmount, fee: 0 };
      recipientPrivate = calculateRecipientReceives(poolAmount, "quick");
    }
    
    return {
      baseRecipientAmount, // What user typed
      poolAmount, // What goes into pool/ephemeral
      senderPays, // Total sender pays
      senderFee, // Fee portion
      senderPrivacyInfo: SENDER_PRIVACY[senderPrivacy],
      recipientQuick: recipientQuick.recipientReceives,
      recipientPrivate: recipientPrivate.recipientReceives,
      sponsorFees,
    };
  }, [amount, senderPrivacy, sponsorFees]);

  // Move to amount step when authenticated
  const handleContinue = () => {
    if (authenticated) {
      setStep("amount");
    } else {
      login();
    }
  };

  // Handle double hop deposit
  const handleDeposit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!costBreakdown) {
      setError("Unable to calculate costs");
      return;
    }

    setError(null);
    setIsDepositing(true);
    setStep("depositing");
    setDepositProgress("Initializing...");

    try {
      // Get user's Solana wallet for signing
      const solanaAddress = getSolanaAddress();
      if (!solanaAddress) {
        throw new Error("No Solana wallet connected");
      }

      // Get Solana wallet provider (Phantom, Solflare, etc.)
      // These wallets inject their provider into window
      let solanaProvider: any = null;
      
      if (typeof window !== "undefined") {
        // Check for Phantom
        if ((window as any).phantom?.solana?.isPhantom) {
          solanaProvider = (window as any).phantom.solana;
        }
        // Check for Solflare
        else if ((window as any).solflare?.isSolflare) {
          solanaProvider = (window as any).solflare;
        }
        // Check for generic Solana provider
        else if ((window as any).solana) {
          solanaProvider = (window as any).solana;
        }
      }
      
      if (!solanaProvider) {
        throw new Error("No Solana wallet found. Please install Phantom or another Solana wallet.");
      }
      
      // Verify the connected address matches
      if (solanaProvider.publicKey?.toBase58() !== solanaAddress) {
        // Try to connect if not connected
        if (!solanaProvider.isConnected) {
          await solanaProvider.connect();
        }
      }

      setDepositProgress("Generating ephemeral wallet...");
      
      // 1. Generate composite secret (client-side)
      const compositeSecret = generateCompositeSecret();
      const ephemeralAddress = compositeSecret.ephemeralKeypair.publicKey.toBase58();
      
      // Ephemeral wallet created - private key stays in memory only

      setDepositProgress("Preparing transaction...");
      
      // 2. Create funding transaction (sender → ephemeral)
      // Add 3% buffer to ALL transfers to ensure recipient gets enough after on-chain costs
      const BUFFER_PERCENTAGE = 0.03; // 3% buffer
      const bufferAmount = Math.ceil(costBreakdown.poolAmount * BUFFER_PERCENTAGE);
      // For private: also add minimal buffer for tx fees
      const MIN_TX_BUFFER = 3_000_000; // ~0.003 SOL - minimal buffer for tx fees
      const fundingAmount = senderPrivacy === "private" 
        ? costBreakdown.poolAmount + MIN_TX_BUFFER + bufferAmount
        : costBreakdown.poolAmount + bufferAmount;
      
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      
      const fundingTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(solanaAddress),
          toPubkey: compositeSecret.ephemeralKeypair.publicKey,
          lamports: fundingAmount,
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      fundingTx.recentBlockhash = blockhash;
      fundingTx.feePayer = new PublicKey(solanaAddress);

      setDepositProgress("Please sign the transaction in your wallet...");
      
      // 3. Sign and send transaction via Solana wallet (Phantom, etc.)
      let fundingTxHash: string;
      
      if (typeof solanaProvider.signAndSendTransaction === "function") {
        // Phantom and most wallets support this
        const result = await solanaProvider.signAndSendTransaction(fundingTx);
        fundingTxHash = result.signature;
      } else if (typeof solanaProvider.signTransaction === "function") {
        // Fallback: sign then send separately
        const signedTx = await solanaProvider.signTransaction(fundingTx);
        fundingTxHash = await connection.sendRawTransaction(signedTx.serialize());
      } else {
        throw new Error("Wallet does not support transaction signing");
      }
      
      console.log("[Create] Funding transaction sent:", fundingTxHash);
      
      setDepositProgress("Waiting for transaction confirmation...");
      
      // Wait for confirmation (use "finalized" for more reliable confirmation)
      const confirmation = await connection.confirmTransaction(fundingTxHash, "finalized");
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log("[Create] Transaction confirmed!");
      
      setDepositProgress("Depositing to Privacy Cash...");
      
      // 4. Send to API to handle Privacy Cash deposit
      const response = await fetch("/api/privacy-cash/create-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: costBreakdown.poolAmount, // Pool amount (what's available for recipient)
          compositeSecret: compositeSecret.full,
          ephemeralAddress,
          fundingTxHash,
          senderPrivacy,
          senderAddress: solanaAddress, // For reclaim feature
        }),
      });

      let result;
      try {
        result = await response.json();
      } catch (jsonErr) {
        console.error("[Create] Failed to parse API response:", jsonErr);
        // Store recovery info since API crashed
        const ephemeralSecretBase58 = bs58.encode(compositeSecret.ephemeralKeypair.secretKey);
        setFailedDepositRecovery({
          ephemeralSecretKeyBase58: ephemeralSecretBase58,
          ephemeralAddress,
          userWallet: solanaAddress,
        });
        
        throw new Error("API error - your funds may be in the ephemeral wallet. Check recovery section below.");
      }

      if (!result.success || !result.note) {
        // Store recovery info so user can reclaim SOL from ephemeral if they want
        const ephemeralSecretBase58 = bs58.encode(compositeSecret.ephemeralKeypair.secretKey);
        setFailedDepositRecovery({
          ephemeralSecretKeyBase58: ephemeralSecretBase58,
          ephemeralAddress,
          userWallet: solanaAddress,
        });
        
        // Check if API returned recovery info (funds may have been auto-swept)
        if (result.recoverySuccess) {
          throw new Error("Transaction failed but funds were automatically returned to your wallet.");
        }
        
        throw new Error(result.error || "Failed to create payment link");
      }
      
      // Generate claim URL
      const url = createDoubleHopClaimUrl(result.note);
      
      setDoubleHopNote(result.note);
      setClaimUrl(url);
      setFundingTxHash(result.fundingTxHash || null);
      setDepositTxHash(result.depositTxHash || null);
      
      // Auto-copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
        console.log("[Create] Link auto-copied to clipboard");
      } catch (copyErr) {
        console.error("[Create] Failed to auto-copy:", copyErr);
      }
      
      // Save to encrypted local storage
      const savedLink: SavedLink = {
        id: compositeSecret.claimId,
        claimUrl: url,
        amount: costBreakdown.poolAmount,
        createdAt: Date.now(),
        status: "active",
        senderPrivacy,
      };
      
      await saveLink(savedLink, solanaAddress);
      const updatedLinks = await loadLinks(solanaAddress);
      setSavedLinks(updatedLinks);
      
      setStep("complete");

      console.log("[Create] Double hop complete!");
      console.log("[Create] Claim URL:", url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deposit failed";
      const isUserRejection =
        /rejected|denied|cancelled|canceled/i.test(message) ||
        (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 4001);
      if (isUserRejection) {
        // User clicked Reject in Phantom/wallet – not an error, just cancelled
        setError("Transaction cancelled");
        if (process.env.NODE_ENV === "development") {
          console.log("[Create] User cancelled transaction");
        }
      } else {
        console.error("[Create] Deposit error:", err);
        setError(message);
      }
      setStep("amount");
    } finally {
      setIsDepositing(false);
      setDepositProgress("");
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setStep("amount");
    setDoubleHopNote(null);
    setClaimUrl("");
    setFundingTxHash(null);
    setDepositTxHash(null);
    setAmount("0.1");
    setError(null);
    setFailedDepositRecovery(null);
    setReclaimSuccess(null);
  };

  const feeCoverage = costBreakdown
    ? Math.max(0, costBreakdown.senderFee)
    : 0;

  const handleReclaim = async () => {
    if (!failedDepositRecovery) return;
    setIsReclaiming(true);
    setError(null);
    try {
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      const ephemeralKeypair = Keypair.fromSecretKey(bs58.decode(failedDepositRecovery.ephemeralSecretKeyBase58));
      const balance = await connection.getBalance(ephemeralKeypair.publicKey);
      const feeReserve = 5000; // leave for tx fee
      const toSend = Math.max(0, balance - feeReserve);
      if (toSend <= 0) {
        setError("No SOL left in ephemeral wallet to reclaim.");
        return;
      }
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: ephemeralKeypair.publicKey,
          toPubkey: new PublicKey(failedDepositRecovery.userWallet),
          lamports: toSend,
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = ephemeralKeypair.publicKey;
      tx.sign(ephemeralKeypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
      await connection.confirmTransaction(sig, "confirmed");
      setError(null);
      setFailedDepositRecovery(null);
      setReclaimSuccess("Reclaimed! SOL sent back to your wallet.");
      setTimeout(() => setReclaimSuccess(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reclaim failed");
    } finally {
      setIsReclaiming(false);
    }
  };

  if (!ready) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-hop-500 mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className={step === "amount" ? "pb-2" : "text-center pb-2"}>
        <CardTitle className="text-xl">
          {step === "connect" && "Create Payment Link"}
          {step === "amount" && "Send Payment"}
          {step === "depositing" && "Creating Link..."}
          {step === "complete" && "Link Ready!"}
        </CardTitle>
        {step !== "amount" && (
          <CardDescription>
            {step === "connect" && "Connect your wallet to get started"}
            {step === "depositing" && "Processing your payment"}
            {step === "complete" && "Share this link with the recipient"}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Step 1: Connect Wallet */}
        {step === "connect" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-hop-100 dark:bg-hop-900/30 border-2 border-hop-400/50">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-hop-600 dark:text-hop-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-hop-700 dark:text-hop-300">Double Hop Privacy</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your payment goes through an ephemeral wallet and Privacy Cash. 
                    No one can link your wallet to the recipient.
                  </p>
                </div>
              </div>
            </div>

            {authenticated ? (
              getSolanaAddress() ? (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-card border-2 border-border">
                    <p className="text-xs text-muted-foreground mb-1">Connected Wallet (Solana)</p>
                    <p className="font-mono text-sm font-medium">
                      {shortenAddress(getSolanaAddress()!, 6)}
                    </p>
                  </div>
                  <Button onClick={handleContinue} className="w-full" size="lg">
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-honey-100 dark:bg-yellow-900/20 border-2 border-honey-400">
                    <p className="text-xs text-honey-700 dark:text-yellow-400 font-medium mb-1">No Solana Wallet</p>
                    <p className="text-xs text-muted-foreground">
                      You're connected with an EVM wallet. Please logout and connect with <strong>Phantom</strong> or another Solana wallet.
                    </p>
                  </div>
                  <Button onClick={logout} className="w-full" variant="outline">
                    Logout & Connect Solana Wallet
                  </Button>
                </div>
              )
            ) : (
              <Button onClick={login} className="w-full" size="lg">
                <Wallet className="w-4 h-4 mr-2" />
                Connect Wallet
              </Button>
            )}
          </div>
        )}

        {/* Step 2: Enter Amount - Two Column Layout */}
        {step === "amount" && (
          <div className="space-y-6">
            {reclaimSuccess && (
              <div className="p-3 rounded-xl bg-green-500/10 border-2 border-green-500/30 text-green-700 dark:text-green-400 text-sm">
                {reclaimSuccess}
              </div>
            )}
            {/* Recovery: deposit failed after funding – SOL is in ephemeral wallet */}
            {failedDepositRecovery && (
              <div className="p-4 rounded-xl bg-amber-500/10 border-2 border-amber-500/30 space-y-3">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Deposit failed. Your SOL is still in the ephemeral wallet. Reclaim it below.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(failedDepositRecovery.ephemeralSecretKeyBase58)}
                    className="border-amber-500/50"
                  >
                    {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                    Copy ephemeral secret key
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleReclaim}
                    disabled={isReclaiming}
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    {isReclaiming ? "Reclaiming..." : "Reclaim to my wallet"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Or import the secret key in Phantom (Settings → Add / Import Wallet) to move the SOL manually.
                </p>
              </div>
            )}

            <div className="grid md:grid-cols-[1.2fr,1fr] gap-6">
              {/* LEFT: Amount Input */}
              <div className="space-y-4">
                {/* Amount Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Amount</label>
                    <div className="flex rounded-lg border-2 border-border overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setCurrency("SOL")}
                        className={`px-3 py-1 text-xs font-medium transition-colors ${currency === "SOL" ? "bg-hop-500 text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
                      >
                        SOL
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrency("USD")}
                        className={`px-3 py-1 text-xs font-medium transition-colors ${currency === "USD" ? "bg-hop-500 text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
                      >
                        USD
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={currency === "USD" && solPrice
                        ? ((parseFloat(amount) || 0) * solPrice).toFixed(2)
                        : amount
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        // Allow empty, numbers, and single decimal point
                        if (v === "" || /^\d*\.?\d*$/.test(v)) {
                          if (currency === "SOL") {
                            setAmount(v); // Allow empty
                          } else {
                            const usd = parseFloat(v) || 0;
                            if (solPrice && solPrice > 0) setAmount((usd / solPrice).toFixed(6));
                            else setAmount(v); // Allow empty
                          }
                        }
                      }}
                      onBlur={(e) => {
                        const v = e.target.value;
                        if (v === "" || parseFloat(v) === 0) {
                          // Leave empty or set to 0.1 only if completely empty
                          setAmount(v === "" ? "" : "0.1");
                        } else {
                          // Remove leading zeros: 010 → 10
                          const num = parseFloat(v);
                          if (!isNaN(num)) setAmount(num.toString());
                        }
                      }}
                      placeholder={currency === "SOL" ? "0.00" : "0"}
                      className="text-3xl h-16 text-left font-bold bg-card border-2 border-border focus:border-hop-500 pl-4 pr-14"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg text-muted-foreground font-semibold">
                      {currency === "SOL" ? "SOL" : "USD"}
                    </span>
                  </div>
                  {currency === "USD" && solPrice && (
                    <p className="text-xs text-muted-foreground">
                      ≈ {(parseFloat(amount) || 0).toFixed(4)} SOL · 1 SOL = ${solPrice.toFixed(2)}
                    </p>
                  )}
                  {/* Quick amounts */}
                  <div className="flex gap-2">
                    {(currency === "SOL" || !solPrice
                      ? ["0.1", "0.5", "1", "5"]
                      : ["10", "50", "100", "500"]
                    ).map((val) => {
                      const isUsd = currency === "USD" && solPrice;
                      const solEquivalent = isUsd ? (parseFloat(val) / solPrice!).toFixed(6) : val;
                      const isSelected = isUsd ? amount === solEquivalent : amount === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            if (isUsd) setAmount((parseFloat(val) / solPrice!).toFixed(6));
                            else setAmount(val);
                          }}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all border-2 ${
                            isSelected ? "bg-hop-500 text-white border-hop-600" : "bg-card border-border hover:border-hop-400"
                          }`}
                        >
                          {isUsd ? `$${val}` : val}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Options Toggle */}
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Settings2 className="w-4 h-4" />
                  <span>Options</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </button>

                {/* Cost Breakdown + Cover fees - Shows when Options expanded */}
                {showAdvanced && costBreakdown && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-secondary border-2 border-border space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount</span>
                        <span>{lamportsToSol(costBreakdown.baseRecipientAmount).toFixed(4)} SOL</span>
                      </div>
                      {feeCoverage > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Recipient fee coverage</span>
                          <span className="text-honey-600 dark:text-honey-400">+{lamportsToSol(feeCoverage).toFixed(4)}</span>
                        </div>
                      )}
                      <div className="border-t border-border pt-2 flex justify-between font-semibold">
                        <span>Total</span>
                        <span className="text-hop-600 dark:text-hop-400">{lamportsToSol(costBreakdown.senderPays).toFixed(4)} SOL</span>
                      </div>
                    </div>
                    <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      sponsorFees 
                        ? "bg-hop-100 dark:bg-hop-900/20 border-hop-400"
                        : "bg-card border-border hover:border-hop-400"
                    }`}>
                      <input
                        type="checkbox"
                        checked={sponsorFees}
                        onChange={(e) => setSponsorFees(e.target.checked)}
                        className="w-4 h-4 rounded border-hop-500 text-hop-500 focus:ring-hop-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Cover fees</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {sponsorFees ? "Recipient gets full amount" : "Recipient pays fees"}
                        </p>
                      </div>
                    </label>
                  </div>
                )}
              </div>

              {/* RIGHT: Privacy */}
              <div className="space-y-4">
                {/* Privacy Toggle */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Privacy</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSenderPrivacy("basic")}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${
                        senderPrivacy === "basic"
                          ? "bg-honey-100 dark:bg-honey-900/30 border-2 border-honey-500"
                          : "bg-card border-2 border-border hover:border-honey-400"
                      }`}
                    >
                      <Eye className={`w-5 h-5 ${senderPrivacy === "basic" ? "text-honey-600" : "text-muted-foreground"}`} />
                      <span className={`text-sm font-medium ${senderPrivacy === "basic" ? "text-honey-700 dark:text-honey-300" : ""}`}>Basic</span>
                      <span className="text-[10px] text-muted-foreground">Free</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSenderPrivacy("private")}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${
                        senderPrivacy === "private"
                          ? "bg-hop-200 dark:bg-hop-900/30 border-2 border-hop-500"
                          : "bg-card border-2 border-border hover:border-hop-400"
                      }`}
                    >
                      <EyeOff className={`w-5 h-5 ${senderPrivacy === "private" ? "text-hop-600" : "text-muted-foreground"}`} />
                      <span className={`text-sm font-medium ${senderPrivacy === "private" ? "text-hop-700 dark:text-hop-300" : ""}`}>Private</span>
                      <span className="text-[10px] text-muted-foreground">~0.006 SOL</span>
                    </button>
                  </div>
                </div>

                {/* Recipient gets - show max (quick claim amount). Claimer sees reduced amount when they choose quick vs private on claim page. */}
                {costBreakdown && (
                  <div className="p-3 rounded-xl bg-hop-100/50 dark:bg-hop-900/20 border-2 border-hop-300 dark:border-hop-700">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Recipient gets (max)</p>
                    <p className="text-lg font-bold text-hop-700 dark:text-hop-300">
                      {lamportsToSol(costBreakdown.recipientQuick).toFixed(4)} SOL
                    </p>
                  </div>
                )}

                {/* Create Button - under Recipient gets */}
                <Button
                  onClick={handleDeposit}
                  loading={isDepositing}
                  className="w-full h-12 font-semibold"
                  size="lg"
                  disabled={!costBreakdown || costBreakdown.senderPays <= 0}
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Create · {lamportsToSol(costBreakdown?.senderPays || 0).toFixed(4)} SOL
                </Button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/20 border-2 border-red-400 dark:border-red-700">
                <p className="text-sm text-red-700 dark:text-red-400 font-medium">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Depositing */}
        {step === "depositing" && (
          <div className="py-8 text-center">
            <div className="relative w-24 h-24 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-hop-500/30 animate-ping" />
              <div className="absolute inset-2 rounded-full border-4 border-hop-500/50 animate-pulse" />
              <div className="absolute inset-4 rounded-full bg-hop-200 dark:bg-hop-500/20 flex items-center justify-center">
                <Shield className="w-8 h-8 text-hop-600 dark:text-hop-400 animate-pulse" />
              </div>
            </div>
            <h3 className="mt-6 text-lg font-semibold">Creating Payment Link</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {depositProgress || "Processing..."}
            </p>
            
            <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-300 dark:border-amber-500/30">
              <div className="flex items-start gap-2 justify-center">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-200/80 font-medium">
                  Do not close this page. This may take a minute.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === "complete" && doubleHopNote && (
          <div className="space-y-4">
            {/* Success Banner */}
            <div className="p-4 rounded-xl bg-hop-200 dark:bg-hop-500/20 border-2 border-hop-500 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Check className="w-5 h-5 text-hop-600 dark:text-hop-400" />
                <span className="font-semibold text-hop-700 dark:text-hop-300">Link Created & Copied!</span>
              </div>
              <p className="text-xs text-muted-foreground">
                The claim link has been automatically copied to your clipboard and saved locally.
              </p>
            </div>

            {/* QR Code with Logo (Original) */}
            <div className="flex justify-center">
              <div className="p-4 bg-white rounded-2xl border-2 border-border">
                <QRCodeSVG
                  value={claimUrl}
                  size={180}
                  level="H"
                  includeMargin={false}
                  imageSettings={{
                    src: "/hoppy-logo.png",
                    x: undefined,
                    y: undefined,
                    height: 52,
                    width: 52,
                    excavate: true,
                  }}
                />
              </div>
            </div>

            {/* Amount */}
            <div className="p-4 rounded-xl bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400 text-center">
              <p className="text-sm text-muted-foreground">Recipient Will Receive (Quick Claim)</p>
              <p className="text-2xl font-bold text-hop-700 dark:text-hop-400">
                ~{lamportsToSol(doubleHopNote.fundsLocation === "pool" 
                  ? calculateRecipientReceives(doubleHopNote.amount, "quick").recipientReceives 
                  : doubleHopNote.amount
                ).toFixed(4)} SOL
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Pool balance: {lamportsToSol(doubleHopNote.amount).toFixed(4)} SOL
              </p>
            </div>

            {/* Claim URL */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground font-medium">Claim Link</label>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-card border-2 border-border">
                <code className="flex-1 text-xs font-mono truncate">
                  {claimUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopy(claimUrl)}
                  className="h-8 w-8 flex-shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-hop-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Transaction Hashes */}
            <div className="space-y-2">
              {fundingTxHash && (
                <div className="p-3 rounded-xl bg-card border-2 border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Ephemeral Funding</span>
                    <button
                      onClick={() => handleCopy(fundingTxHash)}
                      className="flex items-center gap-1 text-xs font-mono text-hop-600 dark:text-hop-400 hover:text-hop-700 dark:hover:text-hop-300"
                    >
                      {shortenAddress(fundingTxHash, 6)}
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              )}
              
              {depositTxHash && (
                <div className="p-3 rounded-xl bg-card border-2 border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Privacy Cash Deposit</span>
                    <button
                      onClick={() => handleCopy(depositTxHash)}
                      className="flex items-center gap-1 text-xs font-mono text-hop-600 dark:text-hop-400 hover:text-hop-700 dark:hover:text-hop-300"
                    >
                      {shortenAddress(depositTxHash, 6)}
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Privacy Notice */}
            <div className="p-3 rounded-lg bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400/50">
              <div className="flex items-start gap-2">
                <Save className="w-4 h-4 text-hop-600 dark:text-hop-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-hop-700 dark:text-hop-200/80">
                  <strong>Saved locally:</strong> This link is encrypted and stored in your browser. 
                  Only you can access it. View your history anytime.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleCopy(claimUrl)}
                className="flex-1"
              >
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                Copy Link
              </Button>
              <Button variant="outline" onClick={handleReset}>
                Create Another
              </Button>
            </div>
          </div>
        )}

        {/* Saved Links History */}
        {authenticated && savedLinks.length > 0 && step !== "depositing" && (
          <div className="mt-6 pt-6 border-t-2 border-border">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <History className="w-4 h-4" />
              <span>Your Saved Links ({savedLinks.length})</span>
              <ArrowRight className={`w-4 h-4 ml-auto transition-transform ${showHistory ? "rotate-90" : ""}`} />
            </button>
            
            {showHistory && (
              <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
                {savedLinks.map((link) => (
                  <div
                    key={link.id}
                    className="p-3 rounded-xl bg-card border-2 border-border"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">
                        {lamportsToSol(link.amount).toFixed(4)} SOL
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        link.status === "active" 
                          ? "bg-hop-200 dark:bg-hop-500/20 text-hop-700 dark:text-hop-400"
                          : link.status === "claimed"
                          ? "bg-gray-200 dark:bg-gray-500/20 text-gray-600 dark:text-gray-400"
                          : "bg-honey-100 dark:bg-yellow-500/20 text-honey-700 dark:text-yellow-400"
                      }`}>
                        {link.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono truncate text-muted-foreground">
                        {link.claimUrl}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(link.claimUrl)}
                        className="h-6 w-6 flex-shrink-0"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          const address = getSolanaAddress();
                          if (address) {
                            await deleteLink(link.id, address);
                            const updated = await loadLinks(address);
                            setSavedLinks(updated);
                          }
                        }}
                        className="h-6 w-6 flex-shrink-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                      <span>{new Date(link.createdAt).toLocaleDateString()}</span>
                      <span className={link.senderPrivacy === "private" 
                        ? "text-hop-600 dark:text-hop-400" 
                        : "text-honey-600 dark:text-yellow-400"
                      }>
                        {link.senderPrivacy === "private" ? "Private" : "Basic"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
