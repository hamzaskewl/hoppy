/**
 * Health check endpoint for Railway/deployment debugging
 */
import { NextResponse } from "next/server";

export async function GET() {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    env: {
      hasPrivyAppId: !!process.env.NEXT_PUBLIC_PRIVY_APP_ID,
      hasSolanaRpc: !!process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
      network: process.env.NEXT_PUBLIC_SOLANA_NETWORK || "not set",
      nodeVersion: process.version,
    },
  };

  return NextResponse.json(health);
}
