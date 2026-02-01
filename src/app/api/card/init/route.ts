/**
 * Initialize database schema
 * 
 * Call this once on deployment to create tables.
 * GET /api/card/init
 */

import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/card/db";

export async function GET(request: NextRequest) {
  // Only allow in development or with secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  
  if (process.env.NODE_ENV === "production" && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await initDatabase();
    return NextResponse.json({ success: true, message: "Database initialized" });
  } catch (error) {
    console.error("[Init] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initialize database" },
      { status: 500 }
    );
  }
}
