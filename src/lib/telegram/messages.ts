import { lamportsToSol } from "./wallet";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function welcomeMessage(address: string, secretKey: string): string {
  return [
    "Welcome to <b>Hoppy</b> - Private payments on Solana!",
    "",
    "Your wallet has been created:",
    `<code>${esc(address)}</code>`,
    "",
    "Your private key (SAVE THIS NOW):",
    `<code>${esc(secretKey)}</code>`,
    "",
    "⚠️ <b>This message will self-destruct in 2 minutes.</b>",
    "Write down your key and delete this message.",
    "",
    "Fund your wallet by sending SOL to the address above.",
    "Type /help to see what I can do.",
  ].join("\n");
}

export function walletExistsMessage(address: string): string {
  return [
    "You already have a wallet:",
    `<code>${esc(address)}</code>`,
    "",
    "Use /export to see your private key.",
    "Use /newwallet to generate a fresh one.",
  ].join("\n");
}

export function balanceMessage(address: string, lamports: number): string {
  const sol = lamportsToSol(lamports).toFixed(4);
  return [
    `<b>Wallet Balance</b>`,
    "",
    `Address: <code>${esc(address)}</code>`,
    `Balance: <b>${sol} SOL</b>`,
    "",
    lamports < 10_000_000
      ? "Fund your wallet by sending SOL to the address above."
      : "Use /send to create a private payment.",
  ].join("\n");
}

export function exportMessage(secretKey: string): string {
  return [
    "🔑 <b>Your Private Key</b>",
    "",
    `<code>${esc(secretKey)}</code>`,
    "",
    "Import this into Phantom or Solflare for self-custody.",
    "⚠️ <b>This message will self-destruct in 60 seconds.</b>",
  ].join("\n");
}

export function helpMessage(): string {
  return [
    "🐰 <b>Hoppy Bot - Commands</b>",
    "",
    "<b>Basics:</b>",
    "/start - Create your wallet",
    "/balance - Check your balance",
    "/export - Show your private key",
    "/newwallet - Generate a new wallet",
    "",
    "<b>Payments:</b>",
    "/send - Send a private payment",
    "  Example: <code>send 0.5 sol to @alice privately</code>",
    "/claim - Claim a payment link",
    "  Or just paste any hoppy.cash link",
    "/recall - Get back unclaimed funds",
    "",
    "<b>History:</b>",
    "/history - View your payment history",
    "",
    "<b>Tips:</b>",
    '- You can type naturally: "pay @bob 1 SOL"',
    '- Add "privately" for sender privacy',
    "- Paste any hoppy.cash link to auto-claim",
  ].join("\n");
}

export function sendConfirmMessage(
  amount: number,
  token: string,
  recipient: string,
  privacy: string,
): string {
  const privacyLabel = privacy === "private" ? "Private (sender hidden)" : "Basic (cheaper)";
  return [
    "<b>Payment Summary</b>",
    "",
    `Amount: <b>${amount} ${esc(token)}</b>`,
    `Recipient: <b>${esc(recipient)}</b>`,
    `Privacy: <b>${esc(privacyLabel)}</b>`,
    "",
    "Processing...",
  ].join("\n");
}

export function sendSuccessMessage(
  amount: number,
  token: string,
  recipient: string,
  claimUrl: string,
  delivered: boolean,
): string {
  const deliveryStatus = delivered
    ? `Sent to <b>${esc(recipient)}</b> via DM.`
    : "Link returned below (share it yourself).";

  return [
    "✅ <b>Payment Created!</b>",
    "",
    `Amount: <b>${amount} ${esc(token)}</b>`,
    deliveryStatus,
    "",
    `Claim link:`,
    `<code>${esc(claimUrl)}</code>`,
  ].join("\n");
}

export function claimSuccessMessage(amountLamports: number): string {
  const sol = lamportsToSol(amountLamports).toFixed(4);
  return `✅ <b>Claimed ${sol} SOL</b> to your Hoppy wallet!`;
}

export function pendingPaymentNotification(
  amount: number,
  senderUsername: string | undefined,
): string {
  const from = senderUsername ? `@${esc(senderUsername)}` : "someone";
  const sol = lamportsToSol(amount).toFixed(4);
  return [
    `🎉 <b>You received a payment!</b>`,
    "",
    `${sol} SOL from ${from}`,
    "It has been auto-claimed to your wallet.",
  ].join("\n");
}

export function historyMessage(
  payments: Array<{
    id: number;
    amount: number;
    recipient_identifier: string;
    status: string;
    sender_privacy: string;
    created_at: string;
  }>,
): string {
  if (payments.length === 0) {
    return "No payment history yet. Use /send to create your first payment!";
  }

  const lines = ["<b>Payment History</b>", ""];
  for (const p of payments) {
    const sol = lamportsToSol(p.amount).toFixed(4);
    const date = new Date(p.created_at).toLocaleDateString();
    const statusIcon =
      p.status === "claimed" ? "✅" :
      p.status === "recalled" ? "↩️" :
      p.status === "expired" ? "⏰" : "⏳";
    const privacy = p.sender_privacy === "private" ? "🔒" : "👁";

    lines.push(
      `${statusIcon} #${p.id} | ${sol} SOL → ${esc(p.recipient_identifier)} ${privacy} (${esc(date)})`
    );
  }

  return lines.join("\n");
}

export function errorMessage(msg: string): string {
  return `❌ ${esc(msg)}`;
}

export { esc as escapeMarkdown };
