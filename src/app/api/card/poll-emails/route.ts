/**
 * Poll emails for card deliveries
 * 
 * This endpoint can be:
 * 1. Called by a cron job (e.g., every 30 seconds)
 * 2. Called manually to trigger immediate poll
 * 
 * Requires CRON_SECRET to prevent unauthorized access.
 */

import { NextRequest, NextResponse } from "next/server";
import { pollEmails } from "@/lib/card/email-worker";

export async function POST(request: NextRequest) {
  try {
    // Verify authorization
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if IMAP is configured
    if (!process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
      return NextResponse.json(
        { error: "IMAP not configured", configured: false },
        { status: 500 }
      );
    }

    const processed = await pollEmails();

    return NextResponse.json({
      success: true,
      processed,
    });
  } catch (error) {
    console.error("[PollEmails] Error:", error);
    return NextResponse.json(
      { error: "Failed to poll emails" },
      { status: 500 }
    );
  }
}

// Also allow GET for simple health check / manual trigger
export async function GET(request: NextRequest) {
  return POST(request);
}
