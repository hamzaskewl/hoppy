import { NextResponse } from "next/server";
import { umbraPayrollIssueLink, encodeNoteToUrl } from "@/lib/umbra";

// ZK proof + on-chain UTXO creation can take 30–120s.
export const maxDuration = 300;
export const runtime = "nodejs";

interface IssueLinkRequest {
  businessWallet?: string;
  amount?: number;
  from?: string;
  origin?: string;
}

export async function POST(req: Request) {
  let body: IssueLinkRequest;
  try {
    body = (await req.json()) as IssueLinkRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { businessWallet, amount, from, origin } = body;
  if (!businessWallet || typeof amount !== "number") {
    return NextResponse.json(
      { error: "businessWallet and amount required" },
      { status: 400 },
    );
  }

  const linkOrigin = origin ?? new URL(req.url).origin;

  try {
    const { note, issueTxHash } = await umbraPayrollIssueLink({
      businessWallet,
      amount,
      from,
    });
    return NextResponse.json({
      note,
      issueTxHash,
      claimUrl: encodeNoteToUrl(note, linkOrigin),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "issue-link failed";
    console.error("[umbra/payroll/issue-link]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
