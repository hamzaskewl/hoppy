/**
 * Create a gift card order via Bitrefill.
 *
 * 1. Look up the product details (range, prepayment requirements)
 * 2. (If product needs prepayment, e.g. prepaid Visa) submit prepayment forms
 * 3. Create a Bitrefill invoice with payment_method=solana
 * 4. Persist the order locally
 * 5. Return SOL payment details
 */

import { NextRequest, NextResponse } from "next/server";
import { createOrder, GiftCardOrder } from "@/lib/card/storage";
import {
  createInvoice,
  getProductDetails,
  submitPrepaymentStep,
  BitrefillError,
  BitrefillPaymentMethod,
  BitrefillProductDetails,
} from "@/lib/card/bitrefill";

const DEFAULT_PAYMENT_METHOD: BitrefillPaymentMethod = "solana";

// Curated mapping for legacy visa/mastercard tile clicks (kept for backwards
// compatibility with anything still hitting this route with cardType).
const LEGACY_TYPE_MAP: Record<string, { slug: string; name: string }> = {
  visa: { slug: "virtual-prepaid-visa-usa", name: "Digital Prepaid Visa USA" },
  mastercard: { slug: "virtual-prepaid-mastercard-usa", name: "Virtual Prepaid Mastercard USA" },
};

function generateOrderId(): string {
  return `gc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function webhookUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/api/card/bitrefill-webhook`;
}

interface RequestBody {
  amount?: number;
  productSlug?: string;
  productName?: string;
  /** Legacy: visa | mastercard tile. */
  cardType?: string;
  /** Form data for products with a prepayment chain (e.g. Visa cardholder name). */
  prepaymentFormData?: Record<string, string>;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { amount, cardType, productSlug, productName, prepaymentFormData } = body;

    if (!amount || amount < 1 || amount > 10000) {
      return NextResponse.json({ error: "Amount must be between $1 and $10,000" }, { status: 400 });
    }

    // Resolve product slug: explicit wins; legacy cardType is a fallback.
    let slug = productSlug;
    let name = productName;
    if (!slug && cardType && LEGACY_TYPE_MAP[cardType]) {
      slug = LEGACY_TYPE_MAP[cardType].slug;
      name = LEGACY_TYPE_MAP[cardType].name;
    }
    if (!slug) {
      return NextResponse.json({ error: "productSlug required" }, { status: 400 });
    }

    if (!process.env.BITREFILL_API_KEY) {
      console.error("[GiftOrder] BITREFILL_API_KEY not configured");
      return NextResponse.json({ error: "Card service not configured" }, { status: 500 });
    }

    // Pull product details so we know:
    //  - whether prepayment is required
    //  - the valid value range (helps return a clear error if amount is bad)
    let product: BitrefillProductDetails;
    try {
      product = await getProductDetails(slug, "SOL");
    } catch (e) {
      console.error("[GiftOrder] getProductDetails failed:", e);
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (product.range) {
      const { min, max } = product.range;
      if (amount < min || amount > max) {
        return NextResponse.json(
          { error: `Amount must be between ${product.range.currency} ${min} and ${max}` },
          { status: 400 }
        );
      }
    }

    if (!name) name = product.name || slug;

    const orderId = generateOrderId();

    // Drive the prepayment chain when the product requires one. Each step
    // either advances to the next form or returns step="final" with the
    // bill_payment_id we need for createInvoice.
    let billPaymentId: string | undefined;
    if (product.prepayment) {
      const formData: Record<string, string> = {
        bill_amount: String(amount),
        amount: String(amount),
        ...(prepaymentFormData ?? {}),
      };

      try {
        let stepNumber = 1;
        const maxSteps = 6;
        while (stepNumber <= maxSteps) {
          const step = await submitPrepaymentStep({
            productId: slug,
            stepNumber,
            formData,
            billPaymentId,
          });
          billPaymentId = step.bill_payment_id;
          if (step.step === "final") break;

          // Server is asking for more fields — bail out and tell the client
          // exactly what to collect, so the user can fill them in.
          if (step.next_form?.length) {
            const missing = step.next_form
              .filter((f) => f.required && !(f.id in formData))
              .map((f) => ({ id: f.id, label: f.label, type: f.type }));
            if (missing.length) {
              return NextResponse.json(
                {
                  error: "Additional info needed",
                  needsForm: { step: stepNumber + 1, fields: missing },
                },
                { status: 422 }
              );
            }
          }
          stepNumber += 1;
        }
      } catch (e) {
        if (e instanceof BitrefillError) {
          console.error("[GiftOrder] prepayment failed:", e.status, e.body);
          return NextResponse.json(
            { error: "Card provider rejected prepayment", details: e.body },
            { status: e.status >= 500 ? 502 : 400 }
          );
        }
        throw e;
      }
    }

    let invoice;
    try {
      invoice = await createInvoice({
        productId: slug,
        value: String(amount),
        paymentMethod: DEFAULT_PAYMENT_METHOD,
        billPaymentId,
        webhookUrl: webhookUrl(),
      });
    } catch (e) {
      if (e instanceof BitrefillError) {
        console.error("[GiftOrder] Bitrefill error:", e.status, e.body);
        return NextResponse.json(
          { error: "Failed to create order with card provider", details: e.body },
          { status: e.status >= 500 ? 502 : 400 }
        );
      }
      throw e;
    }

    const paymentAddress = invoice.payment?.address;
    const paymentCurrency = invoice.payment?.currency || "SOL";

    // Bitrefill returns `payment.price` as an integer in the currency's
    // smallest unit (lamports for SOL, satoshis for BTC, etc.). Some legacy
    // responses use a string `amount` field with the human value — handle both.
    let paymentAmount: number | undefined;
    if (typeof invoice.payment?.price === "number") {
      const divisor = paymentCurrency === "SOL" ? 1e9 : paymentCurrency.startsWith("USDC") || paymentCurrency.startsWith("USDT") ? 1e6 : 1e8;
      paymentAmount = invoice.payment.price / divisor;
    } else if (invoice.payment?.amount) {
      paymentAmount = parseFloat(invoice.payment.amount);
    }

    if (!paymentAddress || paymentAmount == null) {
      console.error("[GiftOrder] Invoice missing payment details:", invoice);
      return NextResponse.json({ error: "Card provider returned no payment details" }, { status: 502 });
    }

    const expiresAt = invoice.payment?.expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const order: GiftCardOrder = {
      orderId,
      status: "pending",
      amount,
      productSlug: slug,
      productName: name,
      createdAt: new Date().toISOString(),
      expiresAt,
      bitrefillInvoiceId: invoice.id,
      bitrefillOrderId: invoice.orders?.[0]?.id,
      paymentAddress,
      paymentAmount,
      paymentCurrency,
    };

    await createOrder(order);

    return NextResponse.json({
      success: true,
      orderId,
      productSlug: slug,
      productName: name,
      payment: {
        address: paymentAddress,
        amount: paymentAmount,
        currency: paymentCurrency,
        amountSol: paymentCurrency === "SOL" ? paymentAmount : undefined,
      },
      pricing: {
        cardValue: amount,
        total: paymentAmount,
      },
      expiresAt,
    });
  } catch (error) {
    console.error("[GiftOrder] Error:", error);
    return NextResponse.json({ error: "Failed to create gift card order" }, { status: 500 });
  }
}
