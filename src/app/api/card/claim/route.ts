/**
 * Get encrypted card details for claim
 * 
 * Returns ENCRYPTED card data - client must have the key to decrypt.
 * Server never sees the decryption key.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrder, updateOrder } from "@/lib/card/storage";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("id");

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID required" },
        { status: 400 }
      );
    }

    const order = getOrder(orderId);

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    if (order.status !== "ready" && order.status !== "claimed") {
      return NextResponse.json(
        { 
          error: "Card not ready yet",
          status: order.status,
        },
        { status: 400 }
      );
    }

    if (!order.encryptedCard) {
      return NextResponse.json(
        { error: "Card data not available" },
        { status: 500 }
      );
    }

    // Mark as claimed
    if (order.status !== "claimed") {
      updateOrder(orderId, { status: "claimed" });
    }

    // Return encrypted card data
    // Client must decrypt with key from URL hash
    return NextResponse.json({
      success: true,
      orderId: order.orderId,
      amount: order.amount,
      cardType: order.cardType,
      encryptedCard: order.encryptedCard,
    });
  } catch (error) {
    console.error("[CardClaim] Error:", error);
    return NextResponse.json(
      { error: "Failed to get card" },
      { status: 500 }
    );
  }
}
