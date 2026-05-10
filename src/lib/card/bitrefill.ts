/**
 * Bitrefill API client
 *
 * Server-side wrapper around Bitrefill's REST API. Used to create gift-card
 * orders, poll their status, and verify webhook signatures.
 *
 * Docs: https://docs.bitrefill.com/docs/api-overview
 */

import crypto from "crypto";

const BASE_URL = process.env.BITREFILL_API_BASE || "https://api.bitrefill.com/v2";

export type BitrefillPaymentMethod =
  | "bitcoin"
  | "litecoin"
  | "ethereum"
  | "lightning"
  | "usdc_polygon"
  | "usdt_polygon"
  | "usdc_erc20"
  | "usdt_erc20"
  | "usdt_trc20"
  | "solana"
  | "usdc_arbitrum"
  | "usdc_solana"
  | "usdc_base"
  | "eth_base"
  | "balance";

export interface BitrefillCryptoPayment {
  address: string;
  amount: string;
  currency: string;
  payment_uri?: string;
  expires_at?: string;
}

export interface BitrefillInvoice {
  id: string;
  status: "unpaid" | "paid" | "complete" | "expired" | "failed";
  payment_method: BitrefillPaymentMethod;
  payment?: BitrefillCryptoPayment;
  payment_link?: string;
  orders?: BitrefillOrderRef[];
  created_at?: string;
}

export interface BitrefillOrderRef {
  id: string;
  product_id: string;
  package_id: string;
  status: string;
}

export interface BitrefillRedemption {
  code?: string;
  pin?: string;
  redemption_url?: string;
  link?: string;
  instructions?: string;
}

export interface BitrefillOrder {
  id: string;
  invoice_id: string;
  product_id: string;
  product_name?: string;
  package_id: string;
  value: number;
  currency: string;
  status: string;
  redemption?: BitrefillRedemption;
  redemption_code?: string;
  redemption_url?: string;
  redemption_link?: string;
  pin?: string;
  instructions?: string;
}

export interface PrepaymentStepResponse {
  step: number | "final";
  bill_payment_id: string;
  next_form?: { id: string; label: string; type: string; required: boolean }[];
}

export class BitrefillError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`Bitrefill API ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

function authHeader(): string {
  const key = process.env.BITREFILL_API_KEY;
  if (!key) throw new Error("BITREFILL_API_KEY not configured");
  return `Bearer ${key}`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!res.ok) throw new BitrefillError(res.status, body);
  return body as T;
}

export interface CreateInvoiceArgs {
  productId: string;
  packageId: string;
  paymentMethod: BitrefillPaymentMethod;
  billPaymentId?: string;
  webhookUrl?: string;
}

/**
 * Create a Bitrefill invoice (cart with one product). Returns crypto payment
 * details — pay this address to complete the order.
 */
export async function createInvoice(args: CreateInvoiceArgs): Promise<BitrefillInvoice> {
  const item: Record<string, unknown> = {
    product_id: args.productId,
    package_id: args.packageId,
  };
  if (args.billPaymentId) item.bill_payment_id = args.billPaymentId;

  return call<BitrefillInvoice>("/orders", {
    method: "POST",
    body: JSON.stringify({
      products: [item],
      payment_method: args.paymentMethod,
      webhook_url: args.webhookUrl,
    }),
  });
}

export async function getInvoice(invoiceId: string): Promise<BitrefillInvoice> {
  return call<BitrefillInvoice>(`/invoices/${invoiceId}?include_orders=true`);
}

export async function getOrder(orderId: string): Promise<BitrefillOrder> {
  return call<BitrefillOrder>(`/orders/${orderId}?include_redemption_info=true`);
}

/**
 * Submit one step of a multi-step prepayment form (e.g. cardholder name for
 * prepaid Visa). Loop calls until the response has step="final"; the returned
 * bill_payment_id then goes into createInvoice.
 */
export async function submitPrepaymentStep(args: {
  productId: string;
  stepNumber: number;
  formData: Record<string, string>;
  billPaymentId?: string;
}): Promise<PrepaymentStepResponse> {
  return call<PrepaymentStepResponse>(`/products/${args.productId}/prepayment`, {
    method: "POST",
    body: JSON.stringify({
      step_number: args.stepNumber,
      form_data: args.formData,
      bill_payment_id: args.billPaymentId,
    }),
  });
}

/**
 * Verify HMAC-SHA256 signature on a webhook payload. Bitrefill sends the
 * signature in the X-Bitrefill-Signature header; we hash the raw body with
 * BITREFILL_WEBHOOK_SECRET and compare.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.BITREFILL_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Constant-time compare; signatures may be sent prefixed (e.g. "sha256=...")
  const provided = signature.replace(/^sha256=/, "");
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

/**
 * Extract the redemption code + URL from a fetched order, normalizing the few
 * shapes Bitrefill returns (top-level fields vs. nested redemption object).
 */
export function extractRedemption(order: BitrefillOrder): {
  code?: string;
  pin?: string;
  redemptionUrl?: string;
  instructions?: string;
} {
  const r = order.redemption || {};
  return {
    code: order.redemption_code || r.code,
    pin: order.pin || r.pin,
    redemptionUrl: order.redemption_url || order.redemption_link || r.redemption_url || r.link,
    instructions: order.instructions || r.instructions,
  };
}
