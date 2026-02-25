import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/card/db";

/**
 * One-time cleanup: deletes broken tg_payments records with invalid claim URLs.
 *
 * Just visit this URL in your browser:
 *   /api/telegram/cleanup?confirm=yes
 *
 * Without ?confirm=yes it shows a preview. With it, it deletes.
 * DELETE THIS FILE after running it.
 */

export async function GET(request: NextRequest) {
  const confirm = request.nextUrl.searchParams.get("confirm");

  if (confirm === "yes") {
    const result = await pool.query(
      `DELETE FROM tg_payments
       WHERE claim_url LIKE '#%' OR claim_url NOT LIKE 'http%'
       RETURNING id, claim_url, amount, status`
    );

    return NextResponse.json({
      deleted: result.rows.length,
      records: result.rows,
      message: `Deleted ${result.rows.length} broken record(s). You can now delete this cleanup endpoint file.`,
    });
  }

  // Preview mode
  const result = await pool.query(
    `SELECT id, claim_url, amount, status, recipient_identifier, created_at
     FROM tg_payments
     WHERE claim_url LIKE '#%' OR claim_url NOT LIKE 'http%'`
  );

  return NextResponse.json({
    count: result.rows.length,
    records: result.rows,
    message: "Preview: these records have broken claim URLs. Add ?confirm=yes to the URL to delete them.",
  });
}
