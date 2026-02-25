import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "grammy";
import { getBot } from "@/lib/telegram/bot";
import { initTelegramTables } from "@/lib/telegram/db";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    try {
      await initTelegramTables();
      initialized = true;
    } catch (err) {
      console.error("[TG Webhook] Failed to initialize DB tables:", err);
    }
  }
}

const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();

    const bot = getBot();
    const handler = webhookCallback(bot, "next-js", {
      timeoutMilliseconds: 60_000,
      secretToken: secret,
    });

    return handler(request);
  } catch (error) {
    console.error("[TG Webhook] Error:", error);
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({ status: "Hoppy Telegram Bot webhook active" });
}
