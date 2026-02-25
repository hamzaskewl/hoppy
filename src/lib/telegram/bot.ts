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
  upsertWallet,
  savePayment,
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
  sendFlowPrivacyMessage,
  sendFlowRecipientMessage,
  sendFlowAmountMessage,
  sendFlowConfirmMessage,
  settingsMessage,
  claimSuccessMessage,
  historyMessage,
  errorMessage,
  escapeMarkdown,
} from "./messages";
import {
  mainMenuKeyboard,
  sendPrivacyKeyboard,
  confirmSendKeyboard,
  settingsKeyboard,
  backToHomeKeyboard,
  cancelKeyboard,
  historyWithRecallKeyboard,
  CB,
} from "./keyboards";
import {
  getSendFlow,
  setSendFlow,
  clearSendFlow,
  getPendingConfirmation,
  setPendingConfirmation,
  clearPendingConfirmation,
} from "./state";
import {
  Connection,
  Transaction,
  SystemProgram,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  generateCompositeSecret,
  createDoubleHopClaimUrl,
  extractDoubleHopNoteFromUrl,
  decodeCompositeSecret,
} from "@/lib/privacy/privacy-cash-adapter";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "http://localhost:3000");

console.log("[TG Bot] APP_URL resolved to:", APP_URL);

const SEND_CONFIRM_THRESHOLD_SOL = 1;

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
    setupCommands(botInstance).catch((err) =>
      console.error("[TG Bot] Failed to set commands:", err)
    );
  }
  return botInstance;
}

