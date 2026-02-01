/**
 * TEST ONLY - Simulate the full gift card flow
 * 
 * This creates a fake order and immediately generates a claim link
 * so you can test the claim page without waiting for Starpay.
 * 
 * DELETE THIS FILE BEFORE PRODUCTION!
 */

import { NextRequest, NextResponse } from "next/server";
import { createOrder, updateOrder, GiftCardOrder } from "@/lib/card/storage";
import { 
  generateEncryptionKey, 
  encryptCardDetails, 
  createClaimLink 
} from "@/lib/card/encryption";

export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const amount = body.amount || 50;
    const cardType = body.cardType || "visa";

    // Generate order ID
    const orderId = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    // Create order
    const order: GiftCardOrder = {
      orderId,
      status: "pending",
      amount,
      cardType,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      starpayOrderId: `fake-starpay-${orderId}`,
      paymentAddress: "FakePaymentAddress123",
      paymentAmountSol: amount / 200, // Fake SOL price
    };

    await createOrder(order);

    // Simulate card delivery - create fake card details
    const fakeCard = {
      number: "4111111111111111",
      expiry: "12/28",
      cvv: "123",
      value: amount,
      cardType,
    };

    // Encrypt the card
    const encryptionKey = generateEncryptionKey();
    const encryptedCard = encryptCardDetails(fakeCard, encryptionKey);
    const claimLink = createClaimLink(orderId, encryptionKey);

    // Update order to ready
    await updateOrder(orderId, {
      status: "ready",
      encryptedCard,
      claimLink,
    });

    console.log(`[TestFlow] Created test order: ${orderId}`);
    console.log(`[TestFlow] Claim link: ${claimLink}`);

    return NextResponse.json({
      success: true,
      orderId,
      claimLink,
      message: "Test order created. Use the claim link to test the claim page.",
      fakeCardLastFour: fakeCard.number.slice(-4),
    });
  } catch (error) {
    console.error("[TestFlow] Error:", error);
    return NextResponse.json(
      { error: "Failed to create test order" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    usage: "POST with { amount: 50, cardType: 'visa' } to create a test order",
    warning: "TEST ONLY - Delete before production!",
  });
}
