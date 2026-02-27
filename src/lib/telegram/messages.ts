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

    // Hashed identifiers are 64-char hex strings — show abbreviated
    const recipient = p.recipient_identifier.length === 64 && /^[a-f0-9]+$/.test(p.recipient_identifier)
      ? `${p.recipient_identifier.slice(0, 8)}...`
      : esc(p.recipient_identifier);

    lines.push(
      `${statusIcon} #${p.id} | ${sol} SOL → ${recipient} ${privacy} (${esc(date)})`
    );
  }

  return lines.join("\n");
}

export function errorMessage(msg: string): string {
  return `❌ ${esc(msg)}`;
}

/** Error message that already contains HTML formatting — not escaped */
export function errorMessageHtml(msg: string): string {
  return `❌ ${msg}`;
}

// ============ New UI Messages ============

export function startMessage(address: string, balanceSol: string): string {
  return [
    `🐰 <b>Hoppy</b> — Private Payments on Solana`,
    ``,
    `<b>Your Wallet</b>`,
    `<code>${esc(address)}</code>`,
    ``,
    `💰 Balance: <b>${balanceSol} SOL</b>`,
    ``,
    `Tap a button below or just type naturally!`,
  ].join("\n");
}

export function startNewUserMessage(
  address: string,
  secretKey: string,
): string {
  return [
    `🐰 <b>Welcome to Hoppy!</b>`,
    ``,
    `Your wallet has been created:`,
    `<code>${esc(address)}</code>`,
    ``,
    `🔑 Your private key (tap to reveal, tap again to copy):`,
    `<tg-spoiler><code>${esc(secretKey)}</code></tg-spoiler>`,
    ``,
    `⚠️ <b>Save this key securely!</b>`,
    `This message will self-destruct in 2 minutes.`,
    ``,
    `Fund your wallet by sending SOL to your address above.`,
  ].join("\n");
}

export function sendFlowPrivacyMessage(): string {
  return [
    `💸 <b>New Payment</b>`,
    ``,
    `Choose your privacy level:`,
    ``,
    `🔒 <b>Private</b> — Sender hidden via ZK proof`,
    `  Fee: ~0.006 SOL + 0.35%`,
    ``,
    `⚡ <b>Quick</b> — Fast & cheap, sender visible`,
    `  Fee: ~0.000005 SOL`,
  ].join("\n");
}

export function sendFlowRecipientMessage(privacy: string): string {
  const label = privacy === "private" ? "🔒 Private" : "⚡ Quick";
  return [
    `💸 <b>New Payment</b> (${label})`,
    ``,
    `Who do you want to send to?`,
    ``,
    `Type the recipient's <b>@username</b>:`,
  ].join("\n");
}

export function sendFlowAmountMessage(
  privacy: string,
  recipient: string,
): string {
  const label = privacy === "private" ? "🔒 Private" : "⚡ Quick";
  return [
    `💸 <b>New Payment</b> (${label})`,
    ``,
    `To: <b>${esc(recipient)}</b>`,
    ``,
    `How much SOL do you want to send?`,
    `Type the amount (e.g. <code>0.5</code>):`,
  ].join("\n");
}

export function sendFlowConfirmMessage(
  amount: number,
  recipient: string,
  privacy: string,
  anonymous: boolean,
  estimates?: { quickEstimate: number; privateEstimate: number },
): string {
  const label =
    privacy === "private"
      ? "🔒 Private (sender hidden)"
      : "⚡ Quick (sender visible)";
  const anonLabel = anonymous
    ? "👻 Anonymous — recipient won't see your username"
    : "👤 Named — recipient will see your @username";

  const lines = [
    `💸 <b>Confirm Payment</b>`,
    ``,
    `Amount: <b>${amount} SOL</b>`,
    `To: <b>${esc(recipient)}</b>`,
    `Mode: <b>${label}</b>`,
    `Identity: <b>${anonLabel}</b>`,
  ];

  if (estimates) {
    lines.push(
      ``,
      `📊 <b>Recipient receives (est.):</b>`,
      `  ⚡ Quick claim: ~${estimates.quickEstimate.toFixed(4)} SOL`,
      `  🔒 Private claim: ~${estimates.privateEstimate.toFixed(4)} SOL`,
    );
  }

  lines.push(``, `Tap ✅ to confirm or ❌ to cancel.`);
  return lines.join("\n");
}