async function setupCommands(bot: Bot) {
  await bot.api.setMyCommands([
    { command: "start", description: "Open wallet & main menu" },
    { command: "send", description: "Send SOL to someone" },
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

/** Send the home screen (photo + interactive menu) */
async function sendHomeScreen(
  ctx: Context,
  address: string,
  balanceSol: string
) {
  await ctx.replyWithPhoto(`${APP_URL}/hopbunny.png`);
  await ctx.reply(startMessage(address, balanceSol), {
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
    // Balance fetch failed, show placeholder
  }
  await ctx.editMessageText(startMessage(wallet.wallet_address, balanceSol), {
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(),
  });
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
    await upsertWallet(tgUserId, tgUsername, wallet.publicKey, encrypted);

    await ctx.replyWithPhoto(`${APP_URL}/hopbunny.png`);
    const msg = await ctx.reply(
      startNewUserMessage(wallet.publicKey, wallet.secretKey),
      {
        parse_mode: "HTML",
        reply_markup: mainMenuKeyboard(),
      }
    );
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
    await upsertWallet(tgUserId, tgUsername, wallet.publicKey, encrypted);

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
      // No args — start interactive send flow
      clearSendFlow(ctx.from!.id);
      const replyMsg = await ctx.reply(sendFlowPrivacyMessage(), {
        parse_mode: "HTML",
        reply_markup: sendPrivacyKeyboard(),
      });
      setSendFlow(ctx.from!.id, {
        step: "awaiting_privacy",
        startedAt: Date.now(),
        messageId: replyMsg.message_id,
      });
      return;
    }
    await handleSend(ctx, `send ${rest}`);
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
    setSendFlow(ctx.from.id, {
      step: "awaiting_privacy",
      startedAt: Date.now(),
      messageId: ctx.callbackQuery.message?.message_id,
    });
    await ctx.editMessageText(sendFlowPrivacyMessage(), {
      parse_mode: "HTML",
      reply_markup: sendPrivacyKeyboard(),
    });
  });

  bot.callbackQuery(CB.HISTORY, async (ctx) => {
    await ctx.answerCallbackQuery();
    const payments = await getPaymentsByUser(ctx.from.id, 15);
    await ctx.editMessageText(historyMessage(payments), {
      parse_mode: "HTML",
      reply_markup: historyWithRecallKeyboard(payments),
    });
  });

  bot.callbackQuery(CB.BALANCE, async (ctx) => {
    await ctx.answerCallbackQuery();
    const wallet = await getWallet(ctx.from.id);
    if (!wallet) {
      await ctx.editMessageText(
        errorMessage("No wallet found. Use /start."),
        { parse_mode: "HTML" }
      );
      return;
    }
    const balance = await getBalance(wallet.wallet_address);
    await ctx.editMessageText(
      balanceMessage(wallet.wallet_address, balance),
      {
        parse_mode: "HTML",
        reply_markup: backToHomeKeyboard(),
      }
    );
  });

  bot.callbackQuery(CB.CLAIM, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      "📥 <b>Claim a Payment</b>\n\nPaste your hoppy.cash claim link below:",
      { parse_mode: "HTML", reply_markup: backToHomeKeyboard() }
    );
  });

  bot.callbackQuery(CB.SETTINGS, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(settingsMessage(), {
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(),
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
    await upsertWallet(
      ctx.from.id,
      ctx.from.username,
      wallet.publicKey,
      encrypted
    );
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

  // ============ Callback Queries — Send Flow ============

  bot.callbackQuery(CB.SEND_PRIV, async (ctx) => {
    await ctx.answerCallbackQuery();
    const flow = getSendFlow(ctx.from.id);
    if (!flow || flow.step !== "awaiting_privacy") {
      await ctx.answerCallbackQuery("Session expired. Use /start.");
      return;
    }
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
    if (!flow || flow.step !== "awaiting_privacy") {
      await ctx.answerCallbackQuery("Session expired. Use /start.");
      return;
    }
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
    clearSendFlow(ctx.from.id);

    // Remove buttons to prevent double-tap
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
    await executeSend(ctx, sendText);
  });

  bot.callbackQuery(CB.CONFIRM_NO, async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    clearSendFlow(ctx.from.id);
    clearPendingConfirmation(ctx.from.id);
    await editToHomeScreen(ctx);
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

        // Try to edit the flow message in-place
        if (flow.messageId) {
          try {
            await ctx.api.editMessageText(
              ctx.chat!.id,
              flow.messageId,
              sendFlowAmountMessage(flow.privacy!, recipient),
              { parse_mode: "HTML", reply_markup: cancelKeyboard() }
            );
            return;
          } catch {
            // Message too old to edit, send new
          }
        }
        await ctx.reply(
          sendFlowAmountMessage(flow.privacy!, recipient),
          { parse_mode: "HTML", reply_markup: cancelKeyboard() }
        );
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
        setSendFlow(tgUserId, {
          ...flow,
          step: "awaiting_confirm",
          amount,
        });

        const confirmText = sendFlowConfirmMessage(
          amount,
          flow.recipient!,
          flow.privacy!
        );
        if (flow.messageId) {
          try {
            await ctx.api.editMessageText(
              ctx.chat!.id,
              flow.messageId,
              confirmText,
              { parse_mode: "HTML", reply_markup: confirmSendKeyboard() }
            );
            return;
          } catch {
            // Message too old to edit
          }
        }
        await ctx.reply(confirmText, {
          parse_mode: "HTML",
          reply_markup: confirmSendKeyboard(),
        });
        return;
      }

      // If awaiting_confirm, buttons handle it — fall through to NLP
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

  // Confirmation gate for high-value sends — now with inline buttons
  if (parsed.amount >= SEND_CONFIRM_THRESHOLD_SOL) {
    setPendingConfirmation(tgUserId, {
      text,
      expiresAt: Date.now() + 60_000,
    });
    setSendFlow(tgUserId, {
      step: "awaiting_confirm",
      privacy: parsed.privacy || "basic",
      recipient: parsed.recipient,
      amount: parsed.amount,
      startedAt: Date.now(),
    });

    await ctx.reply(
      sendFlowConfirmMessage(
        parsed.amount,
        parsed.recipient,
        parsed.privacy || "basic"
      ),
      { parse_mode: "HTML", reply_markup: confirmSendKeyboard() }
    );
    return;
  }

  await executeSend(ctx, text);
}

async function executeSend(ctx: Context, text: string) {
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
  const privacy = parsed.privacy || "basic";

  if (token !== "SOL") {
    await ctx.reply(
      errorMessage("Only SOL is supported in the bot for now."),
      { parse_mode: "HTML" }
    );
    return;
  }

  const amountLamports = solToLamports(parsed.amount);
  const balance = await getBalance(wallet.wallet_address);

  const MIN_BUFFER = privacy === "private" ? 10_000_000 : 1_000_000;
  if (balance < amountLamports + MIN_BUFFER) {
    await ctx.reply(
      errorMessage(
        `Insufficient balance. You have ${lamportsToSol(balance).toFixed(4)} SOL but need ~${lamportsToSol(amountLamports + MIN_BUFFER).toFixed(4)} SOL.`
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
    const compositeSecret = generateCompositeSecret();
    const ephemeralAddress =
      compositeSecret.ephemeralKeypair.publicKey.toBase58();

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

    const baseUrl = APP_URL;
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

    const claimUrl = createDoubleHopClaimUrl(result.note, baseUrl);

    let delivered = false;
    const recipientId = parsed.recipient;

    if (recipientId.startsWith("@")) {
      const recipientUsername = recipientId.slice(1);
      const recipientWallet = await getWalletByUsername(recipientUsername);

      if (recipientWallet) {
        try {
          await ctx.api.sendMessage(
            recipientWallet.tg_user_id,
            `🐰 <b>You received a private payment!</b>\n\n` +
              `Amount: <b>${parsed.amount} SOL</b>\n` +
              `From: ${ctx.from?.username ? `@${ctx.from.username}` : "someone"}\n\n` +
              `Claim link:\n<code>${claimUrl}</code>\n\n` +
              `Or paste this link on hoppy.cash/claim to claim with any wallet.`,
            { parse_mode: "HTML" }
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

async function handleClaim(ctx: Context, urlOrText: string) {
  const tgUserId = ctx.from!.id;
  const wallet = await getWallet(tgUserId);
  if (!wallet) {
    await ctx.reply(errorMessage("No wallet found. Use /start first."), {
      parse_mode: "HTML",
    });
    return;
  }

  const note = extractDoubleHopNoteFromUrl(urlOrText);
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
    const baseUrl = APP_URL;
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

    await ctx.reply(
      claimSuccessMessage(result.amountReceived || note.amount),
      { parse_mode: "HTML" }
    );
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
      await ctx.reply(
        errorMessage(
          "No funds left - payment may have already been claimed."
        ),
        { parse_mode: "HTML" }
      );
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
      escapeMarkdown(
        `✅ Recalled ${lamportsToSol(transferAmount).toFixed(4)} SOL from payment #${paymentId} back to your wallet.`
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

  for (const payment of pending) {
    try {
      await ctx.reply(
        `🎉 <b>Pending payment found!</b>\n\n` +
          `Amount: <b>${lamportsToSol(payment.amount).toFixed(4)} SOL</b>\n\n` +
          `Claim link:\n<code>${payment.claim_url}</code>\n\n` +
          `Use /claim followed by the link above, or paste it to auto-claim.`,
        { parse_mode: "HTML" }
      );
      await updatePaymentStatus(payment.id, "delivered");
    } catch {
      // Failed to deliver
    }
  }
}
