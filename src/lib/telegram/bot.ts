import { Bot, Context, InlineKeyboard } from "grammy";
import { parseIntent } from "./intents";
import { sanitizeInput, checkLLMRateLimit } from "./sanitize";
import {
  generateWallet,
  encryptSecretKey,
  decryptSecretKey,
  keypairFromBase58,
  getBalance,
  lamportsToSol,
  solToLamports,
} from "./wallet";
import {
  getWallet,
  getWalletByUsername,
  getWalletsByUser,
  getWalletCount,
  createNewWallet,
  setActiveWallet,
  updateWalletUsername,
  savePayment,
  getPaymentById,
  getPaymentsByUser,
  getPendingPaymentsForUser,
  updatePaymentStatus,
} from "./db";
import {
  startMessage,
  startNewUserMessage,
  balanceMessage,
  exportMessage,
  helpMessage,
  sendConfirmMessage,
  sendSuccessMessage,
  sendFlowRecipientMessage,
  sendFlowAmountMessage,
  sendFlowConfirmMessage,
  settingsMessage,
  claimSuccessMessage,
  historyMessage,
  errorMessage,
  errorMessageHtml,
  escapeMarkdown,
  receivedPaymentMessage,
  receivedPaymentDeliveredMessage,
  transferAddressMessage,
  transferAmountMessage,
  transferConfirmMessage,
  transferSuccessMessage,
  recoverySuccessMessage,
  recoveryFailedMessage,
  switchWalletMessage,
} from "./messages";
import {
  mainMenuKeyboard,
  confirmSendKeyboard,
  confirmTransferKeyboard,
  settingsKeyboard,
  backToHomeKeyboard,
  cancelKeyboard,
  transferCancelKeyboard,
  receivedPaymentKeyboard,
  historyWithRecallKeyboard,
  walletListKeyboard,
  sendPrivacyKeyboard,
  CB,
  RCV_QUICK_PREFIX,
  RCV_PRIV_PREFIX,
  RCV_LINK_PREFIX,
  WALLET_SWITCH_PREFIX,
} from "./keyboards";
import {
  getSendFlow,
  setSendFlow,
  clearSendFlow,
  getTransferFlow,
  setTransferFlow,
  clearTransferFlow,
  getPendingConfirmation,
  setPendingConfirmation,
  clearPendingConfirmation,
} from "./state";
import {
  Connection,
  Keypair,
  Transaction,
  SystemProgram,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  generateEphemeralKey,
  createClaimUrl,
  extractNoteFromUrl,
  decodeCompositeSecret,
  createUmbraClientFromKeypair,
  ensureRegistered,
  getRelayer,
  getUmbraConfig,
  calculateSenderCost,
  WSOL_MINT,
  UMBRA_FEE_PERCENT,
  EPHEMERAL_GAS_BUFFER,
  type UmbraNote,
  type SenderPrivacy,
} from "@/lib/privacy";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
} from "@solana/spl-token";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "http://localhost:3000");

console.log("[TG Bot] APP_URL resolved to:", APP_URL);

/**
 * Drain an ephemeral wallet to a recipient in a single tx: closes the wSOL ATA
 * (if present) and sends all native SOL plus recovered ATA rent. Doing close +
 * transfer atomically prevents a silent close failure from leaving the ATA's
 * 2,039,280 lamports stuck on the ephemeral.
 */
async function drainEphemeralToRecipient(
  connection: Connection,
  ephemeralKeypair: Keypair,
  recipientAddress: string
): Promise<{ signature: string | null; amountSent: number }> {
  const ephemeralPubkey = ephemeralKeypair.publicKey;
  const recipientPubkey = new PublicKey(recipientAddress);
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
  if (totalAfterCloses <= 0) return { signature: null, amountSent: 0 };

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
  if (toSend <= 0) return { signature: null, amountSent: 0 };

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
  const signature = await sendAndConfirmTransaction(connection, finalTx, [ephemeralKeypair], {
    commitment: "confirmed",
  });
  return { signature, amountSent: toSend };
}

// Fee constants — Umbra v2 model: 35 BPS (~0.21%) commission + gas buffer for registration/proofs
const MIN_SEND = 0.005;  // 0.005 SOL minimum

/** Compute receive estimates for a given send amount */
function getReceiveEstimates(amountSol: number, privacy: SenderPrivacy = "basic") {
  const amountLamports = solToLamports(amountSol);
  const cost = calculateSenderCost(amountLamports, privacy);
  // Quick claim: recipient gets ~full amount (tiny tx fee)
  const quickNet = Math.max(0, amountLamports - 5000);
  // Private claim: recipient pays ~0.21% mixer commission (35 BPS) + gas reserve
  const privateClaimAmount = Math.floor(amountLamports / (1 + UMBRA_FEE_PERCENT));
  return {
    quickEstimate: lamportsToSol(quickNet),
    privateEstimate: lamportsToSol(privateClaimAmount),
    fundedLamports: cost.senderPays,
    totalDebit: lamportsToSol(cost.senderPays),
  };
}

/** Returns an error string if amount is below the minimum, or null if OK */
function getMinAmountError(amount: number, privacy: SenderPrivacy = "basic"): string | null {
  if (amount < MIN_SEND) {
    const feeInfo = privacy === "basic"
      ? `~0.000005 SOL (tx fee only)`
      : `~0.3% commission + ~0.02 SOL gas`;
    return (
      `Amount too low.\n\n` +
      `Minimum send: <b>${MIN_SEND} SOL</b>\n\n` +
      `<b>Fee:</b> ${feeInfo}`
    );
  }
  return null;
}

function createBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return new Bot(token);
}

let botInstance: Bot | null = null;

export function getBot(): Bot {
  if (!botInstance) {
    botInstance = createBot();
    botInstance.catch((err) => {
      console.error("[TG Bot] Unhandled error in handler:", err);
    });
    registerHandlers(botInstance);
    setupCommands(botInstance).catch((err) =>
      console.error("[TG Bot] Failed to set commands:", err)
    );
  }
  return botInstance;
}

async function setupCommands(bot: Bot) {
  await bot.api.setMyCommands([
    { command: "start", description: "Open wallet & main menu" },
    { command: "send", description: "Send SOL privately to @user" },
    { command: "transfer", description: "Transfer SOL to any address" },
    { command: "balance", description: "Check your balance" },
    { command: "history", description: "View payment history" },
    { command: "claim", description: "Claim a payment link" },
    { command: "help", description: "Show help & commands" },
  ]);
}

async function autoDelete(ctx: Context, messageId: number, delayMs: number) {
  setTimeout(async () => {
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, messageId);
    } catch {
      // Message may already be deleted
    }
  }, delayMs);
}

/** Small delay helper */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Send the home screen (single photo message with caption + buttons) */
async function sendHomeScreen(
  ctx: Context,
  address: string,
  balanceSol: string
) {
  await ctx.replyWithPhoto(`${APP_URL}/hoppy-tgblackpng.png`, {
    caption: startMessage(address, balanceSol),
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(),
  });
}

/** Edit an existing message back to home screen */
async function editToHomeScreen(ctx: Context) {
  const wallet = await getWallet(ctx.from!.id);
  if (!wallet) return;
  let balanceSol = "—";
  try {
    const bal = await getBalance(wallet.wallet_address);
    balanceSol = lamportsToSol(bal).toFixed(4);
  } catch {
    // Balance fetch failed
  }
  await ctx.editMessageText(startMessage(wallet.wallet_address, balanceSol), {
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(),
  });
}

