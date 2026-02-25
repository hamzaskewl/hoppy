export type SendFlowStep =
  | "awaiting_privacy"
  | "awaiting_recipient"
  | "awaiting_amount"
  | "awaiting_confirm";

export interface SendFlowState {
  step: SendFlowStep;
  privacy?: "basic" | "private";
  recipient?: string;
  amount?: number;
  messageId?: number;
  startedAt: number;
}

export interface PendingConfirmation {
  text: string;
  expiresAt: number;
}

const FLOW_TIMEOUT_MS = 5 * 60_000; // 5 minutes

const sendFlows = new Map<number, SendFlowState>();
const pendingConfirmations = new Map<number, PendingConfirmation>();

export function getSendFlow(tgUserId: number): SendFlowState | null {
  const flow = sendFlows.get(tgUserId);
  if (!flow) return null;
  if (Date.now() - flow.startedAt > FLOW_TIMEOUT_MS) {
    sendFlows.delete(tgUserId);
    return null;
  }
  return flow;
}

export function setSendFlow(tgUserId: number, state: SendFlowState): void {
  sendFlows.set(tgUserId, state);
}

export function clearSendFlow(tgUserId: number): void {
  sendFlows.delete(tgUserId);
}

export function getPendingConfirmation(
  tgUserId: number
): PendingConfirmation | null {
  const pending = pendingConfirmations.get(tgUserId);
  if (!pending || Date.now() >= pending.expiresAt) {
    pendingConfirmations.delete(tgUserId);
    return null;
  }
  return pending;
}

export function setPendingConfirmation(
  tgUserId: number,
  confirmation: PendingConfirmation
): void {
  pendingConfirmations.set(tgUserId, confirmation);
}

export function clearPendingConfirmation(tgUserId: number): void {
  pendingConfirmations.delete(tgUserId);
}

// Periodic cleanup of expired entries
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [id, flow] of sendFlows) {
      if (now - flow.startedAt > FLOW_TIMEOUT_MS) sendFlows.delete(id);
    }
    for (const [id, conf] of pendingConfirmations) {
      if (now >= conf.expiresAt) pendingConfirmations.delete(id);
    }
  }, 60_000);
}
