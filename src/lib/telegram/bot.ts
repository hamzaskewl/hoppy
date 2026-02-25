import { Bot, Context } from "grammy";
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
  upsertWallet,
  savePayment,
  getPaymentsByUser,
  getPendingPaymentsForUser,
  updatePaymentStatus,
} from "./db";
import {
  welcomeMessage,
  walletExistsMessage,
  balanceMessage,
  exportMessage,
  helpMessage,
  sendConfirmMessage,
  sendSuccessMessage,
  claimSuccessMessage,
  historyMessage,
  errorMessage,
  escapeMarkdown,
} from "./messages";
import { Connection, Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  generateCompositeSecret,
  createDoubleHopClaimUrl,
  extractDoubleHopNoteFromUrl,
  decodeCompositeSecret,
} from "@/lib/privacy/privacy-cash-adapter";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

// SOL threshold above which we require confirmation before sending
const SEND_CONFIRM_THRESHOLD_SOL = 1;

// In-memory pending confirmations: tgUserId -> pending send details
const pendingConfirmations = new Map<number, {
  text: string;
  expiresAt: number;
}>();

function createBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return new Bot(token);
}

let botInstance: Bot | null = null;

export function getBot(): Bot {
  if (!botInstance) {
    botInstance = createBot();
    registerHandlers(botInstance);
  }
  return botInstance;
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

function registerHandlers(bot: Bot) {
  // /start - Create wallet
  bot.command("start", async (ctx) => {
    const tgUserId = ctx.from!.id;
    const tgUsername = ctx.from?.username;

    const existing = await getWallet(tgUserId);
    if (existing) {
      await ctx.reply(walletExistsMessage(existing.wallet_address), {
        parse_mode: "MarkdownV2",
      });
      if (tgUsername) await deliverPendingPayments(ctx, tgUsername);
      return;
    }

    const wallet = generateWallet();
    const encrypted = encryptSecretKey(wallet.secretKey, tgUserId);
    await upsertWallet(tgUserId, tgUsername, wallet.publicKey, encrypted);

    const msg = await ctx.reply(welcomeMessage(wallet.publicKey, wallet.secretKey), {
      parse_mode: "MarkdownV2",
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
        parse_mode: "MarkdownV2",
      });
      return;
    }

    const secretKey = decryptSecretKey(wallet.encrypted_secret_key, tgUserId);
    const msg = await ctx.reply(exportMessage(secretKey), {
      parse_mode: "MarkdownV2",
    });
    autoDelete(ctx, msg.message_id, 60_000);
  });

  bot.command("newwallet", async (ctx) => {
    const tgUserId = ctx.from!.id;
    const tgUsername = ctx.from?.username;

    const wallet = generateWallet();
    const encrypted = encryptSecretKey(wallet.secretKey, tgUserId);
    await upsertWallet(tgUserId, tgUsername, wallet.publicKey, encrypted);

    const msg = await ctx.reply(welcomeMessage(wallet.publicKey, wallet.secretKey), {
      parse_mode: "MarkdownV2",
    });
    autoDelete(ctx, msg.message_id, 120_000);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpMessage(), { parse_mode: "MarkdownV2" });
  });

  bot.command("send", async (ctx) => {
    const text = ctx.message?.text || "";
    const rest = text.replace(/^\/send\s*/i, "").trim();
    if (!rest) {
      await ctx.reply(
        escapeMarkdown("Usage: /send 0.5 SOL to @username [privately]\n\nOr just type naturally: \"send 0.5 sol to @alice privately\""),
        { parse_mode: "MarkdownV2" }
      );
      return;
    }
    await handleSend(ctx, `send ${rest}`);
  });

  bot.command("claim", async (ctx) => {
    const text = ctx.message?.text || "";
    const rest = text.replace(/^\/claim\s*/i, "").trim();
    if (!rest) {
      await ctx.reply(errorMessage("Paste a hoppy.cash claim link after /claim"), {
        parse_mode: "MarkdownV2",
      });
      return;
    }
    await handleClaim(ctx, rest);
  });

  bot.command("history", async (ctx) => {
    const tgUserId = ctx.from!.id;
    const payments = await getPaymentsByUser(tgUserId, 15);
    await ctx.reply(historyMessage(payments), { parse_mode: "MarkdownV2" });
  });

  bot.command("recall", async (ctx) => {
    const text = ctx.message?.text || "";
    const idMatch = text.match(/(\d+)/);
    if (!idMatch) {
      await ctx.reply(errorMessage("Usage: /recall <payment_id>\n\nCheck /history for payment IDs."), {
        parse_mode: "MarkdownV2",
      });
      return;
    }
    await handleRecall(ctx, parseInt(idMatch[1]));
  });

  // Free-text NLP handler
  bot.on("message:text", async (ctx) => {
    const rawText = ctx.message.text;
    const tgUserId = ctx.from!.id;

    // Skip unrecognized slash commands
    if (rawText.startsWith("/")) {
      await ctx.reply(helpMessage(), { parse_mode: "MarkdownV2" });
      return;
    }

    // Check for pending confirmation ("yes" / "no")
    const pending = pendingConfirmations.get(tgUserId);
    if (pending && Date.now() < pending.expiresAt) {
      const lower = rawText.trim().toLowerCase();
      if (lower === "yes" || lower === "y" || lower === "confirm") {
        pendingConfirmations.delete(tgUserId);
        await executeSend(ctx, pending.text);
        return;
      } else if (lower === "no" || lower === "n" || lower === "cancel") {
        pendingConfirmations.delete(tgUserId);
        await ctx.reply(escapeMarkdown("Payment cancelled."), { parse_mode: "MarkdownV2" });
        return;
      }
      // Not a yes/no -- clear stale confirmation and continue
      pendingConfirmations.delete(tgUserId);
    }

    // Sanitize input
    const sanitized = sanitizeInput(rawText);
    if (sanitized.blocked) {
      await ctx.reply(
        escapeMarkdown(sanitized.reason || "Message could not be processed."),
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    // Rate limit check for LLM path
    const withinLimit = checkLLMRateLimit(tgUserId);

    // Parse intent (hybrid: regex first, LLM fallback)
    let parsed;
    if (withinLimit) {
      parsed = await parseIntent(sanitized.text);
    } else {
      // Rate limited -- use regex only, no LLM
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
        await ctx.reply(historyMessage(payments), { parse_mode: "MarkdownV2" });
        break;
      }
      case "RECALL":
        if (parsed.paymentId) await handleRecall(ctx, parsed.paymentId);
        else await ctx.reply(errorMessage("Which payment? Use /recall <id> or check /history."), { parse_mode: "MarkdownV2" });
        break;
      case "EXPORT": {
        const wallet = await getWallet(tgUserId);
        if (!wallet) {
          await ctx.reply(errorMessage("No wallet found. Use /start first."), { parse_mode: "MarkdownV2" });
          return;
        }
        const sk = decryptSecretKey(wallet.encrypted_secret_key, tgUserId);
        const msg = await ctx.reply(exportMessage(sk), { parse_mode: "MarkdownV2" });
        autoDelete(ctx, msg.message_id, 60_000);
        break;
      }
      case "HELP":
        await ctx.reply(helpMessage(), { parse_mode: "MarkdownV2" });
        break;
      default:
        await ctx.reply(
          escapeMarkdown(
            "I didn't understand that. Type /help to see what I can do, or just tell me what you need!\n\n" +
            "Examples:\n• \"send 0.5 sol to @alice privately\"\n• \"what's my balance?\"\n• Paste a hoppy.cash claim link"
          ),
          { parse_mode: "MarkdownV2" }
        );
    }
  });
}

