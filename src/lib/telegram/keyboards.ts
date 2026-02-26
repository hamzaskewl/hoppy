import { InlineKeyboard } from "grammy";

// ============ Callback Data Constants ============
export const CB = {
  // Main menu
  SEND: "main:send",
  TRANSFER: "main:transfer",
  HISTORY: "main:history",
  SETTINGS: "main:settings",
  BALANCE: "main:balance",
  CLAIM: "main:claim",
  // Send flow
  SEND_PRIV: "send:priv",
  SEND_QUICK: "send:quick",
  SEND_CANCEL: "send:cancel",
  // Confirmation (shared by send + transfer)
  CONFIRM_YES: "confirm:yes",
  CONFIRM_NO: "confirm:no",
  // Transfer flow
  TRANSFER_CONFIRM: "xfer:yes",
  TRANSFER_CANCEL: "xfer:cancel",
  // Settings
  SET_EXPORT: "set:export",
  SET_NEWWALLET: "set:newwallet",
  SET_SWITCH: "set:switch",
  SET_BACK: "set:back",
  // Navigation
  HOME: "home",
} as const;

// Receive claim prefixes (used with regex matching)
export const RCV_QUICK_PREFIX = "rcv:quick:";
export const RCV_PRIV_PREFIX = "rcv:priv:";
export const RCV_LINK_PREFIX = "rcv:link:";
export const WALLET_SWITCH_PREFIX = "wal:sw:";

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💸 Send", CB.SEND)
    .text("📥 Claim", CB.CLAIM)
    .row()
    .text("💰 Balance", CB.BALANCE)
    .text("📊 History", CB.HISTORY)
    .row()
    .text("📤 Transfer", CB.TRANSFER)
    .text("⚙️ Settings", CB.SETTINGS);
}

export function sendPrivacyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔒 Private", CB.SEND_PRIV)
    .text("⚡ Quick", CB.SEND_QUICK)
    .row()
    .text("❌ Cancel", CB.SEND_CANCEL);
}

export function confirmSendKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm", CB.CONFIRM_YES)
    .text("❌ Cancel", CB.CONFIRM_NO);
}

export function confirmTransferKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm", CB.TRANSFER_CONFIRM)
    .text("❌ Cancel", CB.TRANSFER_CANCEL);
}

export function settingsKeyboard(walletCount: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🔑 Export Private Key", CB.SET_EXPORT)
    .row()
    .text(`🆕 New Wallet (${walletCount}/3)`, CB.SET_NEWWALLET)
    .row();
  if (walletCount > 1) {
    kb.text("🔄 Switch Wallet", CB.SET_SWITCH).row();
  }
  kb.text("⬅️ Back", CB.SET_BACK);
  return kb;
}

export function walletListKeyboard(
  wallets: Array<{ id: number; wallet_address: string; is_active: boolean }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const w of wallets) {
    const short = `${w.wallet_address.slice(0, 6)}...${w.wallet_address.slice(-4)}`;
    const label = w.is_active ? `✅ ${short} (active)` : `    ${short}`;
    kb.text(label, `${WALLET_SWITCH_PREFIX}${w.id}`).row();
  }
  kb.text("⬅️ Back", CB.SET_BACK);
  return kb;
}

export function backToHomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("⬅️ Home", CB.HOME);
}

export function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("❌ Cancel", CB.SEND_CANCEL);
}

export function transferCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("❌ Cancel", CB.TRANSFER_CANCEL);
}

export function receivedPaymentKeyboard(paymentId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🚀 Claim (Quick)", `${RCV_QUICK_PREFIX}${paymentId}`)
    .text("🔒 Claim (Private)", `${RCV_PRIV_PREFIX}${paymentId}`)
    .row()
    .text("🔗 Show Link", `${RCV_LINK_PREFIX}${paymentId}`);
}

export function historyWithRecallKeyboard(
  payments: Array<{ id: number; status: string }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const recallable = payments
    .filter((p) => p.status === "pending")
    .slice(0, 3);
  for (const p of recallable) {
    kb.text(`↩️ Recall #${p.id}`, `recall:${p.id}`).row();
  }
  kb.text("⬅️ Home", CB.HOME);
  return kb;
}
