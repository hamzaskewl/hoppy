/**
 * Fetch SOL/USD price.
 * Prefer Helius DAS getAsset (Wrapped SOL) when API key available; fallback to CoinGecko.
 * @see https://www.helius.dev/docs/das/get-nfts#price-data-for-tokens
 */

import { NextResponse } from "next/server";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

function getHeliusApiKey(): string | null {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "";
  const match = url.match(/[?&]api-key=([^&]+)/i) || url.match(/[?&]api_key=([^&]+)/i);
  if (match) return match[1];
  return process.env.HELIUS_API_KEY || process.env.NEXT_PUBLIC_HELIUS_API_KEY || null;
}

async function fetchHeliusPrice(apiKey: string): Promise<number | null> {
  const rpc = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getAsset",
      params: {
        id: WSOL_MINT,
        displayOptions: { showFungibleTokens: true },
      },
    }),
    cache: "no-store",
  });
  const data = (await res.json()) as {
    result?: { token_info?: { price_info?: { price_per_token?: number; currency?: string } } };
  };
  const price = data?.result?.token_info?.price_info?.price_per_token;
  if (typeof price !== "number" || price <= 0) return null;
  return price;
}

async function fetchCoinGeckoPrice(): Promise<number | null> {
  const res = await fetch(COINGECKO_URL, { cache: "no-store" });
  const data = (await res.json()) as { solana?: { usd?: number } };
  const usd = data?.solana?.usd;
  if (typeof usd !== "number" || usd <= 0) return null;
  return usd;
}

export async function GET() {
  try {
    const key = getHeliusApiKey();
    let usd: number | null = null;
    if (key) {
      usd = await fetchHeliusPrice(key);
    }
    if (usd == null) {
      usd = await fetchCoinGeckoPrice();
    }
    if (typeof usd !== "number" || usd <= 0) {
      return NextResponse.json({ error: "Invalid price" }, { status: 502 });
    }
    return NextResponse.json({ usd });
  } catch (e) {
    return NextResponse.json({ error: "Price fetch failed" }, { status: 502 });
  }
}
