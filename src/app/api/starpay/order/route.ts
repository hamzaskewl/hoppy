import { NextRequest, NextResponse } from "next/server";

const STARPAY_API_URL = "https://www.starpay.cards/api/v1";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, cardType, email } = body;

    // Validate inputs
    if (!amount || amount < 5 || amount > 10000) {
      return NextResponse.json(
        { error: "Amount must be between $5 and $10,000" },
        { status: 400 }
      );
    }

    if (!cardType || !["visa", "mastercard"].includes(cardType)) {
      return NextResponse.json(
        { error: "Card type must be 'visa' or 'mastercard'" },
        { status: 400 }
      );
    }

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email is required" },
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

    const response = await fetch(`${STARPAY_API_URL}/cards/order`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount, cardType, email }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to create order" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Starpay order error:", error);
    return NextResponse.json(
      { error: "Failed to create card order" },
      { status: 500 }
    );
  }
}
