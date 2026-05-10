/**
 * Get encrypted card details for claim.
 *
 * Returns ciphertext only — the client must have the AES key from the URL
 * fragment to decrypt. Server never sees the key.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrder, updateOrder } from "@/lib/card/storage";
import { incrementLinksClaimed } from "@/lib/card/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("id");

    if (!orderId) {
      return NextResponse.json({ error: "Order ID required" }, { status: 400 });
    }

    const order = await getOrder(orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.status !== "ready" && order.status !== "claimed") {
      return NextResponse.json(
        { error: "Card not ready yet", status: order.status },
        { status: 400 }
      );
    }

    if (!order.encryptedCard) {
      return NextResponse.json({ error: "Card data not available" }, { status: 500 });
    }

    if (order.status !== "claimed") {
      await updateOrder(orderId, { status: "claimed" });
      try {
        await incrementLinksClaimed();
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json({
      success: true,
      orderId: order.orderId,
      amount: order.amount,
      productSlug: order.productSlug,
      productName: order.productName,
      encryptedCard: order.encryptedCard,
    });
  } catch (error) {
    console.error("[CardClaim] Error:", error);
    return NextResponse.json({ error: "Failed to get card" }, { status: 500 });
  }
}