/** Claim a payment on behalf of a user (used by receive buttons) */
async function claimPaymentForUser(
  paymentId: number,
  recipientTgUserId: number,
  recipientPrivacy: string = "quick"
): Promise<{ success: boolean; amountReceived?: number; error?: string }> {
  const payment = await getPaymentById(paymentId);
  if (!payment) return { success: false, error: "Payment not found" };
  if (payment.status === "claimed")
    return { success: false, error: "Already claimed" };

  const recipientWallet = await getWallet(recipientTgUserId);
  if (!recipientWallet) return { success: false, error: "No wallet found" };
  const recipientWalletAddress = recipientWallet.wallet_address;

  const note = extractNoteFromUrl(payment.claim_url);
  if (!note) return { success: false, error: "Invalid claim link" };

  try {
    const compositeSecret = decodeCompositeSecret(note.secret);
    if (!compositeSecret) return { success: false, error: "Invalid claim secret" };
    const ephemeralKeypair = compositeSecret.ephemeralKeypair;
    const ephemeralPubkey = ephemeralKeypair.publicKey;

    const connection = new Connection(RPC_URL, "confirmed");
    const wsolMint = new PublicKey(WSOL_MINT);

    if (recipientPrivacy === "quick") {
      // ---- BASIC CLAIM: bundle wSOL ATA close + native SOL drain in one tx
      // so the ATA's ~0.00204 SOL rent is recovered into the transfer.
      const { amountSent } = await drainEphemeralToRecipient(
        connection,
        ephemeralKeypair,
        recipientWalletAddress
      );
      await updatePaymentStatus(paymentId, "claimed");
      return { success: true, amountReceived: amountSent || note.amount };
    } else {
      // ---- PRIVATE CLAIM: Ephemeral → Umbra pool → Receiver (receiver-claimable UTXO) ----
      // Close any pre-existing wSOL ATA before wrapping fresh, so we don't
      // collide with the create-ATA instruction below.
      const wsolAta = await getAssociatedTokenAddress(wsolMint, ephemeralPubkey);
      const preWsolInfo = await connection.getAccountInfo(wsolAta);
      if (preWsolInfo) {
        const closeTx = new Transaction().add(
          createCloseAccountInstruction(wsolAta, ephemeralPubkey, ephemeralPubkey)
        );
        await sendAndConfirmTransaction(connection, closeTx, [ephemeralKeypair], { commitment: "confirmed" });
      }

      const ephBalance = await connection.getBalance(ephemeralPubkey);
      const gasReserve = EPHEMERAL_GAS_BUFFER;
      const available = Math.max(0, ephBalance - gasReserve);
      if (available <= 0) throw new Error("Insufficient ephemeral balance for private claim");

      // 1. Wrap SOL → wSOL on ephemeral
      const ephWsolAta = await getAssociatedTokenAddress(wsolMint, ephemeralPubkey);
      const wrapTx = new Transaction();
      wrapTx.add(createAssociatedTokenAccountInstruction(ephemeralPubkey, ephWsolAta, ephemeralPubkey, wsolMint));
      wrapTx.add(SystemProgram.transfer({ fromPubkey: ephemeralPubkey, toPubkey: ephWsolAta, lamports: available }));
      wrapTx.add(createSyncNativeInstruction(ephWsolAta));
      await sendAndConfirmTransaction(connection, wrapTx, [ephemeralKeypair], { commitment: "confirmed" });

      // 2. Register ephemeral on Umbra
      const ephUmbraClient = await createUmbraClientFromKeypair(ephemeralKeypair);
      await ensureRegistered(ephUmbraClient);

      // 3. Register receiver on Umbra
      const recipientSecretKey = decryptSecretKey(recipientWallet.encrypted_secret_key, recipientTgUserId);
      const recipientKeypair = keypairFromBase58(recipientSecretKey);
      const receiverUmbraClient = await createUmbraClientFromKeypair(recipientKeypair);
      await ensureRegistered(receiverUmbraClient);

      // 4. Ephemeral creates receiver-claimable UTXO for receiver
      const utxoAmount = Math.floor(available / (1 + UMBRA_FEE_PERCENT));
      const { getPublicBalanceToReceiverClaimableUtxoCreatorFunction } = await import("@umbra-privacy/sdk");
      const { getCreateReceiverClaimableUtxoFromPublicBalanceProver } = await import("@umbra-privacy/web-zk-prover");
      const createProver = getCreateReceiverClaimableUtxoFromPublicBalanceProver();
      const createUtxo = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
        { client: ephUmbraClient },
        { zkProver: createProver }
      );
      await createUtxo({
        amount: BigInt(utxoAmount) as any,
        destinationAddress: recipientWalletAddress as any,
        mint: WSOL_MINT as any,
      });

      // 5. Receiver claims from pool → encrypted balance
      const { getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction, getClaimableUtxoScannerFunction } =
        await import("@umbra-privacy/sdk");
      const { getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver } =
        await import("@umbra-privacy/web-zk-prover");
      const relayer = await getRelayer();
      // v4: client exposes fetchBatchMerkleProof directly when indexerApiEndpoint is provided
      const fetchBatchMerkleProof = (receiverUmbraClient as any).fetchBatchMerkleProof;
      const claimProver = getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver();
      const claimFn = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
        { client: receiverUmbraClient },
        { zkProver: claimProver, relayer, fetchBatchMerkleProof }
      );
      const fetchClaimable = getClaimableUtxoScannerFunction({ client: receiverUmbraClient });
      const fetchResult = await fetchClaimable(BigInt(0) as any, BigInt(0) as any, BigInt(10000) as any);
      // v4: from public balance → publicReceived. Fallback to received for safety.
      const utxos = (fetchResult as any).publicReceived || fetchResult.received || [];
      if (utxos.length === 0) throw new Error("No claimable UTXOs found for receiver");
      await claimFn(utxos);

      // 6. Receiver withdraws encrypted → public (wSOL)
      const { getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction } = await import("@umbra-privacy/sdk");
      const withdrawFn = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({ client: receiverUmbraClient });
      await withdrawFn(
        recipientWalletAddress as any,
        WSOL_MINT as any,
        BigInt(utxoAmount) as any,
      );

      // 7. Unwrap wSOL → SOL on receiver (close ATA)
      const receiverWsolAta = await getAssociatedTokenAddress(wsolMint, recipientKeypair.publicKey);
      try {
        await getAccount(connection, receiverWsolAta);
        const closeReceiverTx = new Transaction().add(
          createCloseAccountInstruction(receiverWsolAta, recipientKeypair.publicKey, recipientKeypair.publicKey)
        );
        await sendAndConfirmTransaction(connection, closeReceiverTx, [recipientKeypair], { commitment: "confirmed" });
      } catch {
        // No wSOL ATA on receiver
      }

      await updatePaymentStatus(paymentId, "claimed");
      return { success: true, amountReceived: utxoAmount };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Claim failed";
    return { success: false, error: msg };
  }
}

// ================================================================
// Handler Registration
// ================================================================

