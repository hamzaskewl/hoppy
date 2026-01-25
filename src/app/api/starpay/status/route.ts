import { NextRequest, NextResponse } from "next/server";

const STARPAY_API_URL = "https://www.starpay.cards/api/v1";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 }
      );
    }

    const apiToken = process.env.STARPAY_API_TOKEN;
    if (!apiToken) {
      console.error("STARPAY_API_TOKEN not configured");
      return NextResponse.json(
        { error: "Payment service not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `${STARPAY_API_URL}/cards/order/status?orderId=${orderId}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to check status" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Starpay status error:", error);
    return NextResponse.json(
      { error: "Failed to check order status" },
      { status: 500 }
    );
  }
}
