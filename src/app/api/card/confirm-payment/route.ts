/**
 * Confirm payment for gift card order
 * 
 * Called after client has:
 * 1. Deposited to Privacy Cash pool
 * 2. Withdrawn to Starpay payment address
 * 
 * This marks the order as "paid" so we start watching for the email.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrder, updateOrder } from "@/lib/card/storage";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, depositTxHash, withdrawTxHash } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID required" },
        { status: 400 }
      );
    }

    const order = await getOrder(orderId);

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    if (order.status !== "pending") {
      return NextResponse.json(
        { error: "Order already processed", status: order.status },
        { status: 400 }
      );
    }

    // Update order with payment info
    const updated = await updateOrder(orderId, {
      status: "paid",
      depositTxHash,
      withdrawTxHash,
    });

    console.log(`[ConfirmPayment] Order ${orderId} marked as paid`);
    console.log(`[ConfirmPayment] Deposit: ${depositTxHash}`);
    console.log(`[ConfirmPayment] Withdraw: ${withdrawTxHash}`);

    return NextResponse.json({
      success: true,
      orderId: updated?.orderId,
      status: updated?.status,
      message: "Payment confirmed. Card will be ready when Starpay processes the order.",
    });
  } catch (error) {
    console.error("[ConfirmPayment] Error:", error);
    return NextResponse.json(
      { error: "Failed to confirm payment" },
      { status: 500 }
    );
  }
}