function registerHandlers(bot: Bot) {
  // ============ Commands ============

  bot.command("start", async (ctx) => {
    const tgUserId = ctx.from!.id;
    const tgUsername = ctx.from?.username;

    const existing = await getWallet(tgUserId);

    if (existing) {
      if (tgUsername) await updateWalletUsername(tgUserId, tgUsername);
      let balanceSol = "—";
      try {
        const bal = await getBalance(existing.wallet_address);
        balanceSol = lamportsToSol(bal).toFixed(4);
      } catch {
        // Balance fetch failed
      }
      await sendHomeScreen(ctx, existing.wallet_address, balanceSol);
      if (tgUsername) await deliverPendingPayments(ctx, tgUsername);
      return;
    }

    // New user
    const wallet = generateWallet();
    const encrypted = encryptSecretKey(wallet.secretKey, tgUserId);
    await createNewWallet(tgUserId, tgUsername, wallet.publicKey, encrypted);

    const msg = await ctx.replyWithPhoto(`${APP_URL}/hoppy-tgblackpng.png`, {
      caption: startNewUserMessage(wallet.publicKey, wallet.secretKey),
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(),
    });
    autoDelete(ctx, msg.message_id, 120_000);

    if (tgUsername) await deliverPendingPayments(ctx, tgUsername);
  });

  bot.command("balance", handleBalance);

  bot.command("export", async (ctx) => {
    const tgUserId = ctx.from!.id;
    const wallet = await getWallet(tgUserId);
    if (!wallet) {
      await ctx.reply(errorMessage("No wallet found. Use /start first."), {
        parse_mode: "HTML",
      });
      return;
    }
    const secretKey = decryptSecretKey(wallet.encrypted_secret_key, tgUserId);
    const msg = await ctx.reply(exportMessage(secretKey), {
      parse_mode: "HTML",
    });
    autoDelete(ctx, msg.message_id, 60_000);
  });

  bot.command("newwallet", async (ctx) => {
    const tgUserId = ctx.from!.id;
    const tgUsername = ctx.from?.username;
    const wallet = generateWallet();
    const encrypted = encryptSecretKey(wallet.secretKey, tgUserId);
    const result = await createNewWallet(tgUserId, tgUsername, wallet.publicKey, encrypted);
    if (!result.success) {
      await ctx.reply(errorMessage(result.error || "Could not create wallet."), {
        parse_mode: "HTML",
      });
      return;
    }

    const msg = await ctx.reply(
      startNewUserMessage(wallet.publicKey, wallet.secretKey),
      {
        parse_mode: "HTML",
        reply_markup: mainMenuKeyboard(),
      }
    );
    autoDelete(ctx, msg.message_id, 120_000);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpMessage(), { parse_mode: "HTML" });
  });

  bot.command("send", async (ctx) => {
    const text = ctx.message?.text || "";
    const rest = text.replace(/^\/send\s*/i, "").trim();
    if (!rest) {
      // Show privacy selection
      clearSendFlow(ctx.from!.id);
      const replyMsg = await ctx.reply(
        [
          `💸 <b>New Payment</b>`,
          ``,
          `Choose send mode:`,
          ``,
          `🔒 <b>Private</b> — ZK mixer hides your wallet (0.3% fee)`,
          `⚡ <b>Basic</b> — Direct transfer, cheaper but visible on-chain`,
        ].join("\n"),
        {
          parse_mode: "HTML",
          reply_markup: sendPrivacyKeyboard(),
        }
      );
      setSendFlow(ctx.from!.id, {
        step: "awaiting_privacy",
        startedAt: Date.now(),
        messageId: replyMsg.message_id,
      });
      return;
    }
    await handleSend(ctx, `send ${rest}`);
  });

  bot.command("transfer", async (ctx) => {
    const tgUserId = ctx.from!.id;
    clearTransferFlow(tgUserId);
    const replyMsg = await ctx.reply(transferAddressMessage(), {
      parse_mode: "HTML",
      reply_markup: transferCancelKeyboard(),
    });
    setTransferFlow(tgUserId, {
      step: "awaiting_address",
      startedAt: Date.now(),
      messageId: replyMsg.message_id,
    });
  });

  bot.command("claim", async (ctx) => {
    const text = ctx.message?.text || "";
    const rest = text.replace(/^\/claim\s*/i, "").trim();
    if (!rest) {
      await ctx.reply(
        errorMessage("Paste a hoppy.cash claim link after /claim"),
        { parse_mode: "HTML" }
      );
      return;
    }
    await handleClaim(ctx, rest);
  });

  bot.command("history", async (ctx) => {
    const tgUserId = ctx.from!.id;
    const payments = await getPaymentsByUser(tgUserId, 15);
    await ctx.reply(historyMessage(payments), {
      parse_mode: "HTML",
      reply_markup: historyWithRecallKeyboard(payments),
    });
  });

  bot.command("recall", async (ctx) => {
    const text = ctx.message?.text || "";
    const idMatch = text.match(/(\d+)/);
    if (!idMatch) {
      await ctx.reply(
        errorMessage("Usage: /recall <payment_id>\n\nCheck /history for IDs."),
        { parse_mode: "HTML" }
      );
      return;
    }
    await handleRecall(ctx, parseInt(idMatch[1]));
  });

  // ============ Callback Queries — Main Menu ============

  bot.callbackQuery(CB.SEND, async (ctx) => {
    await ctx.answerCallbackQuery();
    clearSendFlow(ctx.from.id);
    // Show privacy selection
    const replyMsg = await ctx.reply(
      [
        `💸 <b>New Payment</b>`,
        ``,
        `Choose send mode:`,
        ``,
        `🔒 <b>Private</b> — ZK mixer hides your wallet (0.3% fee)`,
        `⚡ <b>Basic</b> — Direct transfer, cheaper but visible on-chain`,
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: sendPrivacyKeyboard(),
      }
    );
    setSendFlow(ctx.from.id, {
      step: "awaiting_privacy",
      startedAt: Date.now(),
      messageId: replyMsg.message_id,
    });
  });

  bot.callbackQuery(CB.TRANSFER, async (ctx) => {
    await ctx.answerCallbackQuery();
    clearTransferFlow(ctx.from.id);
    const replyMsg = await ctx.reply(transferAddressMessage(), {
      parse_mode: "HTML",
      reply_markup: transferCancelKeyboard(),
    });
    setTransferFlow(ctx.from.id, {
      step: "awaiting_address",
      startedAt: Date.now(),
      messageId: replyMsg.message_id,
    });
  });

  bot.callbackQuery(CB.HISTORY, async (ctx) => {
    await ctx.answerCallbackQuery();
    const payments = await getPaymentsByUser(ctx.from.id, 15);
    await ctx.reply(historyMessage(payments), {
      parse_mode: "HTML",
      reply_markup: historyWithRecallKeyboard(payments),
    });
  });

  bot.callbackQuery(CB.BALANCE, async (ctx) => {
    await ctx.answerCallbackQuery();
    const wallet = await getWallet(ctx.from.id);
    if (!wallet) {
      await ctx.reply(
        errorMessage("No wallet found. Use /start."),
        { parse_mode: "HTML" }
      );
      return;
    }
    const balance = await getBalance(wallet.wallet_address);
    await ctx.reply(
      balanceMessage(wallet.wallet_address, balance),
      {
        parse_mode: "HTML",
        reply_markup: backToHomeKeyboard(),
      }
    );
  });

  bot.callbackQuery(CB.CLAIM, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "📥 <b>Claim a Payment</b>\n\nPaste your hoppy.cash claim link below:",
      { parse_mode: "HTML", reply_markup: backToHomeKeyboard() }
    );
  });

  bot.callbackQuery(CB.SETTINGS, async (ctx) => {
    await ctx.answerCallbackQuery();
    const wallet = await getWallet(ctx.from.id);
    if (!wallet) return;
    const count = await getWalletCount(ctx.from.id);
    await ctx.reply(settingsMessage(wallet.wallet_address, count), {
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(count),
    });
  });

  bot.callbackQuery(CB.HOME, async (ctx) => {
    await ctx.answerCallbackQuery();
    await editToHomeScreen(ctx);
  });

  // ============ Callback Queries — Settings ============

  bot.callbackQuery(CB.SET_EXPORT, async (ctx) => {
    await ctx.answerCallbackQuery();
    const wallet = await getWallet(ctx.from.id);
    if (!wallet) return;
    const secretKey = decryptSecretKey(
      wallet.encrypted_secret_key,
      ctx.from.id
    );
    const msg = await ctx.reply(exportMessage(secretKey), {
      parse_mode: "HTML",
    });
    autoDelete(ctx, msg.message_id, 60_000);
  });

  bot.callbackQuery(CB.SET_NEWWALLET, async (ctx) => {
    await ctx.answerCallbackQuery();
    const wallet = generateWallet();
    const encrypted = encryptSecretKey(wallet.secretKey, ctx.from.id);
    const result = await createNewWallet(
      ctx.from.id,
      ctx.from.username,
      wallet.publicKey,
      encrypted
    );
    if (!result.success) {
      await ctx.reply(errorMessage(result.error || "Could not create wallet."), {
        parse_mode: "HTML",
      });
      return;
    }
    const msg = await ctx.reply(
      startNewUserMessage(wallet.publicKey, wallet.secretKey),
      {
        parse_mode: "HTML",
        reply_markup: mainMenuKeyboard(),
      }
    );
    autoDelete(ctx, msg.message_id, 120_000);
  });

  bot.callbackQuery(CB.SET_BACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await editToHomeScreen(ctx);
  });

  bot.callbackQuery(CB.SET_SWITCH, async (ctx) => {
    await ctx.answerCallbackQuery();
    const wallets = await getWalletsByUser(ctx.from.id);
    if (wallets.length <= 1) {
      await ctx.reply(errorMessage("You only have one wallet."), {
        parse_mode: "HTML",
      });
      return;
    }
    await ctx.editMessageText(switchWalletMessage(), {
      parse_mode: "HTML",
      reply_markup: walletListKeyboard(wallets),
    });
  });

  bot.callbackQuery(/^wal:sw:\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const walletId = parseInt(ctx.callbackQuery.data.split(":")[2]);
    const success = await setActiveWallet(ctx.from.id, walletId);
    if (!success) {
      await ctx.reply(errorMessage("Could not switch wallet."), {
        parse_mode: "HTML",
      });
      return;
    }
    const wallet = await getWallet(ctx.from.id);
    if (!wallet) return;
    const short = `${wallet.wallet_address.slice(0, 6)}...${wallet.wallet_address.slice(-4)}`;
    await ctx.editMessageText(
      `✅ Switched to wallet <code>${short}</code>`,
      { parse_mode: "HTML", reply_markup: backToHomeKeyboard() }
    );
  });

  // ============ Callback Queries — Send Flow ============

  bot.callbackQuery(CB.SEND_PRIV, async (ctx) => {
    await ctx.answerCallbackQuery();
    const flow = getSendFlow(ctx.from.id);
    if (!flow) return;
    setSendFlow(ctx.from.id, {
      ...flow,
      step: "awaiting_recipient",
      privacy: "private",
    });
    await ctx.editMessageText(sendFlowRecipientMessage("private"), {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    });
  });

  bot.callbackQuery(CB.SEND_QUICK, async (ctx) => {
    await ctx.answerCallbackQuery();
    const flow = getSendFlow(ctx.from.id);
    if (!flow) return;
    setSendFlow(ctx.from.id, {
      ...flow,
      step: "awaiting_recipient",
      privacy: "basic",
    });
    await ctx.editMessageText(sendFlowRecipientMessage("basic"), {
      parse_mode: "HTML",
      reply_markup: cancelKeyboard(),
    });
  });

  bot.callbackQuery(CB.SEND_CANCEL, async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    clearSendFlow(ctx.from.id);
    await editToHomeScreen(ctx);
  });

  bot.callbackQuery(CB.CONFIRM_YES, async (ctx) => {
    await ctx.answerCallbackQuery("Processing...");
    const flow = getSendFlow(ctx.from.id);
    if (
      !flow ||
      flow.step !== "awaiting_confirm" ||
      !flow.recipient ||
      !flow.amount ||
      !flow.privacy
    ) {
      return;
    }
    const anonymous = flow.anonymous ?? true;
    clearSendFlow(ctx.from.id);

    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: { inline_keyboard: [] },
      });
    } catch {
      // Message may not be editable
    }

    const privacyWord = flow.privacy === "private" ? "privately" : "";
    const sendText =
      `send ${flow.amount} SOL to ${flow.recipient} ${privacyWord}`.trim();
    await executeSend(ctx, sendText, anonymous, (flow.privacy as SenderPrivacy) || "basic");
  });

  bot.callbackQuery(CB.SEND_ANON, async (ctx) => {
    await ctx.answerCallbackQuery();
    const flow = getSendFlow(ctx.from.id);
    if (!flow || flow.step !== "awaiting_confirm") return;
    const toggled = !(flow.anonymous ?? true);
    setSendFlow(ctx.from.id, { ...flow, anonymous: toggled });
    const est = getReceiveEstimates(flow.amount!, flow.privacy!);
    const confirmText = sendFlowConfirmMessage(
      flow.amount!,
      flow.recipient!,
      flow.privacy!,
      toggled,
      est
    );
    try {
      await ctx.editMessageText(confirmText, {
        parse_mode: "HTML",
        reply_markup: confirmSendKeyboard(toggled),
      });
    } catch {}
  });

  bot.callbackQuery(CB.CONFIRM_NO, async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    clearSendFlow(ctx.from.id);
    clearPendingConfirmation(ctx.from.id);
    await editToHomeScreen(ctx);
  });

  // ============ Callback Queries — Transfer Flow ============

  bot.callbackQuery(CB.TRANSFER_CONFIRM, async (ctx) => {
    await ctx.answerCallbackQuery("Processing...");
    const flow = getTransferFlow(ctx.from.id);
    if (
      !flow ||
      flow.step !== "awaiting_confirm" ||
      !flow.address ||
      !flow.amount
    ) {
      return;
    }
    clearTransferFlow(ctx.from.id);

    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: { inline_keyboard: [] },
      });
    } catch {
      // Message may not be editable
    }

    await executeTransfer(ctx, flow.address, flow.amount);
  });

  bot.callbackQuery(CB.TRANSFER_CANCEL, async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    clearTransferFlow(ctx.from.id);
    await editToHomeScreen(ctx);
  });

  // ============ Callback Queries — Receive / Claim Buttons ============

  bot.callbackQuery(/^rcv:quick:\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const paymentId = parseInt(ctx.callbackQuery.data.split(":")[2]);
    const wallet = await getWallet(ctx.from.id);
    if (!wallet) {
      await ctx.reply(errorMessage("No wallet found. Use /start first."), {
        parse_mode: "HTML",
      });
      return;
    }

    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: { inline_keyboard: [] },
      });
    } catch {}

    const statusMsg = await ctx.reply("⏳ Claiming payment...", {
      parse_mode: "HTML",
    });
    const chatId = ctx.chat!.id;

    // Fire and forget — don't block webhook response
    claimPaymentForUser(paymentId, ctx.from.id, "quick")
      .then(async (result) => {
        if (result.success) {
          await ctx.api.editMessageText(
            chatId, statusMsg.message_id,
            claimSuccessMessage(result.amountReceived || 0),
            { parse_mode: "HTML" }
          );
        } else {
          await ctx.api.editMessageText(
            chatId, statusMsg.message_id,
            errorMessage(result.error || "Claim failed"),
            { parse_mode: "HTML" }
          );
        }
      })
      .catch(async (err) => {
        console.error("[TG Bot] Background quick claim error:", err);
        try {
          await ctx.api.editMessageText(
            chatId, statusMsg.message_id,
            errorMessage("Claim failed unexpectedly"),
            { parse_mode: "HTML" }
          );
        } catch {}
      });
  });

  bot.callbackQuery(/^rcv:priv:\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const paymentId = parseInt(ctx.callbackQuery.data.split(":")[2]);
    const wallet = await getWallet(ctx.from.id);
    if (!wallet) {
      await ctx.reply(errorMessage("No wallet found. Use /start first."), {
        parse_mode: "HTML",
      });
      return;
    }

    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: { inline_keyboard: [] },
      });
    } catch {}

    const statusMsg = await ctx.reply(
      "⏳ Claiming privately — generating ZK proof, this may take a minute...",
      { parse_mode: "HTML" }
    );
    const chatId = ctx.chat!.id;

    // Fire and forget — don't block webhook response
    claimPaymentForUser(paymentId, ctx.from.id, "private")
      .then(async (result) => {
        if (result.success) {
          await ctx.api.editMessageText(
            chatId, statusMsg.message_id,
            claimSuccessMessage(result.amountReceived || 0),
            { parse_mode: "HTML" }
          );
        } else {
          await ctx.api.editMessageText(
            chatId, statusMsg.message_id,
            errorMessage(result.error || "Claim failed"),
            { parse_mode: "HTML" }
          );
        }
      })
      .catch(async (err) => {
        console.error("[TG Bot] Background private claim error:", err);
        try {
          await ctx.api.editMessageText(
            chatId, statusMsg.message_id,
            errorMessage("Claim failed unexpectedly"),
            { parse_mode: "HTML" }
          );
        } catch {}
      });
  });

  bot.callbackQuery(/^rcv:link:\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const paymentId = parseInt(ctx.callbackQuery.data.split(":")[2]);
    const payment = await getPaymentById(paymentId);
    if (!payment) {
      await ctx.reply(errorMessage("Payment not found."), {
        parse_mode: "HTML",
      });
      return;
    }
    await ctx.reply(
      `🔗 <b>Claim Link</b>\n\n<code>${payment.claim_url}</code>\n\nPaste this on hoppy.cash/claim or use /claim in this chat.`,
      { parse_mode: "HTML" }
    );
  });

  // ============ Callback Queries — Recall from History ============

  bot.callbackQuery(/^recall:\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const paymentId = parseInt(ctx.callbackQuery.data.split(":")[1]);
    await handleRecall(ctx, paymentId);
  });

  // ============ Free-Text NLP Handler ============

  bot.on("message:text", async (ctx) => {
    const rawText = ctx.message.text;
    const tgUserId = ctx.from!.id;

    // Skip unrecognized slash commands
    if (rawText.startsWith("/")) {
      await ctx.reply(helpMessage(), { parse_mode: "HTML" });
      return;
    }

    // ---- Transfer flow interception (check first) ----
    const xferFlow = getTransferFlow(tgUserId);
    if (xferFlow) {
      if (xferFlow.step === "awaiting_address") {
        const input = rawText.trim();
        // Validate Solana address (base58, 32-44 chars)
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) {
          await ctx.reply(
            "Please enter a valid Solana address (base58 public key).",
            { parse_mode: "HTML" }
          );
          return;
        }
        // Verify it's a valid public key
        try {
          new PublicKey(input);
        } catch {
          await ctx.reply(
            "Invalid Solana address. Please try again.",
            { parse_mode: "HTML" }
          );
          return;
        }
        setTransferFlow(tgUserId, {
          ...xferFlow,
          step: "awaiting_amount",
          address: input,
        });
        if (xferFlow.messageId) {
          try {
            await ctx.api.editMessageText(
              ctx.chat!.id,
              xferFlow.messageId,
              transferAmountMessage(input),
              { parse_mode: "HTML", reply_markup: transferCancelKeyboard() }
            );
            return;
          } catch {}
        }
        await ctx.reply(transferAmountMessage(input), {
          parse_mode: "HTML",
          reply_markup: transferCancelKeyboard(),
        });
        return;
      }

      if (xferFlow.step === "awaiting_amount") {
        const amount = parseFloat(rawText.trim());
        if (isNaN(amount) || amount <= 0 || amount > 1000) {
          await ctx.reply(
            "Please enter a valid amount (e.g. <code>0.5</code>).",
            { parse_mode: "HTML" }
          );
          return;
        }
        setTransferFlow(tgUserId, {
          ...xferFlow,
          step: "awaiting_confirm",
          amount,
        });
        const confirmText = transferConfirmMessage(xferFlow.address!, amount);
        if (xferFlow.messageId) {
          try {
            await ctx.api.editMessageText(
              ctx.chat!.id,
              xferFlow.messageId,
              confirmText,
              { parse_mode: "HTML", reply_markup: confirmTransferKeyboard() }
            );
            return;
          } catch {}
        }
        await ctx.reply(confirmText, {
          parse_mode: "HTML",
          reply_markup: confirmTransferKeyboard(),
        });
        return;
      }
    }

    // ---- Interactive send flow interception ----
    const flow = getSendFlow(tgUserId);
    if (flow) {
      if (flow.step === "awaiting_recipient") {
        const input = rawText.trim();
        const recipientMatch = input.match(/^@?(\w{3,32})$/);
        if (!recipientMatch) {
          await ctx.reply(
            "Please enter a valid @username (e.g. <code>@alice</code>).",
            { parse_mode: "HTML" }
          );
          return;
        }
        const recipient = input.startsWith("@") ? input : `@${input}`;
        setSendFlow(tgUserId, {
          ...flow,
          step: "awaiting_amount",
          recipient,
        });
        if (flow.messageId) {
          try {
            await ctx.api.editMessageText(
              ctx.chat!.id,
              flow.messageId,
              sendFlowAmountMessage(flow.privacy!, recipient),
              { parse_mode: "HTML", reply_markup: cancelKeyboard() }
            );
            return;
          } catch {}
        }
        await ctx.reply(sendFlowAmountMessage(flow.privacy!, recipient), {
          parse_mode: "HTML",
          reply_markup: cancelKeyboard(),
        });
        return;
      }

      if (flow.step === "awaiting_amount") {
        const amount = parseFloat(rawText.trim());
        if (isNaN(amount) || amount <= 0 || amount > 1000) {
          await ctx.reply(
            "Please enter a valid amount (e.g. <code>0.5</code>).",
            { parse_mode: "HTML" }
          );
          return;
        }
        const minErr = getMinAmountError(amount, flow.privacy || "basic");
        if (minErr) {
          await ctx.reply(errorMessageHtml(minErr), { parse_mode: "HTML" });
          return;
        }
        const defaultAnon = true;
        setSendFlow(tgUserId, {
          ...flow,
          step: "awaiting_confirm",
          amount,
          anonymous: defaultAnon,
        });
        const est = getReceiveEstimates(amount, flow.privacy!);
        const confirmText = sendFlowConfirmMessage(
          amount,
          flow.recipient!,
          flow.privacy!,
          defaultAnon,
          est
        );
        if (flow.messageId) {
          try {
            await ctx.api.editMessageText(
              ctx.chat!.id,
              flow.messageId,
              confirmText,
              { parse_mode: "HTML", reply_markup: confirmSendKeyboard(defaultAnon) }
            );
            return;
          } catch {}
        }
        await ctx.reply(confirmText, {
          parse_mode: "HTML",
          reply_markup: confirmSendKeyboard(defaultAnon),
        });
        return;
      }
    }

    // ---- Legacy text-based pending confirmation ----
    const pending = getPendingConfirmation(tgUserId);
    if (pending) {
      const lower = rawText.trim().toLowerCase();
      if (lower === "yes" || lower === "y" || lower === "confirm") {
        clearPendingConfirmation(tgUserId);
        await executeSend(ctx, pending.text);
        return;
      } else if (lower === "no" || lower === "n" || lower === "cancel") {
        clearPendingConfirmation(tgUserId);
        await ctx.reply(escapeMarkdown("Payment cancelled."), {
          parse_mode: "HTML",
        });
        return;
      }
      clearPendingConfirmation(tgUserId);
    }

    // ---- Sanitize input ----
    const sanitized = sanitizeInput(rawText);
    if (sanitized.blocked) {
      await ctx.reply(
        escapeMarkdown(sanitized.reason || "Message could not be processed."),
        { parse_mode: "HTML" }
      );
      return;
    }

    // ---- Rate limit check for LLM path ----
    const withinLimit = checkLLMRateLimit(tgUserId);

    let parsed;
    if (withinLimit) {
      parsed = await parseIntent(sanitized.text);
    } else {
      const { parseIntentSync } = await import("./intents");
      parsed = parseIntentSync(sanitized.text);
    }

    switch (parsed.intent) {
      case "SEND":
        await handleSend(ctx, sanitized.text);
        break;
      case "CLAIM":
        if (parsed.claimUrl) await handleClaim(ctx, parsed.claimUrl);
        break;
      case "BALANCE":
        await handleBalance(ctx);
        break;
      case "HISTORY": {
        const payments = await getPaymentsByUser(tgUserId, 15);
        await ctx.reply(historyMessage(payments), {
          parse_mode: "HTML",
          reply_markup: historyWithRecallKeyboard(payments),
        });
        break;
      }
      case "RECALL":
        if (parsed.paymentId) await handleRecall(ctx, parsed.paymentId);
        else
          await ctx.reply(
            errorMessage("Which payment? Use /recall <id> or check /history."),
            { parse_mode: "HTML" }
          );
        break;
      case "EXPORT": {
        const wallet = await getWallet(tgUserId);
        if (!wallet) {
          await ctx.reply(
            errorMessage("No wallet found. Use /start first."),
            { parse_mode: "HTML" }
          );
          return;
        }
        const sk = decryptSecretKey(wallet.encrypted_secret_key, tgUserId);
        const msg = await ctx.reply(exportMessage(sk), {
          parse_mode: "HTML",
        });
        autoDelete(ctx, msg.message_id, 60_000);
        break;
      }
      case "HELP":
        await ctx.reply(helpMessage(), { parse_mode: "HTML" });
        break;
      default:
        await ctx.reply(
          escapeMarkdown(
            "I didn't understand that. Type /help to see what I can do, or just tell me what you need!\n\n" +
              'Examples:\n- "send 0.5 sol to @alice privately"\n- "what\'s my balance?"\n- Paste a hoppy.cash claim link'
          ),
          { parse_mode: "HTML" }
        );
    }
  });
}

