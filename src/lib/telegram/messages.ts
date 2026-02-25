import { lamportsToSol } from "./wallet";

export function welcomeMessage(address: string, secretKey: string): string {
  return [
    "Welcome to *Hoppy* \\- Private payments on Solana\\! 🐰",
    "",
    "Your wallet has been created:",
    `\`${address}\``,
    "",
    "Your private key \\(SAVE THIS NOW\\):",
    `\`${secretKey}\``,
    "",
    "⚠️ *This message will self\\-destruct in 2 minutes\\.*",
    "Write down your key and delete this message\\.",
    "",
    "Fund your wallet by sending SOL to the address above\\.",
    "Type /help to see what I can do\\.",
  ].join("\n");
}

export function walletExistsMessage(address: string): string {
  return [
    "You already have a wallet:",
    `\`${address}\``,
    "",
    "Use /export to see your private key\\.",
    "Use /newwallet to generate a fresh one\\.",
  ].join("\n");
}

export function balanceMessage(address: string, lamports: number): string {
  const sol = lamportsToSol(lamports).toFixed(4);
  return [
    `*Wallet Balance*`,
    "",
    `Address: \`${address}\``,
    `Balance: *${sol} SOL*`,
    "",
    lamports < 10_000_000
      ? "Fund your wallet by sending SOL to the address above\\."
      : "Use /send to create a private payment\\.",
  ].join("\n");
}

export function exportMessage(secretKey: string): string {
  return [
    "🔑 *Your Private Key*",
    "",
    `\`${secretKey}\``,
    "",
    "Import this into Phantom or Solflare for self\\-custody\\.",
    "⚠️ *This message will self\\-destruct in 60 seconds\\.*",
  ].join("\n");
}

export function helpMessage(): string {
  return [
    "🐰 *Hoppy Bot \\- Commands*",
    "",
    "*Basics:*",
    "/start \\- Create your wallet",
    "/balance \\- Check your balance",
    "/export \\- Show your private key",
    "/newwallet \\- Generate a new wallet",
    "",
    "*Payments:*",
    '/send \\- Send a private payment',
    '  Example: `send 0.5 sol to @alice privately`',
    "/claim \\- Claim a payment link",
    "  Or just paste any hoppy\\.cash link",
    "/recall \\- Get back unclaimed funds",
    "",
    "*History:*",
    "/history \\- View your payment history",
    "",
    "*Tips:*",
    "\\- You can type naturally: \"pay @bob 1 SOL\"",
    "\\- Add \"privately\" for sender privacy",
    '\\- Paste any hoppy\\.cash link to auto\\-claim',
  ].join("\n");
}

export function sendConfirmMessage(
  amount: number,
  token: string,
  recipient: string,
  privacy: string,
): string {
  const privacyLabel = privacy === "private" ? "Private \\(sender hidden\\)" : "Basic \\(cheaper\\)";
  return [
    "*Payment Summary*",
    "",
    `Amount: *${amount} ${token}*`,
    `Recipient: *${escapeMarkdown(recipient)}*`,
    `Privacy: *${privacyLabel}*`,
    "",
    "Processing\\.\\.\\.",
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
    ? `Sent to *${escapeMarkdown(recipient)}* via DM\\.`
    : "Link returned below \\(share it yourself\\)\\.";

  return [
    "✅ *Payment Created\\!*",
    "",
    `Amount: *${amount} ${token}*`,
    deliveryStatus,
    "",
    `Claim link:`,
    `\`${claimUrl}\``,
  ].join("\n");
}

export function claimSuccessMessage(amountLamports: number): string {
  const sol = lamportsToSol(amountLamports).toFixed(4);
  return `✅ *Claimed ${sol} SOL* to your Hoppy wallet\\!`;
}

export function pendingPaymentNotification(
  amount: number,
  senderUsername: string | undefined,
): string {
  const from = senderUsername ? `@${escapeMarkdown(senderUsername)}` : "someone";
  const sol = lamportsToSol(amount).toFixed(4);
  return [
    `🎉 *You received a payment\\!*`,
    "",
    `${sol} SOL from ${from}`,
    "It has been auto\\-claimed to your wallet\\.",
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
    return "No payment history yet\\. Use /send to create your first payment\\!";
  }

  const lines = ["*Payment History*", ""];
  for (const p of payments) {
    const sol = lamportsToSol(p.amount).toFixed(4);
    const date = new Date(p.created_at).toLocaleDateString();
    const statusIcon =
      p.status === "claimed" ? "✅" :
      p.status === "recalled" ? "↩️" :
      p.status === "expired" ? "⏰" : "⏳";
    const privacy = p.sender_privacy === "private" ? "🔒" : "👁";
    
    lines.push(
      `${statusIcon} \\#${p.id} \\| ${sol} SOL → ${escapeMarkdown(p.recipient_identifier)} ${privacy} \\(${escapeMarkdown(date)}\\)`
    );
  }

  return lines.join("\n");
}

export function errorMessage(msg: string): string {
  return `❌ ${escapeMarkdown(msg)}`;
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
