"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Copy, Check, Wallet, ArrowRight, Lock, AlertTriangle, Save, History, Trash2, ExternalLink, ChevronDown, Settings2, QrCode, Download, Undo2, X, RefreshCw, Zap } from "lucide-react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createClaimUrl,
  generateEphemeralKey,
  decodeCompositeSecret,
  extractNoteFromUrl,
  calculateSenderCost,
  estimatePrivateClaimReceives,
  EPHEMERAL_GAS_BUFFER,
  WSOL_ATA_RENT,
  UMBRA_FEE_PERCENT,
  TOKEN_MINTS,
  WSOL_MINT,
  getUmbraConfig,
  SENDER_PRIVACY,
  createUmbraClientFromKeypair,
  ensureRegistered,
  getRelayer,
  type UmbraNote,
  type SupportedToken,
  type SenderPrivacy,
} from "@/lib/privacy";
import { shortenAddress, solToLamports, lamportsToSol } from "@/lib/utils";
import { Connection, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
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
  status: "active" | "claimed" | "recalled" | "dust" | "unknown";
  senderPrivacy?: string; // legacy field, always "private" for new links
  recipientAddress?: string;
}

const STORAGE_KEY = "hoppy_links_v1";
const RECOVERY_KEY = "hoppy_recovery_v1";

// Simple encryption using Web Crypto API with a derived key
async function deriveKey(walletAddress: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const rawKey = encoder.encode(walletAddress + "_hoppy_local_key");
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    rawKey.buffer as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const salt = encoder.encode("hoppy_salt_v1");
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
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
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    encoder.encode(data).buffer as ArrayBuffer
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
    
    let combined: Uint8Array;
    try {
      combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    } catch {
      // Invalid base64 - corrupted data, clear it
      console.warn("[Storage] Corrupted data in localStorage, clearing");
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    
    // Need at least 12 bytes for IV + some ciphertext
    if (combined.length <= 12) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      encrypted.buffer as ArrayBuffer
    );
    
    return new TextDecoder().decode(decrypted);
  } catch {
    // Decryption failed - likely encrypted with a different wallet address.
    // This is normal when switching wallets. Don't clear storage since
    // the data may belong to another wallet.
    console.warn("[Storage] Decryption failed (wallet mismatch or stale data)");
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
  } catch {
    // Storage save failed silently
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

function saveRecovery(recovery: FailedDepositRecovery): void {
  try {
    const existing = loadRecoveries();
    // Prepend, dedup by ephemeral address, keep last 20
    const updated = [recovery, ...existing.filter(r => r.ephemeralAddress !== recovery.ephemeralAddress)].slice(0, 20);
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(updated));
  } catch { /* silent */ }
}

function loadRecoveries(): FailedDepositRecovery[] {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FailedDepositRecovery[];
  } catch {
    return [];
  }
}

function clearRecovery(ephemeralAddress: string): void {
  try {
    const existing = loadRecoveries();
    const updated = existing.filter(r => r.ephemeralAddress !== ephemeralAddress);
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(updated));
  } catch { /* silent */ }
}

