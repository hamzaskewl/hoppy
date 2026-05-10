/**
 * Polling fallback for Bitrefill order fulfillment.
 *
 * Webhooks are best-effort. This endpoint sweeps any orders in "pending" or
 * "paid" state and asks Bitrefill for their current status — promoting them
 * to "ready" when redemption details become available.
 *
 * Wire to a cron (e.g. every 30s) or call manually. Auth via CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrdersByStatus } from "@/lib/card/storage";
import { fulfillOrder } from "../bitrefill-webhook/route";

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const candidates = [
    ...(await getOrdersByStatus("pending")),
    ...(await getOrdersByStatus("paid")),
  ];

  let promoted = 0;
  let checked = 0;
  const errors: string[] = [];

  for (const order of candidates) {
    if (!order.bitrefillInvoiceId) continue;
    checked += 1;
    try {
      const result = await fulfillOrder(order, order.bitrefillInvoiceId);
      if (result.ok && result.status === "ready") promoted += 1;
    } catch (e) {
      errors.push(`${order.orderId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, checked, promoted, errors });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