// ======== Command Handlers ========

async function handleBalance(ctx: Context) {
  const tgUserId = ctx.from!.id;
  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const balance = await getBalance(wallet.wallet_address);
  await ctx.reply(balanceMessage(wallet.wallet_address, balance), {
    parse_mode: "MarkdownV2",
  });
}

async function handleSend(ctx: Context, text: string) {
  const tgUserId = ctx.from!.id;
  const parsed = await parseIntent(text);

  if (parsed.intent !== "SEND" || !parsed.amount || !parsed.recipient) {
    await ctx.reply(
      escapeMarkdown("I couldn't parse that. Try: \"send 0.5 SOL to @username privately\""),
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  // Confirmation gate for high-value sends
  if (parsed.amount >= SEND_CONFIRM_THRESHOLD_SOL) {
    const privacyLabel = parsed.privacy === "private" ? "privately" : "normally";
    pendingConfirmations.set(tgUserId, {
      text,
      expiresAt: Date.now() + 60_000, // 1 minute to confirm
    });

    await ctx.reply(
      escapeMarkdown(
        `⚠️ Confirm: Send ${parsed.amount} SOL to ${parsed.recipient} ${privacyLabel}?\n\n` +
        `Reply "yes" to confirm or "no" to cancel. Expires in 60 seconds.`
      ),
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  await executeSend(ctx, text);
}

async function executeSend(ctx: Context, text: string) {
  const tgUserId = ctx.from!.id;
  const parsed = await parseIntent(text);

  if (parsed.intent !== "SEND" || !parsed.amount || !parsed.recipient) {
    await ctx.reply(errorMessage("Failed to re-parse send command."), { parse_mode: "MarkdownV2" });
    return;
  }

  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const token = parsed.token || "SOL";
  const privacy = parsed.privacy || "basic";

  if (token !== "SOL") {
    await ctx.reply(errorMessage("Only SOL is supported in the bot for now."), {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const amountLamports = solToLamports(parsed.amount);
  const balance = await getBalance(wallet.wallet_address);

  const MIN_BUFFER = privacy === "private" ? 10_000_000 : 1_000_000;
  if (balance < amountLamports + MIN_BUFFER) {
    await ctx.reply(
      errorMessage(`Insufficient balance. You have ${lamportsToSol(balance).toFixed(4)} SOL but need ~${lamportsToSol(amountLamports + MIN_BUFFER).toFixed(4)} SOL.`),
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  await ctx.reply(
    sendConfirmMessage(parsed.amount, token, parsed.recipient, privacy),
    { parse_mode: "MarkdownV2" }
  );

  try {
    const compositeSecret = generateCompositeSecret();
    const ephemeralAddress = compositeSecret.ephemeralKeypair.publicKey.toBase58();

    const connection = new Connection(RPC_URL, "confirmed");
    const secretKey = decryptSecretKey(wallet.encrypted_secret_key, tgUserId);
    const userKeypair = keypairFromBase58(secretKey);

    const BUFFER = privacy === "private" ? 6_000_000 : 1_000_000;
    const fundingAmount = amountLamports + BUFFER;

    const fundingTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: new PublicKey(ephemeralAddress),
        lamports: fundingAmount,
      })
    );

    const fundingTxHash = await sendAndConfirmTransaction(
      connection,
      fundingTx,
      [userKeypair],
      { commitment: "confirmed" }
    );

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const response = await fetch(`${baseUrl}/api/privacy-cash/create-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountLamports,
        compositeSecret: compositeSecret.full,
        ephemeralAddress,
        fundingTxHash,
        senderPrivacy: privacy,
        senderAddress: wallet.wallet_address,
      }),
    });

    const result = await response.json();
    if (!result.success || !result.note) {
      throw new Error(result.error || "Failed to create payment link");
    }

    const claimUrl = createDoubleHopClaimUrl(result.note);

    let delivered = false;
    const recipientId = parsed.recipient;

    if (recipientId.startsWith("@")) {
      const recipientUsername = recipientId.slice(1);
      const recipientWallet = await getWalletByUsername(recipientUsername);

      if (recipientWallet) {
        try {
          await ctx.api.sendMessage(
            recipientWallet.tg_user_id,
            `🐰 *You received a private payment\\!*\n\n` +
            `Amount: *${parsed.amount} SOL*\n` +
            `From: ${ctx.from?.username ? `@${escapeMarkdown(ctx.from.username)}` : "someone"}\n\n` +
            `Claim link:\n\`${claimUrl}\`\n\n` +
            `Or paste this link on hoppy\\.cash/claim to claim with any wallet\\.`,
            { parse_mode: "MarkdownV2" }
          );
          delivered = true;
        } catch {
          // Couldn't DM
        }
      }

      if (!delivered) {
        await savePayment({
          senderTgId: tgUserId,
          recipientIdentifier: recipientUsername.toLowerCase(),
          deliveryMethod: "telegram",
          claimUrl,
          amount: amountLamports,
          senderPrivacy: privacy,
        });
      }
    }

    if (delivered || !recipientId.startsWith("@")) {
      await savePayment({
        senderTgId: tgUserId,
        recipientIdentifier: recipientId,
        deliveryMethod: delivered ? "telegram" : "link",
        claimUrl,
        amount: amountLamports,
        senderPrivacy: privacy,
      });
    }

    await ctx.reply(
      sendSuccessMessage(parsed.amount, token, recipientId, claimUrl, delivered),
      { parse_mode: "MarkdownV2" }
    );

    if (!delivered && recipientId.startsWith("@")) {
      await ctx.reply(
        escapeMarkdown(`Note: ${recipientId} hasn't started the bot yet. The payment will be delivered when they do. Or share the link above manually.`),
        { parse_mode: "MarkdownV2" }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Payment failed";
    await ctx.reply(errorMessage(msg), { parse_mode: "MarkdownV2" });
  }
}

async function handleClaim(ctx: Context, urlOrText: string) {
  const tgUserId = ctx.from!.id;
  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const note = extractDoubleHopNoteFromUrl(urlOrText);
  if (!note) {
    await ctx.reply(errorMessage("Invalid claim link. Make sure you pasted the full hoppy.cash URL."), {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  await ctx.reply(escapeMarkdown("Claiming payment..."), { parse_mode: "MarkdownV2" });

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const response = await fetch(`${baseUrl}/api/privacy-cash/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note,
        recipientAddress: wallet.wallet_address,
        recipientPrivacy: "quick",
      }),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Claim failed");
    }

    await ctx.reply(claimSuccessMessage(result.amountReceived || note.amount), {
      parse_mode: "MarkdownV2",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Claim failed";
    await ctx.reply(errorMessage(msg), { parse_mode: "MarkdownV2" });
  }
}

async function handleRecall(ctx: Context, paymentId: number) {
  const tgUserId = ctx.from!.id;
  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const payments = await getPaymentsByUser(tgUserId, 100);
  const payment = payments.find((p: any) => p.id === paymentId);

  if (!payment) {
    await ctx.reply(errorMessage(`Payment #${paymentId} not found. Check /history.`), {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  if (payment.status !== "pending") {
    await ctx.reply(errorMessage(`Payment #${paymentId} is already ${payment.status}.`), {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  await ctx.reply(escapeMarkdown("Recalling payment..."), { parse_mode: "MarkdownV2" });

  try {
    const note = extractDoubleHopNoteFromUrl(payment.claim_url);
    if (!note) throw new Error("Could not parse payment link");

    const compositeSecret = decodeCompositeSecret(note.secret);
    if (!compositeSecret) throw new Error("Could not decode payment secret");

    const connection = new Connection(RPC_URL, "confirmed");
    const ephemeralKeypair = compositeSecret.ephemeralKeypair;
    const balance = await connection.getBalance(ephemeralKeypair.publicKey);
    const TX_FEE = 5000;
    const transferAmount = Math.max(0, balance - TX_FEE);

    if (transferAmount <= 0) {
      await updatePaymentStatus(paymentId, "claimed");
      await ctx.reply(errorMessage("No funds left - payment may have already been claimed."), {
        parse_mode: "MarkdownV2",
      });
      return;
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: ephemeralKeypair.publicKey,
        toPubkey: new PublicKey(wallet.wallet_address),
        lamports: transferAmount,
      })
    );

    await sendAndConfirmTransaction(connection, tx, [ephemeralKeypair], {
      commitment: "confirmed",
    });

    await updatePaymentStatus(paymentId, "recalled");

    await ctx.reply(
      escapeMarkdown(`✅ Recalled ${lamportsToSol(transferAmount).toFixed(4)} SOL from payment #${paymentId} back to your wallet.`),
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Recall failed";
    await ctx.reply(errorMessage(msg), { parse_mode: "MarkdownV2" });
  }
}

async function deliverPendingPayments(ctx: Context, username: string) {
  const pending = await getPendingPaymentsForUser(username);
  if (pending.length === 0) return;

  for (const payment of pending) {
    try {
      await ctx.reply(
        `🎉 *Pending payment found\\!*\n\n` +
        `Amount: *${lamportsToSol(payment.amount).toFixed(4)} SOL*\n\n` +
        `Claim link:\n\`${payment.claim_url}\`\n\n` +
        `Use /claim followed by the link above, or paste it to auto\\-claim\\.`,
        { parse_mode: "MarkdownV2" }
      );
      await updatePaymentStatus(payment.id, "delivered");
    } catch {
      // Failed to deliver
    }
  }
}
