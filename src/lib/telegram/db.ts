import pool from "@/lib/card/db";

export async function initTelegramTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tg_wallets (
        tg_user_id BIGINT PRIMARY KEY,
        tg_username TEXT,
        wallet_address TEXT NOT NULL,
        encrypted_secret_key TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tg_payments (
        id SERIAL PRIMARY KEY,
        sender_tg_id BIGINT NOT NULL,
        recipient_identifier TEXT,
        delivery_method TEXT NOT NULL DEFAULT 'link',
        claim_url TEXT NOT NULL,
        amount BIGINT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sender_privacy TEXT NOT NULL DEFAULT 'basic',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days')
      );

      CREATE INDEX IF NOT EXISTS idx_tg_payments_sender ON tg_payments(sender_tg_id);
      CREATE INDEX IF NOT EXISTS idx_tg_payments_recipient ON tg_payments(recipient_identifier);
      CREATE INDEX IF NOT EXISTS idx_tg_payments_status ON tg_payments(status);
      CREATE INDEX IF NOT EXISTS idx_tg_wallets_username ON tg_wallets(tg_username);
    `);
    console.log("[TG DB] Telegram tables initialized");
  } finally {
    client.release();
  }
}

export async function getWallet(tgUserId: number) {
  const result = await pool.query(
    "SELECT * FROM tg_wallets WHERE tg_user_id = $1",
    [tgUserId]
  );
  return result.rows[0] || null;
}

export async function getWalletByUsername(username: string) {
  const result = await pool.query(
    "SELECT * FROM tg_wallets WHERE tg_username = $1",
    [username.toLowerCase()]
  );
  return result.rows[0] || null;
}

export async function upsertWallet(
  tgUserId: number,
  tgUsername: string | undefined,
  walletAddress: string,
  encryptedSecretKey: string
) {
  await pool.query(
    `INSERT INTO tg_wallets (tg_user_id, tg_username, wallet_address, encrypted_secret_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tg_user_id) DO UPDATE SET
       tg_username = COALESCE($2, tg_wallets.tg_username),
       wallet_address = $3,
       encrypted_secret_key = $4`,
    [tgUserId, tgUsername?.toLowerCase(), walletAddress, encryptedSecretKey]
  );
}

export async function savePayment(payment: {
  senderTgId: number;
  recipientIdentifier: string;
  deliveryMethod: string;
  claimUrl: string;
  amount: number;
  senderPrivacy: string;
}) {
  const result = await pool.query(
    `INSERT INTO tg_payments (sender_tg_id, recipient_identifier, delivery_method, claim_url, amount, sender_privacy)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      payment.senderTgId,
      payment.recipientIdentifier,
      payment.deliveryMethod,
      payment.claimUrl,
      payment.amount,
      payment.senderPrivacy,
    ]
  );
  return result.rows[0].id as number;
}

export async function getPaymentsByUser(tgUserId: number, limit = 10) {
  const result = await pool.query(
    `SELECT * FROM tg_payments
     WHERE sender_tg_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tgUserId, limit]
  );
  return result.rows;
}

export async function getPendingPaymentsForUser(username: string) {
  const result = await pool.query(
    `SELECT * FROM tg_payments
     WHERE recipient_identifier = $1 AND status = 'pending'
     ORDER BY created_at ASC`,
    [username.toLowerCase()]
  );
  return result.rows;
}

export async function getPaymentById(id: number) {
  const result = await pool.query(
    "SELECT * FROM tg_payments WHERE id = $1",
    [id]
  );
  return result.rows[0] || null;
}

export async function updatePaymentStatus(id: number, status: string) {
  await pool.query(
    "UPDATE tg_payments SET status = $1 WHERE id = $2",
    [status, id]
  );
}