// ================================================================
// Command Handlers
// ================================================================

async function handleBalance(ctx: Context) {
  const tgUserId = ctx.from!.id;
  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "HTML",
    });
    return;
  }
  const balance = await getBalance(wallet.wallet_address);
  await ctx.reply(balanceMessage(wallet.wallet_address, balance), {
    parse_mode: "HTML",
    reply_markup: backToHomeKeyboard(),
  });
}

async function handleSend(ctx: Context, text: string) {
  const tgUserId = ctx.from!.id;
  const parsed = await parseIntent(text);

  if (parsed.intent !== "SEND" || !parsed.amount || !parsed.recipient) {
    await ctx.reply(
      escapeMarkdown(
        'I couldn\'t parse that. Try: "send 0.5 SOL to @username privately"'
      ),
      { parse_mode: "HTML" }
    );
    return;
  }

  const privacy: SenderPrivacy = /\bprivate(ly)?\b/i.test(text) ? "private" : "basic";
  const minErr = getMinAmountError(parsed.amount, privacy);
  if (minErr) {
    await ctx.reply(errorMessageHtml(minErr), { parse_mode: "HTML" });
    return;
  }

  // Always confirm before sending
  const defaultAnonymous = true;
  setPendingConfirmation(tgUserId, {
    text,
    expiresAt: Date.now() + 60_000,
  });
  setSendFlow(tgUserId, {
    step: "awaiting_confirm",
    privacy,
    recipient: parsed.recipient,
    amount: parsed.amount,
    anonymous: defaultAnonymous,
    startedAt: Date.now(),
  });

  const est = getReceiveEstimates(parsed.amount, privacy);
  await ctx.reply(
    sendFlowConfirmMessage(
      parsed.amount,
      parsed.recipient,
      privacy,
      defaultAnonymous,
      est
    ),
    { parse_mode: "HTML", reply_markup: confirmSendKeyboard(defaultAnonymous) }
  );
}

