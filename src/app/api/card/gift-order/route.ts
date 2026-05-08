/**
 * Create a private gift card order
 * 
 * 1. Creates order in local storage
 * 2. Creates Starpay order with hoppy's proxy email
 * 3. Returns payment details for Umbra withdrawal
 */

import { NextRequest, NextResponse } from "next/server";
import { createOrder, GiftCardOrder } from "@/lib/card/storage";

const STARPAY_API_URL = "https://www.starpay.cards/api/v1";
const EMAIL_PREFIX = process.env.EMAIL_PREFIX || "cards";
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || "hoppy.app";

function generateOrderId(): string {
  // Generate a short, unique order ID
  return `gc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, cardType } = body;

    // Validate inputs
    if (!amount || amount < 5 || amount > 10000) {
      return NextResponse.json(
        { error: "Amount must be between $5 and $10,000" },
        { status: 400 }
      );
    }

    if (!cardType || !["visa", "mastercard"].includes(cardType)) {
      return NextResponse.json(
        { error: "Card type must be 'visa' or 'mastercard'" },
        { status: 400 }
      );
    }

    // Generate order ID
    const orderId = generateOrderId();
    
    // Create proxy email for this order
    const proxyEmail = `${EMAIL_PREFIX}+${orderId}@${EMAIL_DOMAIN}`;
    
    // Create Starpay order
    const apiToken = process.env.STARPAY_API_TOKEN;
    if (!apiToken) {
      console.error("STARPAY_API_TOKEN not configured");
      return NextResponse.json(
        { error: "Payment service not configured" },
        { status: 500 }
      );
    }

    const starpayResponse = await fetch(`${STARPAY_API_URL}/cards/order`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        amount, 
        cardType, 
        email: proxyEmail 
      }),
    });

    const starpayData = await starpayResponse.json();

    if (!starpayResponse.ok) {
      console.error("[GiftOrder] Starpay error:", starpayData);
      return NextResponse.json(
        { error: starpayData.error || "Failed to create order with card provider" },
        { status: starpayResponse.status }
      );
    }

    // Create local order
    const order: GiftCardOrder = {
      orderId,
      status: "pending",
      amount,
      cardType,
      createdAt: new Date().toISOString(),
      expiresAt: starpayData.expiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      starpayOrderId: starpayData.orderId,
      paymentAddress: starpayData.payment?.address,
      paymentAmountSol: starpayData.payment?.amountSol,
    };

    await createOrder(order);

    // Return order details for client
    return NextResponse.json({
      success: true,
      orderId,
      payment: {
        address: starpayData.payment?.address,
        amountSol: starpayData.payment?.amountSol,
        solPrice: starpayData.payment?.solPrice,
      },
      pricing: starpayData.pricing,
      expiresAt: order.expiresAt,
    });
  } catch (error) {
    console.error("[GiftOrder] Error:", error);
    return NextResponse.json(
      { error: "Failed to create gift card order" },
      { status: 500 }
    );
  }
}
