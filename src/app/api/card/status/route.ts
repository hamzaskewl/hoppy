/**
 * Get gift card order status (used by the buyer's UI to poll for fulfillment).
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrder } from "@/lib/card/storage";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json({ error: "Order ID required" }, { status: 400 });
    }

    const order = await getOrder(orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({
      orderId: order.orderId,
      status: order.status,
      amount: order.amount,
      productSlug: order.productSlug,
      productName: order.productName,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      claimLink: order.status === "ready" ? order.claimLink : undefined,
    });
  } catch (error) {
    console.error("[CardStatus] Error:", error);
    return NextResponse.json({ error: "Failed to get order status" }, { status: 500 });
  }
}