export function settingsMessage(
  activeAddress: string,
  walletCount: number,
): string {
  const short =
    activeAddress.length > 12
      ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}`
      : activeAddress;
  return [
    `⚙️ <b>Settings</b>`,
    ``,
    `Active wallet: <code>${esc(short)}</code>`,
    `Wallets: ${walletCount}/3`,
    ``,
    `🔑 <b>Export</b> — View your private key`,
    `🆕 <b>New Wallet</b> — Generate a fresh wallet`,
    ...(walletCount > 1
      ? [`🔄 <b>Switch Wallet</b> — Change active wallet`]
      : []),
  ].join("\n");
}

export function switchWalletMessage(): string {
  return [
    `🔄 <b>Switch Wallet</b>`,
    ``,
    `Select a wallet to activate:`,
  ].join("\n");
}

// ============ Receive / Claim Messages ============

// Claim overhead constants (lamports)
const QUICK_CLAIM_OVERHEAD = 5_000;        // just tx fee
const PRIVATE_CLAIM_OVERHEAD = 6_000_000;  // deposit overhead + rent + relayer + 0.35%

export function receivedPaymentMessage(
  fundedLamports: number,
  senderUsername: string | undefined,
  walletAddress: string,
): string {
  const quickEst = lamportsToSol(Math.max(0, fundedLamports - QUICK_CLAIM_OVERHEAD)).toFixed(4);
  const privEst = lamportsToSol(Math.max(0, fundedLamports - PRIVATE_CLAIM_OVERHEAD)).toFixed(4);
  const from = senderUsername ? `@${esc(senderUsername)}` : "someone";
  const short = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  return [
    `🎉 <b>You received a payment!</b>`,
    ``,
    `From: ${from}`,
    `Wallet: <code>${short}</code>`,
    ``,
    `⚡ Quick claim: ~<b>${quickEst} SOL</b>`,
    `🔒 Private claim: ~<b>${privEst} SOL</b>`,
    ``,
    `Tap below to claim:`,
  ].join("\n");
}

export function receivedPaymentDeliveredMessage(
  fundedLamports: number,
  walletAddress: string,
  senderUsername?: string,
): string {
  const quickEst = lamportsToSol(Math.max(0, fundedLamports - QUICK_CLAIM_OVERHEAD)).toFixed(4);
  const privEst = lamportsToSol(Math.max(0, fundedLamports - PRIVATE_CLAIM_OVERHEAD)).toFixed(4);
  const short = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  const fromLine = senderUsername ? `From: @${esc(senderUsername)}\n` : "";
  return [
    `🎉 <b>Pending payment found!</b>`,
    ``,
    `${fromLine}Wallet: <code>${short}</code>`,
    ``,
    `⚡ Quick claim: ~<b>${quickEst} SOL</b>`,
    `🔒 Private claim: ~<b>${privEst} SOL</b>`,
    ``,
    `Tap below to claim:`,
  ].join("\n");
}

// ============ Transfer Messages ============

export function transferAddressMessage(): string {
  return [
    `📤 <b>Direct Transfer</b>`,
    ``,
    `Send SOL directly to any Solana address.`,
    `<i>Standard on-chain transfer (not private).</i>`,
    ``,
    `Paste the destination <b>Solana address</b>:`,
    ``,
    `<i>(base58 public key, e.g. CsRE...cezz)</i>`,
  ].join("\n");
}

export function transferAmountMessage(address: string): string {
  const short = address.length > 12
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;
  return [
    `📤 <b>Transfer SOL</b>`,
    ``,
    `To: <code>${esc(address)}</code>`,
    ``,
    `How much SOL do you want to send?`,
    `Type the amount (e.g. <code>0.5</code>):`,
  ].join("\n");
}

export function transferConfirmMessage(
  address: string,
  amount: number,
): string {
  return [
    `📤 <b>Confirm Transfer</b>`,
    ``,
    `Amount: <b>${amount} SOL</b>`,
    `To: <code>${esc(address)}</code>`,
    ``,
    `Tap ✅ to confirm or ❌ to cancel.`,
  ].join("\n");
}

export function transferSuccessMessage(
  amount: number,
  address: string,
  txHash: string,
): string {
  const short = address.length > 12
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;
  return [
    `✅ <b>Transfer Complete!</b>`,
    ``,
    `Sent <b>${amount} SOL</b> to <code>${esc(short)}</code>`,
    ``,
    `Tx: <code>${esc(txHash)}</code>`,
  ].join("\n");
}

// ============ Recovery Messages ============

export function recoverySuccessMessage(sweptSol: string): string {
  return [
    `⚠️ <b>Payment failed</b> — but your funds were recovered!`,
    ``,
    `<b>${sweptSol} SOL</b> was automatically returned to your wallet.`,
  ].join("\n");
}

export function recoveryFailedMessage(
  ephemeralAddress: string,
  errorMsg: string,
): string {
  return [
    `⚠️ <b>Payment failed</b>`,
    ``,
    `${esc(errorMsg)}`,
    ``,
    `Funds may be on ephemeral address:`,
    `<code>${esc(ephemeralAddress)}</code>`,
    ``,
    `Try /recall or contact support.`,
  ].join("\n");
}

export function helpMessage(): string {
  return [
    "🐰 <b>Hoppy Bot - Commands</b>",
    "",
    "<b>Basics:</b>",
    "/start - Open wallet & main menu",
    "/balance - Check your balance",
    "/transfer - Direct SOL transfer (not private)",
    "",
    "<b>Privacy Payments:</b>",
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

export { esc as escapeMarkdown };
