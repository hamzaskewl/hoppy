import { NextResponse } from "next/server";

/**
 * One-time setup: Register the webhook URL with Telegram.
 * Visit /api/telegram/set-webhook to register.
 * 
 * Requires TELEGRAM_BOT_TOKEN and NEXT_PUBLIC_APP_URL env vars.
 */
export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN not set" },
      { status: 500 }
    );
  }

  if (!appUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_APP_URL not set" },
      { status: 500 }
    );
  }

  const webhookUrl = `${appUrl}/api/telegram/webhook`;

  try {
    const params: Record<string, string> = {
      url: webhookUrl,
      allowed_updates: JSON.stringify(["message", "callback_query"]),
    };

    if (secret) {
      params.secret_token = secret;
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }
    );

    const result = await response.json();

    if (result.ok) {
      return NextResponse.json({
        success: true,
        message: `Webhook set to ${webhookUrl}`,
        result,
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.description, result },
        { status: 400 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to set webhook",
      },
      { status: 500 }
    );
  }
}
