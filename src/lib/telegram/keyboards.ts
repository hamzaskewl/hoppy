import { InlineKeyboard } from "grammy";

// ============ Callback Data Constants ============
export const CB = {
  // Main menu
  SEND: "main:send",
  HISTORY: "main:history",
  SETTINGS: "main:settings",
  BALANCE: "main:balance",
  CLAIM: "main:claim",
  // Send flow
  SEND_PRIV: "send:priv",
  SEND_QUICK: "send:quick",
  SEND_CANCEL: "send:cancel",
  // Confirmation
  CONFIRM_YES: "confirm:yes",
  CONFIRM_NO: "confirm:no",
  // Settings
  SET_EXPORT: "set:export",
  SET_NEWWALLET: "set:newwallet",
  SET_BACK: "set:back",
  // Navigation
  HOME: "home",
} as const;

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💸 Send", CB.SEND)
    .text("📥 Claim", CB.CLAIM)
    .row()
    .text("📊 History", CB.HISTORY)
    .text("💰 Balance", CB.BALANCE)
    .row()
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

export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔑 Export Private Key", CB.SET_EXPORT)
    .row()
    .text("🆕 New Wallet", CB.SET_NEWWALLET)
    .row()
    .text("⬅️ Back", CB.SET_BACK);
}

export function backToHomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("⬅️ Home", CB.HOME);
}

export function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("❌ Cancel", CB.SEND_CANCEL);
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
