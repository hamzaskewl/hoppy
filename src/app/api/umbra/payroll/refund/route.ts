import { NextResponse } from "next/server";
import { umbraPayrollRefund } from "@/lib/umbra";

export const maxDuration = 300;
export const runtime = "nodejs";

interface RefundRequest {
  businessWallet?: string;
}

export async function POST(req: Request) {
  let body: RefundRequest;
  try {
    body = (await req.json()) as RefundRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { businessWallet } = body;
  if (!businessWallet) {
    return NextResponse.json({ error: "businessWallet required" }, { status: 400 });
  }

  try {
    const result = await umbraPayrollRefund({ businessWallet });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "refund failed";
    console.error("[umbra/payroll/refund]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