export function CreateLinkForm() {
  const { publicKey, connected, sendTransaction, wallet: connectedWallet, disconnect } = useWallet();
  const { connection: walletConnection } = useConnection();
  const { setVisible: openWalletModal } = useWalletModal();
  const [step, setStep] = useState<Step>("connect");
  // Wallet balance tracking for embedded wallets
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState<string>("0.1");
  const [displayAmount, setDisplayAmount] = useState<string>("0.1");
  const [currency, setCurrency] = useState<"SOL" | "USD">("SOL");
  const [selectedToken, setSelectedToken] = useState<SupportedToken>("SOL");
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false); // Hide advanced options by default
  const [isDepositing, setIsDepositing] = useState(false);
  const [umbraNote, setUmbraNote] = useState<UmbraNote | null>(null);
  const [claimUrl, setClaimUrl] = useState<string>("");
  const [fundingTxHash, setFundingTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositProgress, setDepositProgress] = useState<string>("");
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [showTokenDropdown, setShowTokenDropdown] = useState(false);
  const [failedDepositRecovery, setFailedDepositRecovery] = useState<FailedDepositRecovery | null>(null);
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [reclaimSuccess, setReclaimSuccess] = useState<string | null>(null);
  // Recall modal state
  const [recallModalLink, setRecallModalLink] = useState<SavedLink | null>(null);
  const [recallDestination, setRecallDestination] = useState<"sender" | "custom">("sender");
  const [recallCustomAddress, setRecallCustomAddress] = useState("");
  const [isRecalling, setIsRecalling] = useState(false);
  const [recallError, setRecallError] = useState<string | null>(null);
  const [senderPrivacy, setSenderPrivacy] = useState<SenderPrivacy>("basic");

  // Get connected Solana wallet address
  const getSolanaAddress = useCallback((): string | null => {
    return publicKey?.toBase58() || null;
  }, [publicKey]);

  // Minimum balance needed to perform a transfer (tx fee + rent buffer)
  const MIN_WITHDRAWABLE_BALANCE = 10000; // 0.00001 SOL - absolute minimum for tx fees
  const DUST_THRESHOLD = 15000000; // 0.015 SOL - below this is dust (fees + minimum practical amount)
  
  // Check on-chain status of a single link
  const checkLinkStatus = useCallback(async (link: SavedLink): Promise<SavedLink> => {
    // If already marked as claimed or recalled, don't re-check
    if (link.status === "claimed" || link.status === "recalled" || link.status === "dust") {
      return link;
    }
    
    // First check: if the saved amount is below dust threshold, mark as dust immediately
    // This handles old link formats that can't be parsed
    if (link.amount < DUST_THRESHOLD) {
      return { ...link, status: "dust" };
    }
    
    try {
      const note = extractNoteFromUrl(link.claimUrl);
      if (!note) {
        // Can't parse link - if amount is small, mark as dust
        if (link.amount < DUST_THRESHOLD) {
          return { ...link, status: "dust" };
        }
        return link;
      }

      const compositeSecret = decodeCompositeSecret(note.secret);
      if (!compositeSecret) {
        if (link.amount < DUST_THRESHOLD) {
          return { ...link, status: "dust" };
        }
        return link;
      }

      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      const ephemeralPubkey = compositeSecret.ephemeralKeypair.publicKey;
      const balance = await connection.getBalance(ephemeralPubkey);
      
      // If balance is basically empty, it's been claimed
      if (balance < MIN_WITHDRAWABLE_BALANCE) {
        return { ...link, status: "claimed" };
      }
      
      // If balance is too low to be worth withdrawing (dust)
      if (balance < DUST_THRESHOLD) {
        return { ...link, status: "dust" };
      }
      
      return { ...link, status: "active" };
    } catch {
      // If we can't check, mark small amounts as dust
      if (link.amount < DUST_THRESHOLD) {
        return { ...link, status: "dust" };
      }
      return link;
    }
  }, []);

  // Refresh status of all saved links
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const refreshAllLinkStatuses = useCallback(async () => {
    const address = getSolanaAddress();
    if (!address || savedLinks.length === 0) return;
    
    setIsRefreshingStatus(true);
    try {
      const updatedLinks = await Promise.all(
        savedLinks.map(link => checkLinkStatus(link))
      );
      
      setSavedLinks(updatedLinks);
      
      // Save updated statuses to localStorage
      const encrypted = await encryptData(JSON.stringify(updatedLinks), address);
      localStorage.setItem(STORAGE_KEY, encrypted);
    } catch (error) {
      console.error("Failed to refresh link statuses:", error);
    } finally {
      setIsRefreshingStatus(false);
    }
  }, [getSolanaAddress, savedLinks, checkLinkStatus]);

  // Load saved links on mount
  useEffect(() => {
    const loadSavedLinks = async () => {
      const address = getSolanaAddress();
      if (address) {
        const links = await loadLinks(address);
        setSavedLinks(links);
      }
    };
    if (connected) {
      loadSavedLinks();
    }
  }, [connected, getSolanaAddress]);

  // Load persisted recovery info on mount
  useEffect(() => {
    if (!connected) return;
    const address = getSolanaAddress();
    if (!address) return;
    const recoveries = loadRecoveries();
    // Show the most recent recovery for this wallet
    const mine = recoveries.find(r => r.userWallet === address);
    if (mine && !failedDepositRecovery) {
      setFailedDepositRecovery(mine);
    }
  }, [connected, getSolanaAddress]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Fetch wallet balance when on amount step
  useEffect(() => {
    if (step !== "amount" && step !== "connect") return;
    const addr = getSolanaAddress();
    if (!addr || !connected) return;

    let cancelled = false;
    const fetchBalance = async () => {
      try {
        const balance = await walletConnection.getBalance(new PublicKey(addr));
        if (!cancelled) setWalletBalance(balance);
      } catch {
        if (!cancelled) setWalletBalance(null);
      }
    };
    fetchBalance();
    return () => { cancelled = true; };
  }, [step, connected, getSolanaAddress, walletConnection]);

  // Calculate costs based on amount, token, and sender privacy
  const costBreakdown = useMemo(() => {
    const amountNum = parseFloat(amount) || 0;
    if (amountNum <= 0) return null;

    if (selectedToken === "SOL") {
      const baseRecipientAmount = solToLamports(amountNum);

      if (senderPrivacy === "basic") {
        // Basic: direct transfer to ephemeral. No Umbra. Just tx fees.
        const claimGasReserve = 5000; // ephemeral needs this for claim tx fee
        return {
          token: selectedToken,
          decimals: 9,
          baseRecipientAmount,
          commission: 0,
          gasBuffer: claimGasReserve,
          senderPays: baseRecipientAmount + claimGasReserve,
          senderFee: claimGasReserve,
          senderPaysGasLamports: 0,
          recipientQuick: baseRecipientAmount,
          recipientPrivate: baseRecipientAmount,
        };
      }

      // Private: Umbra mixer. ~0.21% commission (35 BPS) + gas for registration/wrap/UTXO.
      // NOTE: Private send not yet available on web (requires TG bot).
      const cost = calculateSenderCost(baseRecipientAmount, "private");
      return {
        token: selectedToken,
        decimals: 9,
        baseRecipientAmount,
        commission: cost.senderFee - EPHEMERAL_GAS_BUFFER,
        gasBuffer: EPHEMERAL_GAS_BUFFER,
        senderPays: cost.senderPays,
        senderFee: cost.senderFee,
        senderPaysGasLamports: 0,
        recipientQuick: baseRecipientAmount,
        recipientPrivate: baseRecipientAmount,
      };
    }

    // SPL path (USDC, USDT) — always basic for now
    const decimals = TOKEN_MINTS[selectedToken].decimals;
    const baseRecipientAmount = Math.round(amountNum * 10 ** decimals);
    const gasBuffer = EPHEMERAL_GAS_BUFFER;

    return {
      token: selectedToken,
      decimals,
      baseRecipientAmount,
      commission: 0,
      gasBuffer,
      senderPays: baseRecipientAmount,
      senderFee: 0,
      senderPaysGasLamports: gasBuffer,
      recipientQuick: baseRecipientAmount,
      recipientPrivate: baseRecipientAmount,
    };
  }, [amount, selectedToken, senderPrivacy]);

  // Move to amount step when connected
  const handleContinue = () => {
    if (connected) {
      setStep("amount");
    } else {
      openWalletModal(true);
    }
  };

  // Handle deposit (basic: direct transfer; private: Umbra mixer via two ephemeral keypairs)
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

    // Pre-check: verify balance before attempting tx
    if (walletBalance !== null) {
      const neededLamports = selectedToken === "SOL"
        ? costBreakdown.senderPays
        : (costBreakdown.senderPaysGasLamports + 5_000_000);
      if (walletBalance < neededLamports) {
        setError(
          `Insufficient balance. You have ${lamportsToSol(walletBalance).toFixed(4)} SOL but need ~${lamportsToSol(neededLamports).toFixed(4)} SOL.`
        );
        return;
      }
    }

    // Private send only supports SOL for now
    if (senderPrivacy === "private" && selectedToken !== "SOL") {
      setError("Private send is currently only available for SOL.");
      return;
    }

    setError(null);
    setIsDepositing(true);
    setStep("depositing");
    setDepositProgress("Initializing...");

    // Track ephemeral info for recovery
    let ephemeralSecretBase58 = "";
    let ephemeralAddress = "";
    let solanaAddress = "";

    try {
      // Get user's Solana wallet for signing
      solanaAddress = getSolanaAddress() || "";
      if (!solanaAddress) {
        throw new Error("No Solana wallet connected");
      }

      if (!connected || !publicKey) {
        throw new Error("No Solana wallet connected. Please connect a wallet.");
      }

      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      const senderPubkey = new PublicKey(solanaAddress);

      if (senderPrivacy === "private" && selectedToken === "SOL") {
        // ── PRIVATE SEND: User → eph → Umbra pool (self-claimable UTXO) ──
        // ONE ephemeral: deposits into mixer, claim URL has eph seed.
        // Claimer reconstructs eph, claims UTXO, sends to their wallet.
        // Privacy: mixer breaks the on-chain link between deposit and claim.

        setDepositProgress("Generating ephemeral wallet...");
        const eph = generateEphemeralKey();
        ephemeralAddress = eph.address;
        ephemeralSecretBase58 = bs58.encode(eph.keypair.secretKey);

        // Calculate total: amount + ~0.21% commission (35 BPS) + ATA rent + Umbra gas
        const commission = Math.ceil(costBreakdown.baseRecipientAmount * UMBRA_FEE_PERCENT);
        const wrapAmount = costBreakdown.baseRecipientAmount + commission;
        const totalToEph = wrapAmount + WSOL_ATA_RENT + EPHEMERAL_GAS_BUFFER;

        // 1. User signs ONE tx: fund ephemeral
        setDepositProgress("Please sign the transaction in your wallet...");
        const fundingTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: senderPubkey,
            toPubkey: eph.keypair.publicKey,
            lamports: totalToEph,
          })
        );
        const txHash = await sendTransaction(fundingTx, connection);
        setDepositProgress("Waiting for confirmation...");
        const conf = await connection.confirmTransaction(txHash, "confirmed");
        if (conf.value.err) throw new Error(`Funding failed: ${JSON.stringify(conf.value.err)}`);
        setFundingTxHash(txHash);

        // 2. Wrap SOL → wSOL
        setDepositProgress("Wrapping SOL...");
        const wsolMint = new PublicKey(WSOL_MINT);
        const ephWsolAta = await getAssociatedTokenAddress(wsolMint, eph.keypair.publicKey);
        const wrapTx = new Transaction();
        wrapTx.add(createAssociatedTokenAccountInstruction(eph.keypair.publicKey, ephWsolAta, eph.keypair.publicKey, wsolMint));
        wrapTx.add(SystemProgram.transfer({ fromPubkey: eph.keypair.publicKey, toPubkey: ephWsolAta, lamports: wrapAmount }));
        wrapTx.add(createSyncNativeInstruction(ephWsolAta));
        await sendAndConfirmTransaction(connection, wrapTx, [eph.keypair], { commitment: "confirmed" });

        // 3. Register on Umbra (anonymous: true for MVK needed by UTXO ops)
        setDepositProgress("Loading ZK circuits...");
        const { getCdnZkAssetProvider } = await import("@umbra-privacy/web-zk-prover");
        const zkProvider = getCdnZkAssetProvider({ baseUrl: `${window.location.origin}/umbra-zk` });

        setDepositProgress("Registering on privacy pool...");
        const umbraClient = await createUmbraClientFromKeypair(eph.keypair);
        await ensureRegistered(umbraClient, { confidential: true, anonymous: true, zkAssetProvider: zkProvider });

        // 4. Create self-claimable UTXO from public wSOL balance
        setDepositProgress("Creating private UTXO (~30s, don't close this page)...");
        const { getPublicBalanceToSelfClaimableUtxoCreatorFunction } = await import("@umbra-privacy/sdk");
        const { getCreateSelfClaimableUtxoFromPublicBalanceProver } = await import("@umbra-privacy/web-zk-prover");
        const createProver = getCreateSelfClaimableUtxoFromPublicBalanceProver({ assetProvider: zkProvider });
        const createUtxo = getPublicBalanceToSelfClaimableUtxoCreatorFunction(
          { client: umbraClient },
          { zkProver: createProver }
        );
        await createUtxo({
          amount: BigInt(costBreakdown.baseRecipientAmount) as any,
          destinationAddress: eph.address as any,
          mint: WSOL_MINT as any,
        });

        // 5. Done! The UTXO is in the mixer. Claim URL has the eph seed.
        // When claiming, the claimer reconstructs the eph, claims the UTXO,
        // withdraws wSOL, unwraps to SOL, and sends to their wallet.
        setDepositProgress("Generating claim link...");
        const config = getUmbraConfig();
        const note: UmbraNote = {
          ephemeralSeed: eph.seed,
          amount: costBreakdown.baseRecipientAmount,
          network: config.network,
          token: selectedToken,
          tokenMint: TOKEN_MINTS[selectedToken].mint,
          createdAt: Date.now(),
          ephemeralAddress: eph.address,
          senderPrivacy: "private",
          status: "funded",
          fundsLocation: "pool",
          senderAddress: "",
          secret: eph.seed,
        };

        const url = createClaimUrl(note);
        setUmbraNote(note);
        setClaimUrl(url);

        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 3000);
        } catch { /* clipboard failed silently */ }

        const savedLink: SavedLink = {
          id: eph.seed.substring(0, 22),
          claimUrl: url,
          amount: costBreakdown.baseRecipientAmount,
          createdAt: Date.now(),
          status: "active",
          senderPrivacy: "private",
        };

        await saveLink(savedLink, solanaAddress);
        const updatedLinks = await loadLinks(solanaAddress);
        setSavedLinks(updatedLinks);

        setStep("complete");
      } else {
        // ── BASIC SEND: User → ephemeral (direct transfer, no Umbra) ──

        setDepositProgress("Generating ephemeral wallet...");
        const ephemeral = generateEphemeralKey();
        ephemeralAddress = ephemeral.address;
        ephemeralSecretBase58 = bs58.encode(ephemeral.keypair.secretKey);

        setDepositProgress("Preparing transaction...");
        const ephemeralPubkey = ephemeral.keypair.publicKey;
        const fundingTx = new Transaction();
        const isSOL = selectedToken === "SOL";

        if (isSOL) {
          fundingTx.add(
            SystemProgram.transfer({
              fromPubkey: senderPubkey,
              toPubkey: ephemeralPubkey,
              lamports: costBreakdown.senderPays,
            })
          );
        } else {
          // SPL Token: Send SOL for gas + tokens
          const tokenInfo = TOKEN_MINTS[selectedToken];
          const mintPubkey = new PublicKey(tokenInfo.mint);

          fundingTx.add(
            SystemProgram.transfer({
              fromPubkey: senderPubkey,
              toPubkey: ephemeralPubkey,
              lamports: costBreakdown.senderPaysGasLamports,
            })
          );

          const senderAta = await getAssociatedTokenAddress(mintPubkey, senderPubkey);
          const ephemeralAta = await getAssociatedTokenAddress(mintPubkey, ephemeralPubkey);
          fundingTx.add(
            createAssociatedTokenAccountInstruction(senderPubkey, ephemeralAta, ephemeralPubkey, mintPubkey)
          );
          fundingTx.add(
            createTransferInstruction(
              senderAta, ephemeralAta, senderPubkey,
              BigInt(costBreakdown.senderPays), [], TOKEN_PROGRAM_ID
            )
          );
        }

        setDepositProgress("Please sign the transaction in your wallet...");
        const txHash = await sendTransaction(fundingTx, connection);
        setDepositProgress("Waiting for transaction confirmation...");

        const confirmation = await connection.confirmTransaction(txHash, "confirmed");
        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        setFundingTxHash(txHash);

        setDepositProgress("Generating claim link...");
        const config = getUmbraConfig();
        const tokenMint = TOKEN_MINTS[selectedToken].mint;
        const note: UmbraNote = {
          ephemeralSeed: ephemeral.seed,
          amount: costBreakdown.baseRecipientAmount,
          network: config.network,
          token: selectedToken,
          tokenMint,
          createdAt: Date.now(),
          ephemeralAddress: ephemeral.address,
          senderPrivacy: "basic",
          status: "funded",
          fundsLocation: "ephemeral",
          senderAddress: "",
          secret: ephemeral.seed,
        };

        const url = createClaimUrl(note);
        setUmbraNote(note);
        setClaimUrl(url);

        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 3000);
        } catch { /* clipboard failed silently */ }

        const savedLink: SavedLink = {
          id: ephemeral.seed.substring(0, 22),
          claimUrl: url,
          amount: costBreakdown.baseRecipientAmount,
          createdAt: Date.now(),
          status: "active",
          senderPrivacy: "basic",
        };

        await saveLink(savedLink, solanaAddress);
        const updatedLinks = await loadLinks(solanaAddress);
        setSavedLinks(updatedLinks);

        setStep("complete");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deposit failed";
      const isUserRejection =
        /rejected|denied|cancelled|canceled/i.test(message) ||
        (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 4001);
      if (isUserRejection) {
        setError("Transaction cancelled");
      } else {
        console.error("[Create] Deposit error:", err);
        setError(message);
        if (ephemeralSecretBase58 && ephemeralAddress && solanaAddress) {
          const recovery: FailedDepositRecovery = {
            ephemeralSecretKeyBase58: ephemeralSecretBase58,
            ephemeralAddress,
            userWallet: solanaAddress,
          };
          setFailedDepositRecovery(recovery);
          saveRecovery(recovery);
        }
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
    setUmbraNote(null);
    setClaimUrl("");
    setFundingTxHash(null);
    setAmount("0.1");
    setDisplayAmount("0.1");
    setError(null);
    if (failedDepositRecovery) {
      clearRecovery(failedDepositRecovery.ephemeralAddress);
    }
    setFailedDepositRecovery(null);
    setReclaimSuccess(null);
  };

  const handleReclaim = async () => {
    if (!failedDepositRecovery) return;
    setIsReclaiming(true);
    setError(null);
    try {
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      const ephemeralKeypair = Keypair.fromSecretKey(bs58.decode(failedDepositRecovery.ephemeralSecretKeyBase58));
      const userPubkey = new PublicKey(failedDepositRecovery.userWallet);
      
      const tx = new Transaction();
      let hasAnythingToReclaim = false;
      const reclaimedItems: string[] = [];
      
      // Close wSOL ATA if it exists (unwraps back to SOL)
      try {
        const wsolMint = new PublicKey(WSOL_MINT);
        const wsolAta = await getAssociatedTokenAddress(wsolMint, ephemeralKeypair.publicKey);
        await getAccount(connection, wsolAta);
        // wSOL ATA exists — close it to unwrap SOL
        tx.add(createCloseAccountInstruction(wsolAta, ephemeralKeypair.publicKey, ephemeralKeypair.publicKey));
        hasAnythingToReclaim = true;
      } catch {
        // No wSOL ATA, skip
      }

      // Check and reclaim SPL tokens (USDC, USDT)
      for (const tokenSymbol of ["USDC", "USDT"] as SupportedToken[]) {
        const tokenInfo = TOKEN_MINTS[tokenSymbol];
        if (!tokenInfo.mint) continue;

        try {
          const mintPubkey = new PublicKey(tokenInfo.mint);
          const ephemeralAta = await getAssociatedTokenAddress(mintPubkey, ephemeralKeypair.publicKey);
          const account = await getAccount(connection, ephemeralAta);
          const tokenBalance = account.amount;

          if (tokenBalance > BigInt(0)) {
            const userAta = await getAssociatedTokenAddress(mintPubkey, userPubkey);
            try {
              await getAccount(connection, userAta);
            } catch {
              tx.add(
                createAssociatedTokenAccountInstruction(
                  ephemeralKeypair.publicKey, userAta, userPubkey, mintPubkey
                )
              );
            }

            tx.add(
              createTransferInstruction(
                ephemeralAta, userAta, ephemeralKeypair.publicKey,
                tokenBalance, [], TOKEN_PROGRAM_ID
              )
            );

            const displayAmt = Number(tokenBalance) / (10 ** tokenInfo.decimals);
            reclaimedItems.push(`${displayAmt.toFixed(2)} ${tokenSymbol}`);
            hasAnythingToReclaim = true;
          }
        } catch {
          // No token account or error, skip
        }
      }

      // Check and reclaim SOL — drain ephemeral to exactly 0
      // Count how many ATAs we're closing — each recovers ~0.00204 SOL rent
      const ataCloseCount = tx.instructions.filter(ix =>
        ix.programId.equals(TOKEN_PROGRAM_ID)
      ).length;
      const solBalance = await connection.getBalance(ephemeralKeypair.publicKey);
      // Total SOL available after ATA closes recover their rent
      const totalSolAfterCloses = solBalance + (ataCloseCount * 2039280);

      if (totalSolAfterCloses > 0) {
        // Add placeholder SOL transfer to calculate exact fee
        tx.add(
          SystemProgram.transfer({
            fromPubkey: ephemeralKeypair.publicKey,
            toPubkey: userPubkey,
            lamports: totalSolAfterCloses, // placeholder
          })
        );
        hasAnythingToReclaim = true;
      }

      if (!hasAnythingToReclaim) {
        setError("No funds left in ephemeral wallet to reclaim.");
        return;
      }

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = ephemeralKeypair.publicKey;

      // Get exact fee, rebuild with correct SOL drain amount
      const fee = Number((await connection.getFeeForMessage(tx.compileMessage()))?.value ?? 5000);
      const solToSend = Math.max(0, totalSolAfterCloses - fee);

      // Rebuild final tx: all instructions except the placeholder SOL transfer
      const finalTx = new Transaction();
      for (let i = 0; i < tx.instructions.length - 1; i++) {
        finalTx.add(tx.instructions[i]);
      }
      if (solToSend > 0) {
        finalTx.add(
          SystemProgram.transfer({
            fromPubkey: ephemeralKeypair.publicKey,
            toPubkey: userPubkey,
            lamports: solToSend,
          })
        );
        reclaimedItems.push(`${(solToSend / 1e9).toFixed(4)} SOL`);
      }

      finalTx.recentBlockhash = blockhash;
      finalTx.feePayer = ephemeralKeypair.publicKey;
      finalTx.sign(ephemeralKeypair);
      const sig = await connection.sendRawTransaction(finalTx.serialize(), { preflightCommitment: "confirmed" });
      await connection.confirmTransaction(sig, "confirmed");
      setError(null);
      clearRecovery(failedDepositRecovery.ephemeralAddress);
      setFailedDepositRecovery(null);
      setReclaimSuccess(`Reclaimed: ${reclaimedItems.join(", ")}`);
      setTimeout(() => setReclaimSuccess(null), 10000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reclaim failed");
    } finally {
      setIsReclaiming(false);
    }
  };

  // Recall unclaimed payment - let sender get funds back
  const handleRecall = async () => {
    const senderWallet = getSolanaAddress();
    if (!recallModalLink || !senderWallet) return;
    setIsRecalling(true);
    setRecallError(null);
    
    try {
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      
      // Parse the claim URL to get the ephemeral keypair
      const note = extractNoteFromUrl(recallModalLink.claimUrl);
      if (!note) {
        throw new Error("Invalid link format - could not parse note");
      }
      
      // Decode the composite secret to get the ephemeral keypair
      const compositeSecret = decodeCompositeSecret(note.secret);
      if (!compositeSecret) {
        throw new Error("Invalid link format - could not decode secret");
      }
      
      const ephemeralKeypair = compositeSecret.ephemeralKeypair;
      
      // Determine destination address
      let destinationPubkey: PublicKey;
      if (recallDestination === "custom") {
        if (!recallCustomAddress.trim()) {
          throw new Error("Please enter a destination wallet address");
        }
        try {
          destinationPubkey = new PublicKey(recallCustomAddress.trim());
        } catch {
          throw new Error("Invalid wallet address");
        }
      } else {
        // Send back to sender (connected wallet)
        destinationPubkey = new PublicKey(senderWallet);
      }
      
      const tx = new Transaction();
      let hasAnythingToRecall = false;
      const recalledItems: string[] = [];

      // Close wSOL ATA if it exists (unwraps back to SOL)
      try {
        const wsolMint = new PublicKey(WSOL_MINT);
        const wsolAta = await getAssociatedTokenAddress(wsolMint, ephemeralKeypair.publicKey);
        await getAccount(connection, wsolAta);
        tx.add(createCloseAccountInstruction(wsolAta, ephemeralKeypair.publicKey, ephemeralKeypair.publicKey));
        hasAnythingToRecall = true;
      } catch {
        // No wSOL ATA, skip
      }

      // Check and recall SPL tokens (USDC, USDT)
      for (const tokenSymbol of ["USDC", "USDT"] as SupportedToken[]) {
        const tokenInfo = TOKEN_MINTS[tokenSymbol];
        if (!tokenInfo.mint) continue;

        try {
          const mintPubkey = new PublicKey(tokenInfo.mint);
          const ephemeralAta = await getAssociatedTokenAddress(mintPubkey, ephemeralKeypair.publicKey);
          const account = await getAccount(connection, ephemeralAta);
          const tokenBalance = account.amount;

          if (tokenBalance > BigInt(0)) {
            const destAta = await getAssociatedTokenAddress(mintPubkey, destinationPubkey);
            try {
              await getAccount(connection, destAta);
            } catch {
              tx.add(
                createAssociatedTokenAccountInstruction(
                  ephemeralKeypair.publicKey, destAta, destinationPubkey, mintPubkey
                )
              );
            }

            tx.add(
              createTransferInstruction(
                ephemeralAta, destAta, ephemeralKeypair.publicKey,
                tokenBalance, [], TOKEN_PROGRAM_ID
              )
            );

            const displayAmt = Number(tokenBalance) / (10 ** tokenInfo.decimals);
            recalledItems.push(`${displayAmt.toFixed(2)} ${tokenSymbol}`);
            hasAnythingToRecall = true;
          }
        } catch {
          // No token account or error, skip
        }
      }

      // Check and recall SOL
      const solBalance = await connection.getBalance(ephemeralKeypair.publicKey);
      const feeReserve = 10000; // leave for tx fees
      const solToSend = Math.max(0, solBalance - feeReserve);
      
      if (solToSend > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: ephemeralKeypair.publicKey,
            toPubkey: destinationPubkey,
            lamports: solToSend,
          })
        );
        recalledItems.push(`${(solToSend / 1e9).toFixed(4)} SOL`);
        hasAnythingToRecall = true;
      }
      
      if (!hasAnythingToRecall) {
        throw new Error("No funds left in this payment link. It may have already been claimed.");
      }
      
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = ephemeralKeypair.publicKey;
      tx.sign(ephemeralKeypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
      await connection.confirmTransaction(sig, "confirmed");
      
      // Update the link status to recalled
      const updatedLink = { ...recallModalLink, status: "recalled" as const };
      await saveLink(updatedLink, senderWallet);
      const updatedLinks = await loadLinks(senderWallet);
      setSavedLinks(updatedLinks);
      
      setReclaimSuccess(`Recalled: ${recalledItems.join(", ")} to ${recallDestination === "custom" ? recallCustomAddress.slice(0, 8) + "..." : "your wallet"}`);
      setRecallModalLink(null);
      setRecallCustomAddress("");
      setRecallDestination("sender");
      setTimeout(() => setReclaimSuccess(null), 10000);
    } catch (e) {
      setRecallError(e instanceof Error ? e.message : "Recall failed");
    } finally {
      setIsRecalling(false);
    }
  };

  // Wallet adapter is always ready (no async init like Privy)

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
                <Image src="/bunnypriv.png" alt="Privacy" width={28} height={28} className="w-7 h-7 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-hop-700 dark:text-hop-300">Payment Link</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Send SOL or tokens via a secure link.
                    Recipient chooses their privacy level when claiming.
                  </p>
                </div>
              </div>
            </div>

            {connected ? (
              getSolanaAddress() ? (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-card border-2 border-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Connected Wallet (Solana)
                        </p>
                        <p className="font-mono text-sm font-medium">
                          {shortenAddress(getSolanaAddress()!, 6)}
                        </p>
                      </div>
                      {walletBalance !== null && (
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</p>
                          <p className="text-sm font-semibold font-mono">{lamportsToSol(walletBalance).toFixed(4)} SOL</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {walletBalance !== null && walletBalance < 10_000_000 && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700">
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                        Your wallet needs funds to create payment links. Send SOL to your address above.
                      </p>
                    </div>
                  )}
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
                  <Button onClick={disconnect} className="w-full" variant="outline">
                    Logout & Connect Solana Wallet
                  </Button>
                </div>
              )
            ) : (
              <Button onClick={() => openWalletModal(true)} className="w-full" size="lg">
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
                {/* Amount Input with Token Dropdown */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Amount</label>
                    {selectedToken === "SOL" && (
                      <div className="flex rounded-lg border-2 border-border overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            setCurrency("SOL");
                            setDisplayAmount(amount);
                          }}
                          className={`px-3 py-1 text-xs font-medium transition-colors ${currency === "SOL" ? "bg-hop-500 text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
                        >
                          SOL
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCurrency("USD");
                            if (solPrice) setDisplayAmount(((parseFloat(amount) || 0) * solPrice).toFixed(2));
                          }}
                          className={`px-3 py-1 text-xs font-medium transition-colors ${currency === "USD" ? "bg-hop-500 text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
                        >
                          USD
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={displayAmount}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" || /^\d*\.?\d*$/.test(v)) {
                          setDisplayAmount(v);
                          if (currency === "USD" && solPrice && solPrice > 0 && selectedToken === "SOL") {
                            const usd = parseFloat(v) || 0;
                            setAmount((usd / solPrice).toFixed(6));
                          } else {
                            setAmount(v || "0");
                          }
                        }
                      }}
                      onFocus={(e) => {
                        if (e.target.value === "0") {
                          setDisplayAmount("");
                        }
                      }}
                      onBlur={() => {
                        if (displayAmount === "" || displayAmount === ".") {
                          const defaultVal = selectedToken === "SOL" ? "0.1" : "1";
                          setDisplayAmount(defaultVal);
                          setAmount(defaultVal);
                        }
                      }}
                      placeholder={selectedToken === "SOL" ? "0.00" : "0"}
                      className="text-3xl h-16 text-left font-bold bg-card border-2 border-border focus:border-hop-500 pl-4 pr-28"
                    />
                    {/* Token Dropdown */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <button
                        type="button"
                        onClick={() => setShowTokenDropdown(!showTokenDropdown)}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-secondary transition-colors"
                      >
                        {selectedToken === "SOL" ? (
                          <Image src="/sol.svg" alt="SOL" width={20} height={20} style={{ width: 20, height: 20 }} />
                        ) : (
                          <Image
                            src={selectedToken === "USDC" ? "/usdc.svg" : "/usdt.svg"}
                            alt={selectedToken}
                            width={20}
                            height={20}
                            style={{ width: 20, height: 20 }}
                          />
                        )}
                        <span className="font-semibold text-muted-foreground">
                          {selectedToken === "SOL" && currency === "USD" ? "USD" : selectedToken}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showTokenDropdown ? "rotate-180" : ""}`} />
                      </button>
                      
                      {/* Dropdown Menu */}
                      {showTokenDropdown && (
                        <div className="absolute right-0 top-full mt-1 bg-card border-2 border-border rounded-xl shadow-lg z-50 min-w-[140px] overflow-hidden">
                          {(["SOL", "USDC", "USDT"] as SupportedToken[]).map((token) => (
                            <button
                              key={token}
                              type="button"
                              onClick={() => {
                                setSelectedToken(token);
                                setShowTokenDropdown(false);
                                if (token !== "SOL") setCurrency("SOL");
                                if (token === "SOL" && parseFloat(amount) >= 100) {
                                  setAmount("0.1");
                                  setDisplayAmount("0.1");
                                } else if (token !== "SOL" && parseFloat(amount) < 1) {
                                  setAmount("1");
                                  setDisplayAmount("1");
                                }
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-secondary transition-colors ${
                                selectedToken === token ? "bg-hop-500/10" : ""
                              }`}
                            >
                              {token === "SOL" ? (
                                <Image src="/sol.svg" alt="SOL" width={20} height={20} style={{ width: 20, height: 20 }} />
                              ) : (
                                <Image
                                  src={token === "USDC" ? "/usdc.svg" : "/usdt.svg"}
                                  alt={token}
                                  width={20}
                                  height={20}
                                  style={{ width: 20, height: 20 }}
                                />
                              )}
                              <span className={`font-medium ${selectedToken === token ? "text-hop-600 dark:text-hop-400" : ""}`}>
                                {token}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {currency === "USD" && solPrice && selectedToken === "SOL" && (
                    <p className="text-xs text-muted-foreground">
                      ≈ {(parseFloat(amount) || 0).toFixed(4)} SOL · 1 SOL = ${solPrice.toFixed(2)}
                    </p>
                  )}
                  {currency === "SOL" && solPrice && selectedToken === "SOL" && parseFloat(amount) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      ≈ ${((parseFloat(amount) || 0) * solPrice).toFixed(2)} USD
                    </p>
                  )}
                  {/* Quick amounts */}
                  <div className="flex gap-2">
                    {(selectedToken === "SOL" 
                      ? (currency === "USD" && solPrice ? ["10", "50", "100", "500"] : ["0.1", "0.5", "1", "5"])
                      : ["1", "5", "10", "50"]
                    ).map((val) => {
                      const isUsd = selectedToken === "SOL" && currency === "USD" && solPrice;
                      const actualAmount = isUsd ? (parseFloat(val) / solPrice!).toFixed(6) : val;
                      const isSelected = amount === actualAmount;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            setAmount(actualAmount);
                            setDisplayAmount(isUsd ? val : actualAmount);
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

                {/* Cost Breakdown - Shows when Options expanded */}
                {showAdvanced && costBreakdown && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-secondary border-2 border-border space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount</span>
                        <span>
                          {selectedToken === "SOL"
                            ? `${lamportsToSol(costBreakdown.baseRecipientAmount).toFixed(4)} SOL`
                            : `${(costBreakdown.baseRecipientAmount / 10 ** costBreakdown.decimals).toFixed(2)} ${selectedToken}`
                          }
                        </span>
                      </div>
                      {costBreakdown.commission > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Privacy fee (0.3%)</span>
                          <span className="text-honey-600 dark:text-honey-400">
                            {selectedToken === "SOL"
                              ? `+${lamportsToSol(costBreakdown.commission).toFixed(4)} SOL`
                              : `+${(costBreakdown.commission / 10 ** costBreakdown.decimals).toFixed(2)} ${selectedToken}`
                            }
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Gas</span>
                        <span className="text-muted-foreground">
                          {selectedToken === "SOL"
                            ? `+${lamportsToSol(costBreakdown.gasBuffer).toFixed(6)} SOL`
                            : `+${lamportsToSol(costBreakdown.senderPaysGasLamports).toFixed(3)} SOL`
                          }
                        </span>
                      </div>
                      <div className="border-t border-border pt-2 flex justify-between font-semibold">
                        <span>Total</span>
                        <span className="text-hop-600 dark:text-hop-400">
                          {selectedToken === "SOL"
                            ? `${lamportsToSol(costBreakdown.senderPays).toFixed(4)} SOL`
                            : `${(costBreakdown.senderPays / 10 ** costBreakdown.decimals).toFixed(2)} ${selectedToken} + ${lamportsToSol(costBreakdown.senderPaysGasLamports).toFixed(3)} SOL`
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Privacy & Summary */}
              <div className="space-y-4">
                {/* Sender Privacy Toggle */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-hop-600 dark:text-hop-400" />
                    <span className="text-sm font-medium text-hop-700 dark:text-hop-300">Send Mode</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(SENDER_PRIVACY) as Array<"basic" | "private">).map((mode) => {
                      const info = SENDER_PRIVACY[mode];
                      const isSelected = senderPrivacy === mode;
                      const isDisabled = false;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => !isDisabled && setSenderPrivacy(mode)}
                          disabled={isDisabled}
                          className={`p-3 rounded-xl border-2 transition-all text-left ${
                            isDisabled
                              ? "border-border bg-muted/50 opacity-50 cursor-not-allowed"
                              : isSelected
                                ? mode === "basic"
                                  ? "border-yellow-500 bg-yellow-500/10 ring-2 ring-yellow-500/30"
                                  : "border-hop-500 bg-hop-500/20 ring-2 ring-hop-500/50"
                                : "border-border hover:border-muted-foreground/50 bg-background"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            {mode === "basic" ? (
                              <Zap className={`w-4 h-4 ${isSelected ? "text-yellow-600" : "text-yellow-500"}`} />
                            ) : (
                              <Lock className={`w-4 h-4 ${isDisabled ? "text-muted-foreground" : isSelected ? "text-hop-600" : "text-hop-500"}`} />
                            )}
                            <span className={`text-sm font-semibold ${isDisabled ? "text-muted-foreground" : isSelected && (mode as string) === "private" ? "text-hop-700 dark:text-hop-300" : ""}`}>
                              {info.label}
                              {isDisabled && <span className="ml-1 text-[10px] font-normal">(Coming Soon)</span>}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-tight">{info.description}</p>
                          <p className="text-[10px] text-muted-foreground mt-1 font-medium">{isDisabled ? "Pending SDK update" : info.feeDescription}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Recipient chooses their own privacy level when claiming.
                  </p>
                </div>

                {/* Recipient gets - show max (quick claim amount). Claimer sees reduced amount when they choose quick vs private on claim page. */}
                {costBreakdown && (
                  <div className="p-3 rounded-xl bg-hop-100/50 dark:bg-hop-900/20 border-2 border-hop-300 dark:border-hop-700">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Recipient gets (max)</p>
                    <p className="text-lg font-bold text-hop-700 dark:text-hop-300">
                      {selectedToken === "SOL"
                        ? `${lamportsToSol(costBreakdown.recipientQuick).toFixed(4)} SOL`
                        : `${(costBreakdown.recipientQuick / 10 ** costBreakdown.decimals).toFixed(2)} ${selectedToken}`}
                    </p>
                    {selectedToken !== "SOL" && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">+ ~0.005 SOL gas</p>
                    )}
                  </div>
                )}

                {/* Create Button - under Recipient gets */}
                <Button
                  onClick={handleDeposit}
                  loading={isDepositing}
                  className="w-full h-12 font-semibold text-sm"
                  size="lg"
                  disabled={
                    !costBreakdown ||
                    costBreakdown.senderPays <= 0 ||
                    (walletBalance !== null && costBreakdown && walletBalance < costBreakdown.senderPays)
                  }
                >
                  <Image src="/bunnypriv.png" alt="" width={28} height={28} className="w-7 h-7 mr-2" />
                  {selectedToken === "SOL" ? (
                    <>Create · {lamportsToSol(costBreakdown?.senderPays || 0).toFixed(4)} SOL</>
                  ) : (
                    <>Create · {(costBreakdown ? (costBreakdown.senderPays / 10 ** costBreakdown.decimals).toFixed(2) : "0.00")} {selectedToken}</>
                  )}
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
            <div className="relative w-28 h-28 mx-auto">
              {/* Outer subtle ring */}
              <div className="absolute inset-0 rounded-full border-2 border-hop-500/20 animate-pulse" />
              {/* Inner glow */}
              <div className="absolute inset-2 rounded-full bg-hop-200/30 dark:bg-hop-500/10" />
              {/* Bunny animation - gentle hop */}
              <motion.div 
                className="absolute inset-0 flex items-center justify-center"
                animate={{ 
                  y: [0, -8, 0],
                  scale: [1, 1.05, 1],
                }}
                transition={{ 
                  duration: 0.8, 
                  repeat: Infinity, 
                  ease: "easeInOut" 
                }}
              >
                <Image
                  src="/bunnyspin.png"
                  alt="Processing"
                  width={72}
                  height={72}
                  className="object-contain"
                />
              </motion.div>
            </div>
            <h3 className="mt-6 text-lg font-semibold">Creating Payment Link</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {depositProgress || "Hopping through privacy..."}
            </p>
            
            <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-300 dark:border-amber-500/30">
              <div className="flex items-start gap-2 justify-center">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-200/80 font-medium">
                  Do not close this page while the transaction is processing.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === "complete" && umbraNote && (
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

            {/* Claim URL - Priority */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground font-medium">Claim Link</label>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-card border-2 border-hop-500">
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

            {/* Amount */}
            <div className="p-4 rounded-xl bg-hop-100 dark:bg-hop-500/10 border-2 border-hop-400 text-center">
              <p className="text-sm text-muted-foreground">Recipient Will Receive</p>
              <p className="text-2xl font-bold text-hop-700 dark:text-hop-400">
                {(() => {
                  const isSOL = !umbraNote.token || umbraNote.token === "SOL";
                  // For private sends, recipient gets UTXO + recovered ATA rent + leftover gas
                  const actualReceived = umbraNote.senderPrivacy === "private" && isSOL
                    ? estimatePrivateClaimReceives(umbraNote.amount)
                    : umbraNote.amount;
                  if (isSOL) {
                    return `~${lamportsToSol(actualReceived).toFixed(4)} SOL`;
                  } else {
                    const decimals = umbraNote.token === "USDC" || umbraNote.token === "USDT" ? 6 : 9;
                    return `~${(actualReceived / (10 ** decimals)).toFixed(2)} ${umbraNote.token}`;
                  }
                })()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {(() => {
                  const isSOL = !umbraNote.token || umbraNote.token === "SOL";
                  if (isSOL) {
                    const isPrivate = umbraNote.senderPrivacy === "private";
                    const label = isPrivate ? "UTXO" : "Claimable";
                    return `${label}: ${lamportsToSol(umbraNote.amount).toFixed(4)} SOL${isPrivate ? " (+ recovered rent + unused gas)" : ""}`;
                  } else {
                    const decimals = umbraNote.token === "USDC" || umbraNote.token === "USDT" ? 6 : 9;
                    return `Claimable: ${(umbraNote.amount / (10 ** decimals)).toFixed(2)} ${umbraNote.token}`;
                  }
                })()}
              </p>
            </div>

            {/* QR Code Toggle */}
            <div className="space-y-2">
              <button
                onClick={() => setShowQrCode(!showQrCode)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full p-3 rounded-xl bg-card border-2 border-border hover:border-hop-400"
              >
                <QrCode className="w-4 h-4" />
                <span>QR Code</span>
                <ArrowRight className={`w-4 h-4 ml-auto transition-transform ${showQrCode ? "rotate-90" : ""}`} />
              </button>
              
              {showQrCode && (
                <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-card border-2 border-border">
                  <div className="p-4 bg-white rounded-2xl border-2 border-border">
                    <QRCodeSVG
                      id="qr-code-svg"
                      value={claimUrl}
                      size={160}
                      level="H"
                      includeMargin={false}
                      imageSettings={{
                        src: "/hoppy-logo.png",
                        x: undefined,
                        y: undefined,
                        height: 44,
                        width: 44,
                        excavate: true,
                      }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const svg = document.getElementById("qr-code-svg");
                      if (svg) {
                        const svgData = new XMLSerializer().serializeToString(svg);
                        const canvas = document.createElement("canvas");
                        const ctx = canvas.getContext("2d");
                        const img = new window.Image();
                        img.onload = () => {
                          canvas.width = img.width;
                          canvas.height = img.height;
                          ctx?.drawImage(img, 0, 0);
                          const pngUrl = canvas.toDataURL("image/png");
                          const downloadLink = document.createElement("a");
                          downloadLink.href = pngUrl;
                          downloadLink.download = "hoppy-qr.png";
                          downloadLink.click();
                        };
                        img.src = "data:image/svg+xml;base64," + btoa(svgData);
                      }
                    }}
                    className="text-xs"
                  >
                    <Download className="w-3 h-3 mr-1" />
                    Download QR
                  </Button>
                </div>
              )}
            </div>

            {/* Transaction Hashes */}
            <div className="space-y-2">
              {fundingTxHash && (
                <div className="p-3 rounded-xl bg-card border-2 border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">TXN: Funding</span>
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://solscan.io/tx/${fundingTxHash}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === "devnet" ? "?cluster=devnet" : ""}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs font-mono text-hop-600 dark:text-hop-400 hover:text-hop-700 dark:hover:text-hop-300"
                      >
                        {shortenAddress(fundingTxHash, 6)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
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
        {connected && savedLinks.length > 0 && step !== "depositing" && (
          <div className="mt-6 pt-6 border-t-2 border-border">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const newShowHistory = !showHistory;
                  setShowHistory(newShowHistory);
                  // Auto-refresh when opening history
                  if (newShowHistory && !isRefreshingStatus) {
                    refreshAllLinkStatuses();
                  }
                }}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors flex-1"
              >
                <History className="w-4 h-4" />
                <span>Your Saved Links ({savedLinks.length})</span>
                <ArrowRight className={`w-4 h-4 ml-auto transition-transform ${showHistory ? "rotate-90" : ""}`} />
              </button>
              {showHistory && (
                <button
                  onClick={refreshAllLinkStatuses}
                  disabled={isRefreshingStatus}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Refresh link statuses"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshingStatus ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>
            
            {showHistory && (
              <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
                {/* Sort: unclaimed/active first, then dust, then claimed/recalled, then by date */}
                {[...savedLinks]
                  .sort((a, b) => {
                    // Priority: active > dust > claimed/recalled
                    const getPriority = (status: string) => {
                      if (status === "active" || status === "unknown") return 0;
                      if (status === "dust") return 1;
                      return 2; // claimed, recalled
                    };
                    const priorityDiff = getPriority(a.status) - getPriority(b.status);
                    if (priorityDiff !== 0) return priorityDiff;
                    // Then by date (newest first)
                    return b.createdAt - a.createdAt;
                  })
                  .map((link) => (
                  <div
                    key={link.id}
                    className={`p-3 rounded-xl bg-card border-2 ${
                      link.status === "claimed" || link.status === "recalled"
                        ? "border-gray-300 dark:border-gray-600 opacity-60" 
                        : link.status === "dust"
                        ? "border-orange-300 dark:border-orange-600 opacity-75"
                        : "border-hop-400"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">
                        {lamportsToSol(link.amount).toFixed(4)} SOL
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                        link.status === "active" 
                          ? "bg-hop-200 dark:bg-hop-500/20 text-hop-700 dark:text-hop-400"
                          : link.status === "claimed"
                          ? "bg-gray-200 dark:bg-gray-500/20 text-gray-600 dark:text-gray-400"
                          : link.status === "recalled"
                          ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                          : link.status === "dust"
                          ? "bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400"
                          : "bg-honey-100 dark:bg-yellow-500/20 text-honey-700 dark:text-yellow-400"
                      }`}>
                        {link.status === "claimed" && <Check className="w-3 h-3" />}
                        {link.status === "recalled" && <Undo2 className="w-3 h-3" />}
                        {link.status === "dust" && <AlertTriangle className="w-3 h-3" />}
                        {link.status === "claimed" ? "Claimed" 
                          : link.status === "recalled" ? "Recalled" 
                          : link.status === "dust" ? "Dust" 
                          : link.status === "active" ? "Unclaimed" 
                          : "Unknown"}
                      </span>
                    </div>
                    {/* Claim Link - Priority */}
                    <div className="flex items-center gap-2 mb-2">
                      <code className="flex-1 text-xs font-mono truncate text-foreground bg-muted/50 px-2 py-1 rounded">
                        {link.claimUrl}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(link.claimUrl)}
                        className="h-7 w-7 flex-shrink-0"
                        title="Copy link"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <a
                        href={link.claimUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground"
                        title="Open link"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {/* Recall button - only for unclaimed/active links */}
                      {(link.status === "active" || link.status === "unknown") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setRecallModalLink(link);
                            setRecallError(null);
                          }}
                          className="h-7 w-7 flex-shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300"
                          title="Recall payment"
                        >
                          <Undo2 className="h-3 w-3" />
                        </Button>
                      )}
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
                        className="h-7 w-7 flex-shrink-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{new Date(link.createdAt).toLocaleDateString()}</span>
                      <span className="text-hop-600 dark:text-hop-400">
                        {link.senderPrivacy === "private" ? "Private Send" : "Basic Send"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Recall Modal */}
      {recallModalLink && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border-2 border-border rounded-2xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Undo2 className="w-5 h-5 text-amber-500" />
                Recall Payment
              </h3>
              <button
                onClick={() => {
                  setRecallModalLink(null);
                  setRecallError(null);
                  setRecallCustomAddress("");
                  setRecallDestination("sender");
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  This will send funds back from this unclaimed payment link. The link will no longer be claimable.
                </p>
              </div>
            </div>

            <div className="mb-4">
              <p className="text-sm text-muted-foreground mb-1">Amount</p>
              <p className="font-semibold">{lamportsToSol(recallModalLink.amount).toFixed(4)} SOL</p>
            </div>

            <div className="mb-4">
              <p className="text-sm font-medium mb-2">Where should funds go?</p>
              
              <div className="space-y-2">
                <button
                  onClick={() => setRecallDestination("sender")}
                  className={`w-full p-3 rounded-xl border-2 text-left transition-all ${
                    recallDestination === "sender"
                      ? "border-hop-500 bg-hop-50 dark:bg-hop-900/30"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                >
                  <div className="font-medium text-sm">Your Connected Wallet</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {getSolanaAddress()?.slice(0, 8)}...{getSolanaAddress()?.slice(-8)}
                  </div>
                </button>

                <button
                  onClick={() => setRecallDestination("custom")}
                  className={`w-full p-3 rounded-xl border-2 text-left transition-all ${
                    recallDestination === "custom"
                      ? "border-hop-500 bg-hop-50 dark:bg-hop-900/30"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                >
                  <div className="font-medium text-sm">Different Wallet</div>
                  <div className="text-xs text-muted-foreground">
                    Send to another wallet address
                  </div>
                </button>
              </div>

              {recallDestination === "custom" && (
                <div className="mt-3">
                  <Input
                    type="text"
                    placeholder="Enter Solana wallet address"
                    value={recallCustomAddress}
                    onChange={(e) => setRecallCustomAddress(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use this if the sender wallet is not yours
                  </p>
                </div>
              )}
            </div>

            {recallError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
                {recallError}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setRecallModalLink(null);
                  setRecallError(null);
                  setRecallCustomAddress("");
                  setRecallDestination("sender");
                }}
                className="flex-1"
                disabled={isRecalling}
              >
                Cancel
              </Button>
              <Button
                onClick={handleRecall}
                disabled={isRecalling}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
              >
                {isRecalling ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                    Recalling...
                  </>
                ) : (
                  <>
                    <Undo2 className="w-4 h-4 mr-2" />
                    Recall Funds
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
