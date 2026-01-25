import { NextRequest, NextResponse } from "next/server";

const STARPAY_API_URL = "https://www.starpay.cards/api/v1";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const amount = searchParams.get("amount");

    if (!amount) {
      return NextResponse.json(
        { error: "Amount is required" },
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
      `${STARPAY_API_URL}/cards/price?amount=${amount}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to get pricing" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Starpay pricing error:", error);
    return NextResponse.json(
      { error: "Failed to get pricing" },
      { status: 500 }
    );
  }
}
