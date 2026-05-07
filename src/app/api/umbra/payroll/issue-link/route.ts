import { NextResponse } from "next/server";
import { inspect } from "util";
import { umbraPayrollIssueLink } from "@/lib/umbra";
import {
  serializeUmbraNote,
  WSOL_MINT,
  type UmbraNote as RegularUmbraNote,
} from "@/lib/privacy";

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

    // Re-encode the payroll note into the regular UmbraNote URL format so
    // recipients land on /claim and use the standard claim flow (same UI,
    // wallet-connect, paste-address, quick vs private claim modes, etc).
    const regularNote: RegularUmbraNote = {
      ephemeralSeed: note.secret,
      amount: note.amount,
      network: note.network === "mainnet-beta" ? "mainnet" : "devnet",
      token: "SOL",
      tokenMint: WSOL_MINT,
      createdAt: Date.now(),
      ephemeralAddress: note.stealthAddress,
      senderPrivacy: "private",
      // Legacy compat
      status: "funded",
      fundsLocation: "pool",
      senderAddress: from ?? "",
      secret: note.secret,
    };
    const encoded = serializeUmbraNote(regularNote);
    const claimUrl = `${linkOrigin.replace(/\/$/, "")}/claim#${encoded}`;

    return NextResponse.json({
      note,
      issueTxHash,
      claimUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "issue-link failed";
    console.error("[umbra/payroll/issue-link]", inspect(err, { depth: null, colors: false }));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
