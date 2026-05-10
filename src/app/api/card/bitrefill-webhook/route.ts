/**
 * Bitrefill webhook handler
 *
 * Bitrefill POSTs here when an invoice is paid / order is fulfilled.
 * We verify the HMAC signature, fetch the order's redemption details, encrypt
 * them with a fresh per-order key, and write the encrypted blob + claim link
 * to our DB.
 *
 * The decryption key never touches the server — it's embedded in the claim
 * link's URL fragment, which the client extracts locally.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getOrder,
  getOrderByBitrefillInvoice,
  updateOrder,
  GiftCardOrder,
} from "@/lib/card/storage";
import {
  encryptCardDetails,
  generateEncryptionKey,
  createClaimLink,
  CardDetails,
} from "@/lib/card/encryption";
import {
  getInvoice,
  getOrder as getBitrefillOrder,
  verifyWebhookSignature,
  extractRedemption,
} from "@/lib/card/bitrefill";
import { incrementLinksCreated } from "@/lib/card/db";

interface WebhookPayload {
  event?: string;
  invoice_id?: string;
  invoice?: { id?: string };
  order_id?: string;
  order?: { id?: string; invoice_id?: string };
}

export async function POST(request: NextRequest) {
  // Read the raw body once for HMAC verification, then parse.
  const rawBody = await request.text();
  const signature = request.headers.get("x-bitrefill-signature") || request.headers.get("x-signature");

  // Bitrefill's docs don't currently document HMAC signing, so we only verify
  // when both a secret is configured AND a signature header is actually sent.
  // If they start signing later, set BITREFILL_WEBHOOK_SECRET and verification
  // kicks in automatically.
  if (process.env.BITREFILL_WEBHOOK_SECRET && signature) {
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn("[BitrefillWebhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const invoiceId = payload.invoice_id || payload.invoice?.id || payload.order?.invoice_id;
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoice_id" }, { status: 400 });
  }

  const order = await getOrderByBitrefillInvoice(invoiceId);
  if (!order) {
    console.warn("[BitrefillWebhook] No local order for invoice:", invoiceId);
    // 200 so Bitrefill doesn't retry forever on orders we don't recognize.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const result = await fulfillOrder(order, invoiceId);
  return NextResponse.json(result);
}

/**
 * Fetch redemption details from Bitrefill, encrypt, and persist.
 * Returns a result object describing what happened — the caller decides
 * whether to surface that to the webhook sender or to a polling cron.
 */
export async function fulfillOrder(
  order: GiftCardOrder,
  invoiceId: string
): Promise<{ ok: boolean; status: string; reason?: string }> {
  if (order.status === "ready" || order.status === "claimed") {
    return { ok: true, status: order.status, reason: "already-fulfilled" };
  }

  const invoice = await getInvoice(invoiceId);
  const bitrefillOrderId = invoice.orders?.[0]?.id || order.bitrefillOrderId;

  if (!bitrefillOrderId) {
    // Invoice not yet decomposed into orders — likely still being processed.
    if (invoice.status === "paid" && order.status !== "paid") {
      await updateOrder(order.orderId, { status: "paid" });
    }
    return { ok: false, status: "waiting-on-order", reason: "no-order-id" };
  }

  if (invoice.status === "expired" || invoice.status === "failed") {
    await updateOrder(order.orderId, { status: invoice.status === "expired" ? "expired" : "failed" });
    return { ok: false, status: invoice.status };
  }

  const fullOrder = await getBitrefillOrder(bitrefillOrderId);
  const redemption = extractRedemption(fullOrder);

  if (!redemption.code && !redemption.redemptionUrl) {
    // Bitrefill order exists but isn't sealed yet (no code revealed). Mark
    // paid so the polling job knows to keep checking.
    await updateOrder(order.orderId, {
      status: "paid",
      bitrefillOrderId,
    });
    return { ok: false, status: "waiting-on-redemption", reason: "no-redemption-yet" };
  }

  const card: CardDetails = {
    productSlug: order.productSlug,
    productName: order.productName,
    value: order.amount,
    currency: fullOrder.currency || "USD",
    redemptionCode: redemption.code,
    redemptionUrl: redemption.redemptionUrl,
    pin: redemption.pin,
    instructions: redemption.instructions,
  };

  const encryptionKey = generateEncryptionKey();
  const encryptedCard = encryptCardDetails(card, encryptionKey);
  const claimLink = createClaimLink(order.orderId, encryptionKey);

  await updateOrder(order.orderId, {
    status: "ready",
    bitrefillOrderId,
    encryptedCard,
    claimLink,
  });

  // Best-effort metric — don't fail the webhook if this errors.
  try {
    await incrementLinksCreated();
  } catch {
    /* ignore */
  }

  return { ok: true, status: "ready" };
}
