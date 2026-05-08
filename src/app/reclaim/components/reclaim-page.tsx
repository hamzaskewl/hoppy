"use client";

import { useState } from "react";
import { NavHeader } from "@/components/nav-header";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export function ReclaimPage() {
  const [privateKey, setPrivateKey] = useState("");
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [signatures, setSignatures] = useState<string[]>([]);
  const [info, setInfo] = useState<{
    address: string;
    ata: string | null;
    ataLamports: number;
    solBalance: number;
    totalReclaimable: number;
  } | null>(null);

  async function handleCheck() {
    setStatus("loading");
    setMessage("Checking wallet...");
    setSignatures([]);
    setInfo(null);

    try {
      const secretKey = bs58.decode(privateKey.trim());
      const keypair = Keypair.fromSecretKey(secretKey);
      const owner = keypair.publicKey;
      const ata = await getAssociatedTokenAddress(WSOL_MINT, owner);

      const connection = new Connection(RPC_URL, "confirmed");
      const [accountInfo, solBalance] = await Promise.all([
        connection.getAccountInfo(ata),
        connection.getBalance(owner),
      ]);

      const ataLamports = accountInfo ? accountInfo.lamports : 0;
      const totalReclaimable = solBalance + ataLamports;

      if (totalReclaimable === 0) {
        setStatus("idle");
        setMessage("This wallet is empty. Nothing to reclaim.");
        return;
      }

      setInfo({
        address: owner.toBase58(),
        ata: accountInfo ? ata.toBase58() : null,
        ataLamports,
        solBalance,
        totalReclaimable,
      });
      setStatus("idle");

      const parts = [];
      if (ataLamports > 0)
        parts.push(`wSOL ATA: ${(ataLamports / 1e9).toFixed(6)} SOL`);
      if (solBalance > 0)
        parts.push(`SOL balance: ${(solBalance / 1e9).toFixed(6)} SOL`);
      setMessage(
        `Found ${parts.join(" + ")}. Total: ${(totalReclaimable / 1e9).toFixed(6)} SOL. Enter destination and click "Reclaim".`
      );
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Invalid private key");
    }
  }

  async function handleReclaim() {
    if (!info) return;

    let dest: PublicKey;
    try {
      dest = new PublicKey(destination.trim());
    } catch {
      setStatus("error");
      setMessage("Invalid destination address.");
      return;
    }

    setStatus("loading");
    setMessage("Reclaiming all funds...");

    try {
      const secretKey = bs58.decode(privateKey.trim());
      const keypair = Keypair.fromSecretKey(secretKey);
      const owner = keypair.publicKey;
      const connection = new Connection(RPC_URL, "confirmed");
      const sigs: string[] = [];

      // Step 1: Close wSOL ATA if it exists (sends lamports back to owner)
      if (info.ata) {
        const ata = new PublicKey(info.ata);
        const closeTx = new Transaction().add(
          createCloseAccountInstruction(
            ata,
            owner, // lamports go back to owner first
            owner,
            [],
            TOKEN_PROGRAM_ID
          )
        );
        closeTx.feePayer = owner;
        closeTx.recentBlockhash = (
          await connection.getLatestBlockhash("confirmed")
        ).blockhash;
        closeTx.sign(keypair);
        const sig = await connection.sendRawTransaction(closeTx.serialize(), {
          skipPreflight: false,
        });
        await connection.confirmTransaction(sig, "confirmed");
        sigs.push(sig);
      }

      // Step 2: Drain ALL remaining SOL to destination using exact fee calculation
      const currentBalance = await connection.getBalance(owner);
      if (currentBalance > 0) {
        // Build a dummy transfer to calculate exact fee
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const dummyTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: owner,
            toPubkey: dest,
            lamports: 1, // placeholder
          })
        );
        dummyTx.feePayer = owner;
        dummyTx.recentBlockhash = blockhash;
        dummyTx.sign(keypair);

        const exactFee = await connection.getFeeForMessage(
          dummyTx.compileMessage(),
          "confirmed"
        );
        const fee = exactFee.value ?? 5000;
        const drainAmount = currentBalance - fee;

        if (drainAmount > 0) {
          const drainTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: owner,
              toPubkey: dest,
              lamports: drainAmount,
            })
          );
          drainTx.feePayer = owner;
          drainTx.recentBlockhash = blockhash;
          drainTx.sign(keypair);
          const sig = await connection.sendRawTransaction(
            drainTx.serialize(),
            { skipPreflight: false }
          );
          await connection.confirmTransaction(sig, "confirmed");
          sigs.push(sig);
        }
      }

      setSignatures(sigs);
      setStatus("success");
      const totalDrained = info.totalReclaimable;
      setMessage(
        `Reclaimed ~${(totalDrained / 1e9).toFixed(6)} SOL to ${dest.toBase58().slice(0, 8)}...`
      );
      setInfo(null);
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Reclaim failed");
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <NavHeader />
      <div className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-lg space-y-6">
          <div>
            <h1 className="text-2xl ">Reclaim SOL</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Paste an ephemeral wallet&apos;s private key to close its wSOL
              account and drain all remaining SOL to your wallet. Your key never
              leaves the browser.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">
                Ephemeral Private Key (base58)
              </label>
              <input
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Paste base58 private key..."
                className="w-full mt-1 px-4 py-3 rounded-xl border border-border bg-card text-sm font-mono focus:outline-none focus:ring-2 focus:ring-hop-500"
              />
            </div>

            <div>
              <label className="text-sm font-medium">
                Destination Wallet Address
              </label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Your wallet address (where SOL goes)..."
                className="w-full mt-1 px-4 py-3 rounded-xl border border-border bg-card text-sm font-mono focus:outline-none focus:ring-2 focus:ring-hop-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCheck}
                disabled={!privateKey.trim() || status === "loading"}
                className="flex-1 px-4 py-3 rounded-xl bg-card border-2 border-border text-sm  hover:border-hop-500 transition-colors disabled:opacity-50"
              >
                {status === "loading" && !info ? "Checking..." : "Check"}
              </button>
              <button
                onClick={handleReclaim}
                disabled={
                  !info || !destination.trim() || status === "loading"
                }
                className="flex-1 px-4 py-3 rounded-xl bg-hop-500 text-white text-sm  hover:bg-hop-600 transition-colors disabled:opacity-50"
              >
                {status === "loading" && info ? "Reclaiming..." : "Reclaim"}
              </button>
            </div>
          </div>

          {message && (
            <div
              className={`p-4 rounded-xl border text-sm ${
                status === "error"
                  ? "border-red-500/50 bg-red-500/10 text-red-400"
                  : status === "success"
                    ? "border-green-500/50 bg-green-500/10 text-green-400"
                    : "border-border bg-card text-muted-foreground"
              }`}
            >
              {message}
            </div>
          )}

          {info && (
            <div className="p-4 rounded-xl border border-border bg-card space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Wallet:</span>{" "}
                <span className="font-mono">
                  {info.address.slice(0, 12)}...
                </span>
              </div>
              {info.ata && (
                <div>
                  <span className="text-muted-foreground">wSOL ATA:</span>{" "}
                  <span className="font-mono">
                    {info.ata.slice(0, 12)}...
                  </span>
                  <span className="text-muted-foreground ml-2">
                    ({(info.ataLamports / 1e9).toFixed(6)} SOL)
                  </span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">SOL Balance:</span>{" "}
                <span className="font-mono">
                  {(info.solBalance / 1e9).toFixed(6)} SOL
                </span>
              </div>
              <div className="pt-1 border-t border-border">
                <span className="text-muted-foreground">Total:</span>{" "}
                <span className="">
                  {(info.totalReclaimable / 1e9).toFixed(6)} SOL
                </span>
              </div>
            </div>
          )}

          {signatures.length > 0 && (
            <div className="p-4 rounded-xl border border-green-500/50 bg-green-500/10 text-sm space-y-1">
              {signatures.map((sig, i) => (
                <div key={sig}>
                  <span className="text-muted-foreground">
                    Tx {i + 1}:
                  </span>{" "}
                  <a
                    href={`https://solscan.io/tx/${sig}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hop-500 hover:underline font-mono break-all"
                  >
                    {sig.slice(0, 24)}...
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
