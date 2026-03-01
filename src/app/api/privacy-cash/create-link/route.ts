/**
 * DEPRECATED: Privacy Cash create-link route
 * Migrating to Umbra Privacy SDK — create flow now happens client-side.
 * This route will be deleted once migration is complete.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  return NextResponse.json(
    { success: false, error: "This endpoint is deprecated. Please update your client." },
    { status: 503 }
  );
}