async function executeSend(ctx: Context, text: string, anonymous = true, privacy: SenderPrivacy = "basic") {
  const tgUserId = ctx.from!.id;
  const parsed = await parseIntent(text);

  if (parsed.intent !== "SEND" || !parsed.amount || !parsed.recipient) {
    await ctx.reply(errorMessage("Failed to re-parse send command."), {
      parse_mode: "HTML",
    });
    return;
  }

  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "HTML",
    });
    return;
  }

  const token = parsed.token || "SOL";

  if (token !== "SOL") {
    await ctx.reply(
      errorMessage("Only SOL is supported in the bot for now."),
      { parse_mode: "HTML" }
    );
    return;
  }

  const amountLamports = solToLamports(parsed.amount);
  const balance = await getBalance(wallet.wallet_address);
  const cost = calculateSenderCost(amountLamports, privacy);

  if (balance < cost.senderPays) {
    const feeDesc = privacy === "basic"
      ? `Tx fee: <b>~0.000005 SOL</b>`
      : `Commission: <b>~${lamportsToSol(cost.senderFee).toFixed(4)} SOL (0.3% + gas)</b>`;
    await ctx.reply(
      errorMessageHtml(
        `Insufficient balance.\n\n` +
        `You have: <b>${lamportsToSol(balance).toFixed(4)} SOL</b>\n` +
        `Amount: <b>${parsed.amount} SOL</b>\n` +
        `${feeDesc}\n` +
        `Total needed: <b>~${lamportsToSol(cost.senderPays).toFixed(4)} SOL</b>`
      ),
      { parse_mode: "HTML" }
    );
    return;
  }

  await ctx.reply(
    sendConfirmMessage(parsed.amount, token, parsed.recipient, privacy),
    { parse_mode: "HTML" }
  );

  try {
    const ephemeral = generateEphemeralKey();
    const ephemeralAddress = ephemeral.address;

    const connection = new Connection(RPC_URL, "confirmed");
    const secretKey = decryptSecretKey(wallet.encrypted_secret_key, tgUserId);
    const userKeypair = keypairFromBase58(secretKey);

    if (privacy === "basic") {
      // ---- BASIC SEND: Direct transfer sender → ephemeral, no Umbra ----
      const fundingAmount = amountLamports + 5000; // amount + tx fee reserve for claim
      const fundingTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: userKeypair.publicKey,
          toPubkey: new PublicKey(ephemeralAddress),
          lamports: fundingAmount,
        })
      );
      await sendAndConfirmTransaction(connection, fundingTx, [userKeypair], { commitment: "confirmed" });
    } else {
      // ---- PRIVATE SEND: Sender → Umbra pool → Ephemeral (receiver-claimable UTXO) ----

      // 1. Send gas to ephemeral for Umbra registration
      const gasTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: userKeypair.publicKey,
          toPubkey: new PublicKey(ephemeralAddress),
          lamports: EPHEMERAL_GAS_BUFFER,
        })
      );
      await sendAndConfirmTransaction(connection, gasTx, [userKeypair], { commitment: "confirmed" });

      // 2. Wrap SOL → wSOL on sender's wallet
      const commission = Math.ceil(amountLamports * UMBRA_FEE_PERCENT);
      const wsolMint = new PublicKey(WSOL_MINT);
      const senderWsolAta = await getAssociatedTokenAddress(wsolMint, userKeypair.publicKey);
      const wrapAmount = amountLamports + commission;

      const wrapTx = new Transaction();
      wrapTx.add(createAssociatedTokenAccountInstruction(userKeypair.publicKey, senderWsolAta, userKeypair.publicKey, wsolMint));
      wrapTx.add(SystemProgram.transfer({ fromPubkey: userKeypair.publicKey, toPubkey: senderWsolAta, lamports: wrapAmount }));
      wrapTx.add(createSyncNativeInstruction(senderWsolAta));
      await sendAndConfirmTransaction(connection, wrapTx, [userKeypair], { commitment: "confirmed" });

      // 3. Register sender on Umbra
      const senderUmbraClient = await createUmbraClientFromKeypair(userKeypair);
      await ensureRegistered(senderUmbraClient);

      // 4. Register ephemeral on Umbra
      const ephUmbraClient = await createUmbraClientFromKeypair(ephemeral.keypair);
      await ensureRegistered(ephUmbraClient);

      // 5. Sender creates receiver-claimable UTXO for ephemeral
      const { getPublicBalanceToReceiverClaimableUtxoCreatorFunction } = await import("@umbra-privacy/sdk");
      const { getCreateReceiverClaimableUtxoFromPublicBalanceProver } = await import("@umbra-privacy/web-zk-prover");
      const createProver = getCreateReceiverClaimableUtxoFromPublicBalanceProver();
      const createUtxo = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
        { client: senderUmbraClient },
        { zkProver: createProver }
      );
      await createUtxo({
        amount: BigInt(amountLamports) as any,
        destinationAddress: ephemeralAddress as any,
        mint: WSOL_MINT as any,
      });

      // 6. Ephemeral claims from pool → encrypted balance
      const { getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction, getClaimableUtxoScannerFunction } =
        await import("@umbra-privacy/sdk");
      const { getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver } =
        await import("@umbra-privacy/web-zk-prover");
      const relayer = await getRelayer();
      // v4: client exposes fetchBatchMerkleProof directly
      const fetchBatchMerkleProof = (ephUmbraClient as any).fetchBatchMerkleProof;
      const claimProver = getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver();
      const claimFn = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
        { client: ephUmbraClient },
        { zkProver: claimProver, relayer, fetchBatchMerkleProof }
      );
      const fetchClaimable = getClaimableUtxoScannerFunction({ client: ephUmbraClient });
      const fetchResult = await fetchClaimable(BigInt(0) as any, BigInt(0) as any, BigInt(10000) as any);
      // v4: from public balance → publicReceived. Fallback to received for safety.
      const utxos = (fetchResult as any).publicReceived || fetchResult.received || [];
      if (utxos.length === 0) throw new Error("No claimable UTXOs found for ephemeral");
      await claimFn(utxos);

      // 7. Ephemeral withdraws encrypted → public balance (wSOL)
      const { getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction } = await import("@umbra-privacy/sdk");
      const withdrawFn = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({ client: ephUmbraClient });
      await withdrawFn(
        ephemeralAddress as any,
        WSOL_MINT as any,
        BigInt(amountLamports) as any,
      );

      // 8. Unwrap wSOL → SOL (close ATA)
      const ephWsolAta = await getAssociatedTokenAddress(wsolMint, ephemeral.keypair.publicKey);
      const closeTx = new Transaction().add(
        createCloseAccountInstruction(ephWsolAta, ephemeral.keypair.publicKey, ephemeral.keypair.publicKey)
      );
      await sendAndConfirmTransaction(connection, closeTx, [ephemeral.keypair], { commitment: "confirmed" });
    }

    // Create claim URL with ephemeral seed
    const note: UmbraNote = {
      ephemeralSeed: ephemeral.seed,
      amount: amountLamports,
      network: process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet-beta" ? "mainnet" : "devnet",
      token: "SOL",
      tokenMint: WSOL_MINT,
      createdAt: Date.now(),
      ephemeralAddress: ephemeralAddress,
      status: "funded",
      fundsLocation: "ephemeral",
      senderPrivacy: privacy,
      senderAddress: "",
      secret: ephemeral.seed,
    };
    const claimUrl = createClaimUrl(note, APP_URL);

    let delivered = false;
    const recipientId = parsed.recipient;

    // Save payment FIRST so we have an ID for the receive buttons
    if (recipientId.startsWith("@")) {
      const recipientUsername = recipientId.slice(1);
      const recipientWallet = await getWalletByUsername(recipientUsername);

      const paymentId = await savePayment({
        senderTgId: tgUserId,
        recipientIdentifier: recipientUsername.toLowerCase(),
        deliveryMethod: "telegram",
        claimUrl,
        amount: amountLamports,
        senderPrivacy: privacy,
        senderAnonymous: anonymous,
      });

      if (recipientWallet) {
        try {
          const senderName = anonymous ? undefined : ctx.from?.username;
          await ctx.api.sendPhoto(
            recipientWallet.tg_user_id,
            `${APP_URL}/hoppy-tgcarrot.png`,
            {
              caption: receivedPaymentMessage(
                amountLamports,
                senderName,
                recipientWallet.wallet_address
              ),
              parse_mode: "HTML",
              reply_markup: receivedPaymentKeyboard(paymentId),
            }
          );
          delivered = true;
          await updatePaymentStatus(paymentId, "delivered");
        } catch {
          // Couldn't DM — stays pending for deliverPendingPayments
        }
      }
    } else {
      // Non-@ recipient (just a link)
      await savePayment({
        senderTgId: tgUserId,
        recipientIdentifier: recipientId,
        deliveryMethod: "link",
        claimUrl,
        amount: amountLamports,
        senderPrivacy: privacy,
        senderAnonymous: anonymous,
      });
    }

    await ctx.reply(
      sendSuccessMessage(
        parsed.amount,
        token,
        recipientId,
        claimUrl,
        delivered
      ),
      { parse_mode: "HTML" }
    );

    if (!delivered && recipientId.startsWith("@")) {
      await ctx.reply(
        escapeMarkdown(
          `Note: ${recipientId} hasn't started the bot yet. The payment will be delivered when they do. Or share the link above manually.`
        ),
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Payment failed";
    await ctx.reply(errorMessage(msg), { parse_mode: "HTML" });
  }
}

