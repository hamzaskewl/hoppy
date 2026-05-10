/**
 * Fetch a single Bitrefill product's details (packages, range, prepayment
 * requirements). Used by the detail flow before the user picks an amount.
 */

import { NextRequest, NextResponse } from "next/server";
import { getProductDetails, BitrefillError } from "@/lib/card/bitrefill";

export const revalidate = 60;

export async function GET(request: NextRequest) {
  if (!process.env.BITREFILL_API_KEY) {
    return NextResponse.json({ error: "Card service not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const currency = searchParams.get("currency") || "SOL";

  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  try {
    const details = await getProductDetails(slug, currency);
    return NextResponse.json({
      slug: details.id,
      name: details.name,
      country: details.country_code,
      currency: details.currency,
      categories: details.categories || [],
      packages: details.packages || [],
      range: details.range || null,
      subtitle: details.subtitles || null,
      description: details.descriptions || null,
      instructions: details.instructions || null,
      paymentMethods: details.payment_methods || [],
      prepayment: details.prepayment || null,
      url: details.url || null,
    });
  } catch (e) {
    if (e instanceof BitrefillError) {
      console.error("[ProductDetails] Bitrefill error:", e.status, e.body);
      const body = (e.body as { error_code?: string; message?: string }) || {};
      if (body.error_code === "not_available") {
        return NextResponse.json(
          {
            error: "This brand isn't available on our gift card account yet.",
            code: "not_available",
          },
          { status: 403 }
        );
      }
      const notFound = e.status === 404;
      return NextResponse.json(
        { error: notFound ? "Product not found" : "Failed to load product" },
        { status: notFound ? 404 : 502 }
      );
    }
    console.error("[ProductDetails] Error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
