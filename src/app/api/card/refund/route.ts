/**
 * Drain a per-order Umbra card escrow back to the user's wallet.
 *
 * Authorization: only the address recorded as `userAddress` on the order
 * can request a refund. We require the caller to sign a short challenge
 * message proving control of that address — without that, anyone who
 * knows an orderId could redirect funds.
 *
 * Idempotent: if the escrow is already empty, returns noop=true. Safe to
 * call repeatedly.
 *
 * NOTE: this only recovers funds in the Umbra escrow. Funds that already
 * paid Bitrefill must be refunded through Bitrefill support — there's no
 * way to claw them back on-chain.
 */

import { NextRequest, NextResponse } from "next/server";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { getOrder, updateOrder } from "@/lib/card/storage";
import { umbraCardRefund } from "@/lib/card/umbra-pay";

interface RequestBody {
  orderId?: string;
  /** Address requesting the refund — must match the order's userAddress. */
  userAddress?: string;
  /** Base58 ed25519 signature of the challenge message below. */
  signature?: string;
  /** Server-issued challenge string the user signed; included in proof. */
  challenge?: string;
}

function buildChallenge(orderId: string, userAddress: string): string {
  // Stable, no-nonce challenge — re-derivable from order state. We don't
  // need replay protection beyond "tx settled or not" because the refund
  // is naturally idempotent (escrow only holds funds once).
  return `hoppy-card-refund:${orderId}:${userAddress}`;
}

function verifySignature(
  message: string,
  signatureB58: string,
  pubkeyB58: string
): boolean {
  try {
    const msg = new TextEncoder().encode(message);
    const sig = bs58.decode(signatureB58);
    const pk = new PublicKey(pubkeyB58).toBytes();
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { orderId, userAddress, signature, challenge } = body;
  if (!orderId || !userAddress || !signature || !challenge) {
    return NextResponse.json(
      { error: "orderId, userAddress, signature, challenge required" },
      { status: 400 }
    );
  }

  const order = await getOrder(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!order.userAddress) {
    return NextResponse.json(
      { error: "Order has no recorded user address — refund can't be authorized" },
      { status: 403 }
    );
  }
  if (order.userAddress !== userAddress) {
    return NextResponse.json(
      { error: "userAddress doesn't match order owner" },
      { status: 403 }
    );
  }

  // Block obvious wrong-shape challenges before doing crypto.
  const expected = buildChallenge(orderId, userAddress);
  if (challenge !== expected) {
    return NextResponse.json({ error: "Challenge mismatch" }, { status: 400 });
  }

  if (!verifySignature(challenge, signature, userAddress)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  if (order.status === "ready" || order.status === "claimed") {
    return NextResponse.json(
      { error: "Order already fulfilled — funds went to Bitrefill, not the escrow. Contact support for a Bitrefill-side refund." },
      { status: 409 }
    );
  }
  if (order.status === "refunded") {
    return NextResponse.json({ ok: true, status: "refunded", noop: true });
  }

  try {
    const result = await umbraCardRefund(orderId, userAddress);
    if (!result.noop) {
      await updateOrder(orderId, {
        status: "refunded",
        refundTxHash: result.refundTxHash,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error(`[Refund/${orderId}] failed:`, e);
    return NextResponse.json(
      { error: "Refund failed", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/** Quick check what's recoverable. Used by the UI to decide whether to even show a refund button. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

  const order = await getOrder(orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  return NextResponse.json({
    orderId: order.orderId,
    status: order.status,
    userAddress: order.userAddress,
    challenge: order.userAddress ? buildChallenge(order.orderId, order.userAddress) : null,
    canRefund: order.userAddress && order.status !== "ready" && order.status !== "claimed" && order.status !== "refunded",
    refundTxHash: order.refundTxHash,
  });
}
