/**
 * Create a gift card order via Bitrefill.
 *
 * 1. (If product needs prepayment, e.g. prepaid Visa) submit prepayment forms
 * 2. Create a Bitrefill invoice with payment_method=solana
 * 3. Persist the order locally
 * 4. Return SOL payment details so the client can drive the Umbra deposit/withdraw
 */

import { NextRequest, NextResponse } from "next/server";
import { createOrder, GiftCardOrder } from "@/lib/card/storage";
import {
  createInvoice,
  submitPrepaymentStep,
  BitrefillError,
  BitrefillPaymentMethod,
} from "@/lib/card/bitrefill";

const DEFAULT_PAYMENT_METHOD: BitrefillPaymentMethod = "solana";

// Curated mapping for the simple visa/mastercard tiles used by the existing UI.
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      amount,
      cardType,
      productSlug,
      productName,
      cardholderFirstName,
      cardholderLastName,
    } = body as {
      amount?: number;
      cardType?: string;
      productSlug?: string;
      productName?: string;
      cardholderFirstName?: string;
      cardholderLastName?: string;
    };

    if (!amount || amount < 5 || amount > 10000) {
      return NextResponse.json({ error: "Amount must be between $5 and $10,000" }, { status: 400 });
    }

    // Resolve product: explicit slug wins; else fall back to legacy visa/mastercard buttons.
    let slug = productSlug;
    let name = productName;
    if (!slug && cardType && LEGACY_TYPE_MAP[cardType]) {
      slug = LEGACY_TYPE_MAP[cardType].slug;
      name = LEGACY_TYPE_MAP[cardType].name;
    }
    if (!slug) {
      return NextResponse.json({ error: "Product slug or cardType required" }, { status: 400 });
    }

    if (!process.env.BITREFILL_API_KEY) {
      console.error("[GiftOrder] BITREFILL_API_KEY not configured");
      return NextResponse.json({ error: "Card service not configured" }, { status: 500 });
    }

    const orderId = generateOrderId();

    // Some products (notably prepaid Visa/MC) require a prepayment form chain
    // before the invoice can be created. We attempt step 1 with the data we
    // have; if the server responds with another form, we advance until final.
    let billPaymentId: string | undefined;
    let stepNumber = 1;
    const maxSteps = 5;
    const formData: Record<string, string> = {
      bill_amount: String(amount),
      amount: String(amount),
    };
    if (cardholderFirstName) formData.first_name = cardholderFirstName;
    if (cardholderLastName) formData.last_name = cardholderLastName;

    try {
      while (stepNumber <= maxSteps) {
        const step = await submitPrepaymentStep({
          productId: slug,
          stepNumber,
          formData,
          billPaymentId,
        });
        billPaymentId = step.bill_payment_id;
        if (step.step === "final") break;
        stepNumber += 1;
      }
    } catch (e) {
      // Products without a prepayment block return 404/400; that's fine — skip.
      if (!(e instanceof BitrefillError) || e.status >= 500) {
        console.warn("[GiftOrder] prepayment step skipped:", e);
      }
      billPaymentId = undefined;
    }

    // Bitrefill expects package_id as the value (e.g. "50"), not the full slug<&>50 form.
    const packageId = String(amount);

    let invoice;
    try {
      invoice = await createInvoice({
        productId: slug,
        packageId,
        paymentMethod: DEFAULT_PAYMENT_METHOD,
        billPaymentId,
        webhookUrl: webhookUrl(),
      });
    } catch (e) {
      if (e instanceof BitrefillError) {
        console.error("[GiftOrder] Bitrefill error:", e.status, e.body);
        return NextResponse.json(
          { error: "Failed to create order with card provider", details: e.body },
          { status: e.status }
        );
      }
      throw e;
    }

    const paymentAddress = invoice.payment?.address;
    const paymentAmountStr = invoice.payment?.amount;
    const paymentCurrency = invoice.payment?.currency || "SOL";
    const paymentAmount = paymentAmountStr ? parseFloat(paymentAmountStr) : undefined;

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
      productName: name || slug,
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
      productName: order.productName,
      payment: {
        address: paymentAddress,
        amount: paymentAmount,
        currency: paymentCurrency,
        // Backwards-compat field names the existing UI uses
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
