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
  estimatePrivateClaimReceives,
  getUmbraConfigForNetwork,
  type UmbraNote,
  type ClaimMode,
} from "@/lib/privacy";
import { formatSol, shortenAddress, lamportsToSol } from "@/lib/utils";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";

/**
 * Drain an ephemeral wallet to a recipient in a single tx: closes the wSOL ATA
 * (if present) and sends all native SOL plus recovered ATA rent. Doing close +
 * transfer atomically prevents a silent close failure from leaving the ATA's
 * 2,039,280 lamports stuck on the ephemeral.
 */
async function drainEphemeralToRecipient(
  connection: Connection,
  ephemeralKeypair: Keypair,
  recipientPubkey: PublicKey
): Promise<string | null> {
  const ephemeralPubkey = ephemeralKeypair.publicKey;
  const wsolAta = await getAssociatedTokenAddress(new PublicKey(WSOL_MINT), ephemeralPubkey);

  const drainTx = new Transaction();
  let ataLamports = 0;
  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (ataInfo) {
    ataLamports = ataInfo.lamports;
    drainTx.add(createCloseAccountInstruction(wsolAta, ephemeralPubkey, ephemeralPubkey));
  }

  const nativeBalance = await connection.getBalance(ephemeralPubkey);
  const totalAfterCloses = nativeBalance + ataLamports;
  if (totalAfterCloses <= 0) return null;

  drainTx.add(
    SystemProgram.transfer({
      fromPubkey: ephemeralPubkey,
      toPubkey: recipientPubkey,
      lamports: totalAfterCloses,
    })
  );
  const { blockhash } = await connection.getLatestBlockhash();
  drainTx.recentBlockhash = blockhash;
  drainTx.feePayer = ephemeralPubkey;

  const fee = Number((await connection.getFeeForMessage(drainTx.compileMessage()))?.value ?? 5000);
  const toSend = Math.max(0, totalAfterCloses - fee);
  if (toSend <= 0) return null;

  const finalTx = new Transaction();
  for (let i = 0; i < drainTx.instructions.length - 1; i++) {
    finalTx.add(drainTx.instructions[i]);
  }
  finalTx.add(
    SystemProgram.transfer({
      fromPubkey: ephemeralPubkey,
      toPubkey: recipientPubkey,
      lamports: toSend,
    })
  );
  finalTx.recentBlockhash = blockhash;
  finalTx.feePayer = ephemeralPubkey;
  finalTx.sign(ephemeralKeypair);
  const sig = await connection.sendRawTransaction(finalTx.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

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

  // For private sends the claimer also receives the recovered ATA rent and any
  // unused gas buffer the ephemeral didn't burn during deposit/registration.
  const receiveBreakdown = useMemo(() => {
    if (!state.note) return null;
    const isSOL = !state.note.token || state.note.token === "SOL";
    const recipientReceives = state.note.senderPrivacy === "private" && isSOL
      ? estimatePrivateClaimReceives(state.note.amount)
      : state.note.amount;
    return {
      recipientReceives,
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

      // Pick RPC based on the NOTE's network, not the deploy env. Allows a
      // mainnet deploy to claim devnet links (e.g. payroll testing).
      const noteConfig = getUmbraConfigForNetwork(state.note.network);
      const rpcUrl = noteConfig.rpcUrl;
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

        // IMPORTANT: build the client using the note's network, not the
        // deploy's NEXT_PUBLIC_SOLANA_NETWORK env. A devnet payroll link
        // claimed on a mainnet-deployed site must still hit the devnet
        // indexer / RPC / relayer.
        const config = getUmbraConfigForNetwork(state.note.network);
        console.log("[Claim] Using network from note:", state.note.network, "indexer:", config.indexerUrl);

        // Reconstruct Umbra client from ephemeral, overriding env config
        const umbraClient = await createUmbraClientFromKeypair(ephemeralKeypair, config);

        setClaimProgress("Scanning the privacy pool…");
        const {
          getSelfClaimableUtxoToPublicBalanceClaimerFunction,
          getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
          getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
          getEncryptedBalanceQuerierFunction,
          getClaimableUtxoScannerFunction,
          getUmbraRelayer,
        } = await import("@umbra-privacy/sdk");
        const relayer = getUmbraRelayer({
          apiEndpoint: config.relayerUrl,
        } as any);
        // v4: client exposes fetchBatchMerkleProof directly
        const fetchBatchMerkleProof = (umbraClient as any).fetchBatchMerkleProof;

        const scanUtxos = getClaimableUtxoScannerFunction({ client: umbraClient });

        // Sanity check: verify the URL's encoded ephemeral address matches
        // the keypair we just derived from the seed. If these disagree we
        // have an encoding bug — log loudly so it doesn't masquerade as a
        // missing UTXO.
        const derivedPubkey = ephemeralPubkey.toBase58();
        const urlEphemeralAddress = state.note.ephemeralAddress;
        if (urlEphemeralAddress && urlEphemeralAddress !== derivedPubkey) {
          console.error(
            "[Claim] ⚠ URL ephemeral address mismatch — encoding bug?",
            { urlSays: urlEphemeralAddress, derivedFromSeed: derivedPubkey },
          );
        } else {
          console.log("[Claim] Stealth keypair OK", { stealth: derivedPubkey });
        }

        // v4 scanner buckets:
        //   - publicSelfBurnable / selfBurnable → regular /create private send
        //     (the same key created and claims the UTXO, "ephemeral unlocker")
        //   - received / publicReceived → payroll issue-link UTXO created by
        //     the escrow but encrypted to this stealth's commitment
        //     ("receiver unlocker")
        // The two unlocker types use *different* claim primitives, so we
        // route based on which bucket actually has UTXOs.
        type ScanBuckets = {
          received: any[];
          publicReceived: any[];
          selfBurnable: any[];
          publicSelfBurnable: any[];
        };
        async function scanOnce(): Promise<{ buckets: ScanBuckets; raw: any }> {
          const fetchResult: any = await scanUtxos(
            BigInt(0) as any,
            BigInt(0) as any,
            BigInt(10000) as any,
          );
          return {
            buckets: {
              received: fetchResult.received ?? [],
              publicReceived: fetchResult.publicReceived ?? [],
              selfBurnable: fetchResult.selfBurnable ?? [],
              publicSelfBurnable: fetchResult.publicSelfBurnable ?? [],
            },
            raw: fetchResult,
          };
        }

        function totalClaimable(b: ScanBuckets): number {
          return (
            b.received.length +
            b.publicReceived.length +
            b.selfBurnable.length +
            b.publicSelfBurnable.length
          );
        }

        // Multi-shot scan with backoff. Indexer lag on devnet can be 5-30s
        // even after the on-chain tx is confirmed, so a single quick scan
        // is too eager. Retry up to 5 times across ~30s before giving up.
        const scanAttempts: Array<{
          ms: number;
          received: number;
          publicReceived: number;
          selfBurnable: number;
          publicSelfBurnable: number;
          combined: number;
        }> = [];
        let scan = await scanOnce();
        scanAttempts.push({
          ms: 0,
          received: scan.buckets.received.length,
          publicReceived: scan.buckets.publicReceived.length,
          selfBurnable: scan.buckets.selfBurnable.length,
          publicSelfBurnable: scan.buckets.publicSelfBurnable.length,
          combined: totalClaimable(scan.buckets),
        });
        const RETRY_DELAYS_MS = [3000, 5000, 8000, 12000];
        for (const delay of RETRY_DELAYS_MS) {
          if (totalClaimable(scan.buckets) > 0) break;
          console.log(
            `[Claim] Empty scan — retrying in ${Math.round(delay / 1000)}s (attempt ${scanAttempts.length + 1})...`,
          );
          await new Promise((r) => setTimeout(r, delay));
          scan = await scanOnce();
          scanAttempts.push({
            ms: delay,
            received: scan.buckets.received.length,
            publicReceived: scan.buckets.publicReceived.length,
            selfBurnable: scan.buckets.selfBurnable.length,
            publicSelfBurnable: scan.buckets.publicSelfBurnable.length,
            combined: totalClaimable(scan.buckets),
          });
        }
        const { buckets, raw: fetchResult } = scan;
        console.log("[Claim] Scan attempts:", {
          stealthAddress: derivedPubkey,
          attemptCount: scanAttempts.length,
          attempts: scanAttempts,
          finalCombinedClaimable: totalClaimable(buckets),
          fullFinalResult: fetchResult,
        });

        if (totalClaimable(buckets) === 0) {
          // All scans came back empty after ~28s of retries. That's almost
          // certainly a structurally broken link (UTXO not on-chain or
          // mis-encrypted). Genuine indexer lag rarely exceeds 10s.
          const stealthShort = `${derivedPubkey.slice(0, 6)}…${derivedPubkey.slice(-4)}`;
          throw new Error(
            `Couldn't find claimable funds for ${stealthShort} after ${scanAttempts.length} scan attempts over ${
              scanAttempts.reduce((s, a) => s + a.ms, 0) / 1000
            }s. The link may be invalid — please ask whoever sent it to re-issue.`,
          );
        }

        const receiverUtxos = [...buckets.received, ...buckets.publicReceived];
        const selfUtxos = [...buckets.publicSelfBurnable, ...buckets.selfBurnable];

        if (receiverUtxos.length > 0) {
          // ── Payroll-style: receiver-claimable UTXO from escrow ──
          // Claim into the stealth's encrypted balance, then withdraw to
          // its public wSOL ATA, then drain the ATA + native SOL to the
          // recipient. The unwrap is implicit in the drain (closeAccount).
          setClaimProgress("Claiming receiver UTXO (~30s)…");
          const { getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver } =
            await import("@umbra-privacy/web-zk-prover");
          const receiverClaimProver =
            getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver({
              assetProvider: zkProvider,
            });
          const claimReceiverFn =
            getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
              { client: umbraClient },
              {
                zkProver: receiverClaimProver,
                relayer,
                fetchBatchMerkleProof,
              } as any,
            );

          const requestedAmount = receiverUtxos.reduce<bigint>(
            (sum, u) => sum + BigInt((u as { amount: bigint | number }).amount),
            BigInt(0),
          );
          console.log("[Claim] Receiver-claim starting", {
            utxoCount: receiverUtxos.length,
            requestedAmount: requestedAmount.toString(),
          });
          const claimResult = (await claimReceiverFn(receiverUtxos)) as any;
          // Surface batch-level relayer status. If any batch isn't
          // "completed" the encrypted balance won't be credited and the
          // subsequent withdraw will silently no-op, leaving the user
          // with only the gas leftover in the drain.
          const batchSummary: Array<Record<string, unknown>> = [];
          try {
            const batches: Map<unknown, any> | any =
              claimResult?.batches ?? new Map();
            const iter =
              typeof batches?.entries === "function"
                ? batches.entries()
                : Object.entries(batches);
            for (const [k, v] of iter) {
              batchSummary.push({
                batch: String(k),
                status: v?.status,
                txSignature: v?.txSignature,
                callbackSignature: v?.callbackSignature,
                failureReason: v?.failureReason ?? null,
              });
            }
          } catch (err) {
            console.warn("[Claim] could not summarize claim batches", err);
          }
          console.log("[Claim] Receiver-claim done", { batches: batchSummary });
          const anyBatchFailed = batchSummary.some(
            (b) =>
              b.status &&
              !["completed", "Completed", "COMPLETED"].includes(String(b.status)),
          );
          if (anyBatchFailed) {
            console.error(
              "[Claim] Receiver-claim batch did not reach 'completed'",
              batchSummary,
            );
          }

          // Query the *actual* credited encrypted balance instead of using
          // the requested amount: the relayer + protocol fees get deducted,
          // so the encrypted balance is always smaller than the UTXO sum.
          // Asking the withdraw for more than what's there silently no-ops
          // and leaves the wSOL stuck in the encrypted balance forever —
          // which is exactly the symptom we saw (drain only returned the
          // unused gas). Poll for up to ~25s in case the relayer's
          // callback finishes after the claim function returns.
          const queryBalance = getEncryptedBalanceQuerierFunction({
            client: umbraClient,
          });
          let creditedAmount = BigInt(0);
          const balancePollStart = Date.now();
          const BALANCE_POLL_DELAYS_MS = [0, 2000, 3000, 5000, 7000, 10000];
          for (const delay of BALANCE_POLL_DELAYS_MS) {
            if (delay > 0) await new Promise((r) => setTimeout(r, delay));
            try {
              const balances = (await queryBalance([
                WSOL_MINT as never,
              ])) as Map<string, { state: string; balance?: bigint }>;
              const wsolEntry = balances.get(WSOL_MINT) ??
                (balances as any).get?.(WSOL_MINT as never);
              const balValue =
                wsolEntry?.state === "shared" && wsolEntry?.balance != null
                  ? BigInt(wsolEntry.balance)
                  : BigInt(0);
              console.log("[Claim] Encrypted balance poll", {
                pollDelayMs: delay,
                cumulativeMs: Date.now() - balancePollStart,
                state: wsolEntry?.state,
                balance: balValue.toString(),
              });
              if (balValue > creditedAmount) creditedAmount = balValue;
              if (creditedAmount > BigInt(0)) break;
            } catch (err) {
              console.warn("[Claim] balance poll error", { delay, err });
            }
          }

          if (creditedAmount === BigInt(0)) {
            // Encrypted balance never got credited — the relayer didn't
            // complete the claim, or its callback hasn't landed yet. Fail
            // loudly instead of letting the drain silently return only
            // the gas budget (the bug we just fixed).
            throw new Error(
              `Receiver claim didn't credit any wSOL to the stealth's encrypted balance after ~${Math.round(
                (Date.now() - balancePollStart) / 1000,
              )}s. Try again in 30s; if it persists, the link is structurally broken.`,
            );
          }

          setClaimProgress("Withdrawing to public balance (~30s)…");
          const withdraw =
            getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({
              client: umbraClient,
            });
          console.log("[Claim] Withdraw starting", {
            destinationStealth: ephemeralPubkey.toBase58(),
            withdrawAmount: creditedAmount.toString(),
            requestedAmount: requestedAmount.toString(),
          });
          const withdrawResult = (await withdraw(
            ephemeralPubkey.toBase58() as never,
            WSOL_MINT as never,
            creditedAmount as never,
          )) as any;
          console.log("[Claim] Withdraw done", {
            queueSignature: withdrawResult?.queueSignature,
            callbackStatus: withdrawResult?.callbackStatus,
            callbackSignature: withdrawResult?.callbackSignature,
            callbackElapsedMs: withdrawResult?.callbackElapsedMs,
          });
          if (
            withdrawResult?.callbackStatus &&
            withdrawResult.callbackStatus !== "finalized"
          ) {
            console.error("[Claim] Withdraw callback not finalized", {
              callbackStatus: withdrawResult.callbackStatus,
            });
          }
        } else {
          // ── Regular create flow: self-claimable UTXO ──
          // Same key created and now claims, so we can claim straight to
          // public balance in one ZK proof.
          setClaimProgress("Claiming from privacy pool…");
          const { getClaimSelfClaimableUtxoIntoPublicBalanceProver } =
            await import("@umbra-privacy/web-zk-prover");
          const claimProver = getClaimSelfClaimableUtxoIntoPublicBalanceProver({
            assetProvider: zkProvider,
          });
          const claimFn = getSelfClaimableUtxoToPublicBalanceClaimerFunction(
            { client: umbraClient },
            { zkProver: claimProver, relayer, fetchBatchMerkleProof } as any,
          );
          await claimFn(selfUtxos);
        }

        // Bundle wSOL ATA close + SOL transfer into a single tx so the ATA's
        // ~0.00204 SOL rent gets recovered into the drain. A separate close
        // tx that silently catches errors leaves rent stuck on the ephemeral.
        setClaimProgress("Sending to your wallet…");
        transferSig = await drainEphemeralToRecipient(
          connection,
          ephemeralKeypair,
          recipientPubkey
        );
      } else if (isSOL) {
        // ── Basic send: funds are native SOL on the ephemeral ──
        // Bundle wSOL ATA close (if a prior wrap left one) + SOL transfer in
        // one tx so the ATA's rent flows into the drain.
        setClaimProgress("Sending to your wallet...");
        transferSig = await drainEphemeralToRecipient(
          connection,
          ephemeralKeypair,
          recipientPubkey
        );
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
      console.error("[Claim] Failed:", error);

      // Only mark "already claimed" for actual already-claimed signals,
      // not for transient indexer/UTXO scan failures
      const isReallyAlreadyClaimed =
        errorMessage.includes("already been claimed") ||
        errorMessage.includes("insufficient funds") ||
        errorMessage.includes("nullifier");

      if (isReallyAlreadyClaimed) {
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
              <h3 className="mt-6 text-lg ">Reading Payment Link...</h3>
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

              <h3 className="text-xl  text-center mb-1">
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
                          <span className={`text-sm  ${isSelected && mode === "private" ? "text-hop-700 dark:text-hop-300" : ""}`}>
                            {info.name}
                          </span>
                        </div>
                        <p className={`text-lg  ${isSelected && mode === "private" ? "text-hop-700 dark:text-hop-300" : ""}`}>
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
              
              <h3 className="mt-6 text-2xl ">Claim Complete!</h3>
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
                    <span className="">
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
