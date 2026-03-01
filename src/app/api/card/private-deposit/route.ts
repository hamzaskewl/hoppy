/**
 * DISABLED: Private card deposit route
 * Card privacy flow is being redesigned. Temporarily disabled during Umbra migration.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: "Private card deposits are temporarily disabled." },
    { status: 503 }
  );
}