async function executeTransfer(
  ctx: Context,
  destinationAddress: string,
  amountSol: number
) {
  const tgUserId = ctx.from!.id;
  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "HTML",
    });
    return;
  }

  const amountLamports = solToLamports(amountSol);
  const balance = await getBalance(wallet.wallet_address);
  const TX_FEE = 5000;

  if (balance < amountLamports + TX_FEE) {
    await ctx.reply(
      errorMessage(
        `Insufficient balance. You have ${lamportsToSol(balance).toFixed(4)} SOL but need ~${lamportsToSol(amountLamports + TX_FEE).toFixed(4)} SOL.`
      ),
      { parse_mode: "HTML" }
    );
    return;
  }

  await ctx.reply(escapeMarkdown("Sending transfer..."), {
    parse_mode: "HTML",
  });

  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const secretKey = decryptSecretKey(wallet.encrypted_secret_key, tgUserId);
    const userKeypair = keypairFromBase58(secretKey);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: new PublicKey(destinationAddress),
        lamports: amountLamports,
      })
    );

    const txHash = await sendAndConfirmTransaction(
      connection,
      tx,
      [userKeypair],
      { commitment: "confirmed" }
    );

    await ctx.reply(
      transferSuccessMessage(amountSol, destinationAddress, txHash),
      { parse_mode: "HTML" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Transfer failed";
    await ctx.reply(errorMessage(msg), { parse_mode: "HTML" });
  }
}

