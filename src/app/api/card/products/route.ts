/**
 * Search/list Bitrefill products.
 *
 * Proxies through to Bitrefill's product search so the client never needs the
 * API key. Used by the catalog UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { searchProducts, BitrefillError } from "@/lib/card/bitrefill";

export const revalidate = 60; // light cache; product catalog is fairly stable

export async function GET(request: NextRequest) {
  if (!process.env.BITREFILL_API_KEY) {
    return NextResponse.json({ error: "Card service not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "*";
  const country = searchParams.get("country") || "US";
  const category = searchParams.get("category") || undefined;
  const productType = (searchParams.get("type") as "giftcard" | "esim" | null) || undefined;
  const page = Number(searchParams.get("page") || "1");
  const perPage = Math.min(Number(searchParams.get("per_page") || "30"), 100);

  try {
    const result = await searchProducts({
      query: q,
      country,
      category,
      productType: productType || undefined,
      inStock: true,
      page: Number.isFinite(page) ? page : 1,
      perPage,
    });

    // Trim the payload to fields the UI actually uses.
    const products = (result.products || []).map((p) => ({
      slug: p.slug,
      name: p.name,
      type: p.type,
      categories: p.categories || [],
      countries: p.countries || [],
      currency: p.currency,
      keywords: p.keywords || [],
    }));

    return NextResponse.json({
      products,
      page: result.page ?? page,
      perPage: result.per_page ?? perPage,
      found: result.found ?? products.length,
    });
  } catch (e) {
    if (e instanceof BitrefillError) {
      console.error("[Products] Bitrefill error:", e.status, e.body);
      return NextResponse.json({ error: "Failed to search products" }, { status: 502 });
    }
    console.error("[Products] Error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
