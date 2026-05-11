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
  /** Amount in smallest unit for the currency (lamports for SOL, sats for BTC). */
  price?: number;
  /** Some endpoints/legacy responses include a string-encoded human amount. */
  amount?: string;
  currency: string;
  method?: string;
  status?: string;
  payment_uri?: string;
  expires_at?: string;
  commission?: number;
}

export interface BitrefillInvoice {
  id: string;
  status: string; // unpaid | paid | complete | expired | failed | not_delivered | delivered | ...
  payment_method?: BitrefillPaymentMethod;
  payment?: BitrefillCryptoPayment;
  payment_link?: string;
  orders?: BitrefillOrderRef[];
  created_at?: string;
  created_time?: string;
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
  // Bitrefill v2 nests redemption under `redemption_info` (snake_case).
  // We keep the older `redemption` field for back-compat in case the API
  // ever returns either shape.
  redemption?: BitrefillRedemption;
  redemption_info?: BitrefillRedemption & { other?: string };
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

  // Bitrefill v2 wraps successful responses in `{ meta, data }`. Unwrap when
  // present so callers can ignore the envelope.
  if (
    body &&
    typeof body === "object" &&
    "data" in (body as Record<string, unknown>) &&
    "meta" in (body as Record<string, unknown>)
  ) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export interface CreateInvoiceArgs {
  productId: string;
  /** Denomination, e.g. "20" for a $20 card. Sent as `value` per Bitrefill spec. */
  value: string | number;
  paymentMethod: BitrefillPaymentMethod;
  billPaymentId?: string;
  webhookUrl?: string;
  autoPay?: boolean;
}

/**
 * Create a Bitrefill invoice (cart with one product). Returns crypto payment
 * details — pay this address to complete the order. Endpoint: POST /v2/invoices
 */
export async function createInvoice(args: CreateInvoiceArgs): Promise<BitrefillInvoice> {
  const item: Record<string, unknown> = {
    product_id: args.productId,
    value: String(args.value),
  };
  if (args.billPaymentId) item.bill_payment_id = args.billPaymentId;

  const body: Record<string, unknown> = {
    products: [item],
    payment_method: args.paymentMethod,
    auto_pay: args.autoPay ?? false,
  };
  if (args.webhookUrl) body.webhook_url = args.webhookUrl;

  return call<BitrefillInvoice>("/invoices", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getInvoice(invoiceId: string): Promise<BitrefillInvoice> {
  return call<BitrefillInvoice>(`/invoices/${invoiceId}?include_orders=true`);
}

export async function getOrder(orderId: string): Promise<BitrefillOrder> {
  return call<BitrefillOrder>(`/orders/${orderId}?include_redemption_info=true`);
}

export interface BitrefillProductSummary {
  id?: string;
  _id?: string;
  slug: string;
  name: string;
  type?: string;
  categories?: string[];
  countries?: string[];
  currency?: string;
  in_stock?: boolean;
  keywords?: string[];
  product_url?: string;
  image?: string;
}

export interface BitrefillProductSearchResponse {
  products: BitrefillProductSummary[];
  found?: number;
  page?: number;
  per_page?: number;
  categories?: { count: number; value: string; highlighted?: boolean }[];
}

export interface BitrefillProductPackage {
  package_id: string;
  package_value: string;
  package_currency: string;
  payment_price: string;
  payment_currency: string;
}

export interface BitrefillProductRange {
  min: number;
  max: number;
  step: number;
  currency: string;
  note?: string;
}

export interface BitrefillPrepaymentField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  max_length?: number | null;
}

export interface BitrefillProductDetails {
  id: string;
  name: string;
  country_code?: string;
  currency?: string;
  categories?: string[];
  recipient_type?: string;
  in_stock?: boolean;
  packages?: BitrefillProductPackage[];
  range?: BitrefillProductRange;
  url?: string;
  subtitles?: string;
  descriptions?: string;
  instructions?: string;
  payment_methods?: string[];
  prepayment?: {
    first_form: BitrefillPrepaymentField[];
    instructions?: string;
  };
}

export interface SearchProductsArgs {
  query?: string;
  country?: string;
  category?: string;
  productType?: "giftcard" | "esim";
  inStock?: boolean;
  page?: number;
  perPage?: number;
}

/** Search Bitrefill's product catalog. */
export async function searchProducts(args: SearchProductsArgs = {}): Promise<BitrefillProductSearchResponse> {
  const params = new URLSearchParams();
  params.set("q", args.query ?? "*");
  params.set("country", args.country ?? "US");
  if (args.category) params.set("category", args.category);
  if (args.productType) params.set("type", args.productType);
  if (args.inStock !== undefined) params.set("in_stock", String(args.inStock));
  if (args.page) params.set("page", String(args.page));
  if (args.perPage) params.set("per_page", String(args.perPage));
  return call<BitrefillProductSearchResponse>(`/products?${params.toString()}`);
}

/** Fetch the full details (packages, range, prepayment) for a single product slug. */
export async function getProductDetails(
  slug: string,
  currency: string = "SOL"
): Promise<BitrefillProductDetails> {
  const params = new URLSearchParams({ currency });
  return call<BitrefillProductDetails>(`/products/${encodeURIComponent(slug)}?${params.toString()}`);
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
 * Extract the redemption code + URL from a fetched order, normalizing the
 * shapes Bitrefill returns. v2 nests fields under `redemption_info`; legacy
 * responses used `redemption` or top-level fields. PIN-only products (e.g.
 * Uber Eats) have only a `pin` — no `code` or `redemption_url`. Callers
 * should treat a populated `pin` as a valid sealed redemption.
 */
export function extractRedemption(order: BitrefillOrder): {
  code?: string;
  pin?: string;
  redemptionUrl?: string;
  instructions?: string;
} {
  const info = order.redemption_info || order.redemption || {};
  return {
    code: order.redemption_code || info.code,
    pin: order.pin || info.pin,
    redemptionUrl:
      order.redemption_url ||
      order.redemption_link ||
      info.redemption_url ||
      info.link,
    instructions: order.instructions || info.instructions,
  };
}