async function handleClaim(
  ctx: Context,
  urlOrText: string,
  recipientPrivacy: string = "quick"
) {
  const tgUserId = ctx.from!.id;
  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "HTML",
    });
    return;
  }

  const note = extractNoteFromUrl(urlOrText);
  if (!note) {
    await ctx.reply(
      errorMessage(
        "Invalid claim link. Make sure you pasted the full hoppy.cash URL."
      ),
      { parse_mode: "HTML" }
    );
    return;
  }

  await ctx.reply(escapeMarkdown("Claiming payment..."), {
    parse_mode: "HTML",
  });

  try {
    const compositeSecret = decodeCompositeSecret(note.secret);
    if (!compositeSecret) throw new Error("Invalid claim secret");
    const ephemeralKeypair = compositeSecret.ephemeralKeypair;
    const ephemeralPubkey = ephemeralKeypair.publicKey;

    const connection = new Connection(RPC_URL, "confirmed");
    const wsolMint = new PublicKey(WSOL_MINT);

    if (recipientPrivacy === "quick") {
      // ---- BASIC CLAIM: bundle wSOL ATA close + native SOL drain in one tx
      // so the ATA's ~0.00204 SOL rent is recovered into the transfer.
      const { amountSent } = await drainEphemeralToRecipient(
        connection,
        ephemeralKeypair,
        wallet.wallet_address
      );
      await ctx.reply(
        claimSuccessMessage(amountSent || note.amount),
        { parse_mode: "HTML" }
      );
    } else {
      // ---- PRIVATE CLAIM: Ephemeral → Umbra pool → Receiver ----
      // Close any pre-existing wSOL ATA before wrapping fresh below.
      const wsolAta = await getAssociatedTokenAddress(wsolMint, ephemeralPubkey);
      const preWsolInfo = await connection.getAccountInfo(wsolAta);
      if (preWsolInfo) {
        const closeTx = new Transaction().add(
          createCloseAccountInstruction(wsolAta, ephemeralPubkey, ephemeralPubkey)
        );
        await sendAndConfirmTransaction(connection, closeTx, [ephemeralKeypair], { commitment: "confirmed" });
      }

      const ephBalance = await connection.getBalance(ephemeralPubkey);
      const gasReserve = EPHEMERAL_GAS_BUFFER;
      const available = Math.max(0, ephBalance - gasReserve);
      if (available <= 0) throw new Error("Insufficient balance for private claim");

      // 1. Wrap SOL → wSOL on ephemeral
      const ephWsolAta = await getAssociatedTokenAddress(wsolMint, ephemeralPubkey);
      const wrapTx = new Transaction();
      wrapTx.add(createAssociatedTokenAccountInstruction(ephemeralPubkey, ephWsolAta, ephemeralPubkey, wsolMint));
      wrapTx.add(SystemProgram.transfer({ fromPubkey: ephemeralPubkey, toPubkey: ephWsolAta, lamports: available }));
      wrapTx.add(createSyncNativeInstruction(ephWsolAta));
      await sendAndConfirmTransaction(connection, wrapTx, [ephemeralKeypair], { commitment: "confirmed" });

      // 2. Register ephemeral on Umbra
      const ephUmbraClient = await createUmbraClientFromKeypair(ephemeralKeypair);
      await ensureRegistered(ephUmbraClient);

      // 3. Register receiver on Umbra
      const recipientSecretKey = decryptSecretKey(wallet.encrypted_secret_key, tgUserId);
      const recipientKeypair = keypairFromBase58(recipientSecretKey);
      const receiverUmbraClient = await createUmbraClientFromKeypair(recipientKeypair);
      await ensureRegistered(receiverUmbraClient);

      // 4. Ephemeral creates receiver-claimable UTXO for receiver
      const utxoAmount = Math.floor(available / (1 + UMBRA_FEE_PERCENT));
      const { getPublicBalanceToReceiverClaimableUtxoCreatorFunction } = await import("@umbra-privacy/sdk");
      const { getCreateReceiverClaimableUtxoFromPublicBalanceProver } = await import("@umbra-privacy/web-zk-prover");
      const createProver = getCreateReceiverClaimableUtxoFromPublicBalanceProver();
      const createUtxo = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
        { client: ephUmbraClient },
        { zkProver: createProver }
      );
      await createUtxo({
        amount: BigInt(utxoAmount) as any,
        destinationAddress: wallet.wallet_address as any,
        mint: WSOL_MINT as any,
      });

      // 5. Receiver claims from pool → encrypted balance
      const { getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction, getClaimableUtxoScannerFunction } =
        await import("@umbra-privacy/sdk");
      const { getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver } =
        await import("@umbra-privacy/web-zk-prover");
      const relayer = await getRelayer();
      // v4: client exposes fetchBatchMerkleProof directly when indexerApiEndpoint is provided
      const fetchBatchMerkleProof = (receiverUmbraClient as any).fetchBatchMerkleProof;
      const claimProver = getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver();
      const claimFn = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
        { client: receiverUmbraClient },
        { zkProver: claimProver, relayer, fetchBatchMerkleProof }
      );
      const fetchClaimable = getClaimableUtxoScannerFunction({ client: receiverUmbraClient });
      const fetchResult = await fetchClaimable(BigInt(0) as any, BigInt(0) as any, BigInt(10000) as any);
      // v4: from public balance → publicReceived. Fallback to received for safety.
      const utxos = (fetchResult as any).publicReceived || fetchResult.received || [];
      if (utxos.length === 0) throw new Error("No claimable UTXOs found for receiver");
      await claimFn(utxos);

      // 6. Receiver withdraws encrypted → public (wSOL)
      const { getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction } = await import("@umbra-privacy/sdk");
      const withdrawFn = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({ client: receiverUmbraClient });
      await withdrawFn(
        wallet.wallet_address as any,
        WSOL_MINT as any,
        BigInt(utxoAmount) as any,
      );

      // 7. Unwrap wSOL → SOL on receiver (close ATA)
      const receiverWsolAta = await getAssociatedTokenAddress(wsolMint, recipientKeypair.publicKey);
      try {
        await getAccount(connection, receiverWsolAta);
        const closeReceiverTx = new Transaction().add(
          createCloseAccountInstruction(receiverWsolAta, recipientKeypair.publicKey, recipientKeypair.publicKey)
        );
        await sendAndConfirmTransaction(connection, closeReceiverTx, [recipientKeypair], { commitment: "confirmed" });
      } catch {
        // No wSOL ATA on receiver
      }

      await ctx.reply(
        claimSuccessMessage(utxoAmount),
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Claim failed";
    await ctx.reply(errorMessage(msg), { parse_mode: "HTML" });
  }
}

