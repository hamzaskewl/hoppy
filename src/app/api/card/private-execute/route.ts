/**
 * Kick off the Umbra-mediated payment after the user has sent SOL to the
 * per-order escrow. Returns 202 immediately; the actual mixing chain runs
 * in the background. Client polls /api/card/status for progress.
 *
 * If anything fails mid-orchestration, funds remain in the escrow and the
 * user can recover them via /api/card/refund.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrder, updateOrder } from "@/lib/card/storage";
import { umbraCardExecute } from "@/lib/card/umbra-pay";

interface RequestBody {
  orderId?: string;
  /** Tx signature for the user → escrow deposit transfer. */
  depositTxHash?: string;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { orderId, depositTxHash } = body;
  if (!orderId || !depositTxHash) {
    return NextResponse.json({ error: "orderId and depositTxHash required" }, { status: 400 });
  }

  const order = await getOrder(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!order.userAddress) {
    return NextResponse.json(
      { error: "Order has no userAddress — was it created via the public-flow path?" },
      { status: 400 }
    );
  }
  if (!order.paymentAddress || order.paymentAmount == null || order.paymentCurrency !== "SOL") {
    return NextResponse.json({ error: "Order missing Bitrefill payout details" }, { status: 400 });
  }

  // Idempotency: if execution already started or finished, just acknowledge.
  if (
    order.status === "depositing" ||
    order.status === "mixing" ||
    order.status === "withdrawing" ||
    order.status === "paying" ||
    order.status === "paid" ||
    order.status === "ready" ||
    order.status === "claimed"
  ) {
    return NextResponse.json({ ok: true, status: order.status, alreadyRunning: true });
  }

  const bitrefillLamports = Math.round(order.paymentAmount * 1e9);
  // The escrow holds whatever the user sent — we'll re-confirm the exact
  // delivered amount inside umbraCardExecute via on-chain tx inspection.
  const escrowLamports = bitrefillLamports;

  // Fire-and-forget. The orchestration is long-running (3-5 min for ZK proofs)
  // so we don't block the HTTP request. The order's status field tracks
  // progress for the polling client.
  void (async () => {
    try {
      await umbraCardExecute({
        orderId: order.orderId,
        escrowLamports,
        bitrefillLamports,
        bitrefillAddress: order.paymentAddress!,
        userAddress: order.userAddress!,
        depositTxHash,
      });
    } catch (err) {
      console.error(`[private-execute/${order.orderId}] orchestration failed:`, err);
      await updateOrder(order.orderId, { status: "failed" }).catch(() => {});
    }
  })();

  return NextResponse.json({ ok: true, status: "depositing" }, { status: 202 });
}
