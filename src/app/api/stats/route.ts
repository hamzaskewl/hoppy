import { NextResponse } from "next/server";
import { getLinkStats } from "@/lib/card/db";

export async function GET() {
  const stats = await getLinkStats();
  return NextResponse.json(stats);
}
