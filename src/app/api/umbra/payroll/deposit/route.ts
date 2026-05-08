import { NextResponse } from "next/server";
import { inspect } from "util";
import { umbraPayrollDeposit } from "@/lib/umbra";

// ZK + on-chain ops can take minutes.
export const maxDuration = 300;
export const runtime = "nodejs";

interface DepositRequest {
  businessWallet?: string;
  totalAmount?: number;
  signedDepositTxHash?: string;
}

export async function POST(req: Request) {
  let body: DepositRequest;
  try {
    body = (await req.json()) as DepositRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { businessWallet, totalAmount, signedDepositTxHash } = body;
  if (!businessWallet || typeof totalAmount !== "number" || !signedDepositTxHash) {
    return NextResponse.json(
      { error: "businessWallet, totalAmount, signedDepositTxHash required" },
      { status: 400 },
    );
  }

  try {
    const result = await umbraPayrollDeposit({
      businessWallet,
      totalAmount,
      signedDepositTxHash,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "deposit failed";
    console.error(
      "[umbra/payroll/deposit] failure",
      inspect(err, { depth: null, colors: false }),
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
