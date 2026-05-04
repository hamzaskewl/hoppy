import { NextResponse } from "next/server";
import { umbraPayrollClaim, umbraPayrollRecall } from "@/lib/umbra";
import type { UmbraNote } from "@/lib/payroll/types";

// Claim runs claim + withdraw + unwrap + transfer; potentially 2 ZK proofs.
export const maxDuration = 300;
export const runtime = "nodejs";

interface ClaimRequest {
  note?: UmbraNote;
  recipientAddress?: string;
  /** When true, this is a recall — recipientAddress is treated as the business wallet. */
  recall?: boolean;
}

export async function POST(req: Request) {
  let body: ClaimRequest;
  try {
    body = (await req.json()) as ClaimRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { note, recipientAddress, recall } = body;
  if (!note || !recipientAddress) {
    return NextResponse.json(
      { error: "note and recipientAddress required" },
      { status: 400 },
    );
  }

  try {
    const result = recall
      ? await umbraPayrollRecall(note, recipientAddress)
      : await umbraPayrollClaim({ note, recipientAddress });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "claim failed";
    console.error("[umbra/payroll/claim]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