async function handleRecall(ctx: Context, paymentId: number) {
  const tgUserId = ctx.from!.id;
  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "HTML",
    });
    return;
  }

  const payments = await getPaymentsByUser(tgUserId, 100);
  const payment = payments.find((p: any) => p.id === paymentId);

  if (!payment) {
    await ctx.reply(
      errorMessage(`Payment #${paymentId} not found. Check /history.`),
      { parse_mode: "HTML" }
    );
    return;
  }

  if (payment.status !== "pending") {
    await ctx.reply(
      errorMessage(`Payment #${paymentId} is already ${payment.status}.`),
      { parse_mode: "HTML" }
    );
    return;
  }

  await ctx.reply(escapeMarkdown("Recalling payment..."), {
    parse_mode: "HTML",
  });

  try {
    const note = extractNoteFromUrl(payment.claim_url);
    if (!note) throw new Error("Could not parse payment link");

    const compositeSecret = decodeCompositeSecret(note.secret);
    if (!compositeSecret) throw new Error("Could not decode payment secret");

    const connection = new Connection(RPC_URL, "confirmed");
    const ephemeralKeypair = compositeSecret.ephemeralKeypair;

    // Bundle wSOL ATA close + native SOL drain in one tx so the ATA's
    // ~0.00204 SOL rent is recovered into the recall.
    const { amountSent } = await drainEphemeralToRecipient(
      connection,
      ephemeralKeypair,
      wallet.wallet_address
    );

    if (amountSent <= 0) {
      await updatePaymentStatus(paymentId, "claimed");
      await ctx.reply(
        errorMessage(
          "No funds left - payment may have already been claimed."
        ),
        { parse_mode: "HTML" }
      );
      return;
    }

    await updatePaymentStatus(paymentId, "recalled");

    await ctx.reply(
      escapeMarkdown(
        `✅ Recalled ${lamportsToSol(amountSent).toFixed(4)} SOL from payment #${paymentId} back to your wallet.`
      ),
      { parse_mode: "HTML" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Recall failed";
    await ctx.reply(errorMessage(msg), { parse_mode: "HTML" });
  }
}

async function deliverPendingPayments(ctx: Context, username: string) {
  const pending = await getPendingPaymentsForUser(username);
  if (pending.length === 0) return;

  const recipientWallet = await getWallet(ctx.from!.id);
  const walletAddr = recipientWallet?.wallet_address || "unknown";

  for (const payment of pending) {
    try {
      // Look up sender username if payment is not anonymous
      let senderUsername: string | undefined;
      if (!payment.sender_anonymous) {
        const senderWallet = await getWallet(payment.sender_tg_id);
        senderUsername = senderWallet?.tg_username || undefined;
      }

      await ctx.replyWithPhoto(`${APP_URL}/hoppy-tgcarrot.png`, {
        caption: receivedPaymentDeliveredMessage(
          payment.amount,
          walletAddr,
          senderUsername,
        ),
        parse_mode: "HTML",
        reply_markup: receivedPaymentKeyboard(payment.id),
      });
      await updatePaymentStatus(payment.id, "delivered");
    } catch {
      // Failed to deliver
    }
  }
}
