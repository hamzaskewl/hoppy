import { NextResponse } from "next/server";
import { escrowAddressFor } from "@/lib/umbra";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessWallet = url.searchParams.get("businessWallet");
  if (!businessWallet) {
    return NextResponse.json(
      { error: "businessWallet query param required" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({
      businessWallet,
      escrowAddress: escrowAddressFor(businessWallet),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "escrow derivation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
