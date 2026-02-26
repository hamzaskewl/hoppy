import pool from "@/lib/card/db";
import {
  encryptClaimUrl,
  decryptClaimUrl,
  isEncryptedClaimUrl,
  hashIdentifier,
} from "./wallet";

export async function initTelegramTables(): Promise<void> {
  const client = await pool.connect();
  try {
    // Fresh deployments get the multi-wallet schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS tg_wallets (
        id SERIAL PRIMARY KEY,
        tg_user_id BIGINT NOT NULL,
        tg_username TEXT,
        wallet_address TEXT NOT NULL,
        encrypted_secret_key TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
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
        sender_anonymous BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days')
      );

      CREATE INDEX IF NOT EXISTS idx_tg_payments_sender ON tg_payments(sender_tg_id);
      CREATE INDEX IF NOT EXISTS idx_tg_payments_recipient ON tg_payments(recipient_identifier);
      CREATE INDEX IF NOT EXISTS idx_tg_payments_status ON tg_payments(status);
      CREATE INDEX IF NOT EXISTS idx_tg_wallets_username ON tg_wallets(tg_username);
      CREATE INDEX IF NOT EXISTS idx_tg_wallets_user ON tg_wallets(tg_user_id);
    `);

    // Migration for existing single-wallet tables
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tg_wallets' AND column_name = 'is_active'
        ) THEN
          ALTER TABLE tg_wallets ADD COLUMN is_active BOOLEAN DEFAULT true;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tg_wallets' AND column_name = 'id'
        ) THEN
          ALTER TABLE tg_wallets DROP CONSTRAINT tg_wallets_pkey;
          ALTER TABLE tg_wallets ADD COLUMN id SERIAL PRIMARY KEY;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tg_payments' AND column_name = 'sender_anonymous'
        ) THEN
          ALTER TABLE tg_payments ADD COLUMN sender_anonymous BOOLEAN NOT NULL DEFAULT true;
        END IF;
      END $$;
    `);

    // Ensure only one active wallet per user
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_wallets_active_user
        ON tg_wallets(tg_user_id) WHERE is_active = true;
    `);

    console.log("[TG DB] Telegram tables initialized");
  } finally {
    client.release();
  }

  // Migrate existing plaintext data (idempotent)
  try {
    await migrateExistingPayments();
  } catch (err) {
    console.error("[TG DB] Migration failed (non-fatal):", err);
  }

  // Purge old records
  try {
    const purged = await purgeOldPayments();
    if (purged > 0) {
      console.log(`[TG DB] Purged ${purged} old payment records`);
    }
  } catch (err) {
    console.error("[TG DB] Purge failed (non-fatal):", err);
  }
}

// ============ Wallet Functions ============

export async function getWallet(tgUserId: number) {
  const result = await pool.query(
    "SELECT * FROM tg_wallets WHERE tg_user_id = $1 AND is_active = true",
    [tgUserId]
  );
  return result.rows[0] || null;
}

export async function getWalletByUsername(username: string) {
  const result = await pool.query(
    "SELECT * FROM tg_wallets WHERE tg_username = $1 AND is_active = true",
    [username.toLowerCase()]
  );
  return result.rows[0] || null;
}

export async function getWalletsByUser(tgUserId: number) {
  const result = await pool.query(
    "SELECT * FROM tg_wallets WHERE tg_user_id = $1 ORDER BY created_at ASC",
    [tgUserId]
  );
  return result.rows;
}

export async function getWalletCount(tgUserId: number): Promise<number> {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM tg_wallets WHERE tg_user_id = $1",
    [tgUserId]
  );
  return result.rows[0].count;
}

export async function createNewWallet(
  tgUserId: number,
  tgUsername: string | undefined,
  walletAddress: string,
  encryptedSecretKey: string
): Promise<{ success: boolean; error?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const countResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM tg_wallets WHERE tg_user_id = $1",
      [tgUserId]
    );
    const count = countResult.rows[0].count;
    if (count >= 3) {
      await client.query("ROLLBACK");
      return {
        success: false,
        error: "Maximum 3 wallets reached. Switch to an existing wallet instead.",
      };
    }

    // Deactivate current active wallet
    await client.query(
      "UPDATE tg_wallets SET is_active = false WHERE tg_user_id = $1 AND is_active = true",
      [tgUserId]
    );

    // Insert new active wallet
    await client.query(
      `INSERT INTO tg_wallets (tg_user_id, tg_username, wallet_address, encrypted_secret_key, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [tgUserId, tgUsername?.toLowerCase(), walletAddress, encryptedSecretKey]
    );

    await client.query("COMMIT");
    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setActiveWallet(
  tgUserId: number,
  walletId: number
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verify wallet belongs to user
    const check = await client.query(
      "SELECT id FROM tg_wallets WHERE id = $1 AND tg_user_id = $2",
      [walletId, tgUserId]
    );
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // Deactivate all, then activate the chosen one
    await client.query(
      "UPDATE tg_wallets SET is_active = false WHERE tg_user_id = $1",
      [tgUserId]
    );
    await client.query(
      "UPDATE tg_wallets SET is_active = true WHERE id = $1",
      [walletId]
    );

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateWalletUsername(
  tgUserId: number,
  tgUsername: string
) {
  await pool.query(
    "UPDATE tg_wallets SET tg_username = $2 WHERE tg_user_id = $1",
    [tgUserId, tgUsername.toLowerCase()]
  );
}

// ============ Payment Functions (with encryption + hashing) ============

/** Decrypt claim_url if encrypted; pass through legacy plaintext rows */
function decryptPaymentRow(row: any): any {
  if (row && row.claim_url && isEncryptedClaimUrl(row.claim_url)) {
    return { ...row, claim_url: decryptClaimUrl(row.claim_url) };
  }
  return row;
}

export async function savePayment(payment: {
  senderTgId: number;
  recipientIdentifier: string;
  deliveryMethod: string;
  claimUrl: string;
  amount: number;
  senderPrivacy: string;
  senderAnonymous: boolean;
}) {
  const encryptedUrl = encryptClaimUrl(payment.claimUrl);
  const hashedRecipient = hashIdentifier(payment.recipientIdentifier);
  const result = await pool.query(
    `INSERT INTO tg_payments (sender_tg_id, recipient_identifier, delivery_method, claim_url, amount, sender_privacy, sender_anonymous)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      payment.senderTgId,
      hashedRecipient,
      payment.deliveryMethod,
      encryptedUrl,
      payment.amount,
      payment.senderPrivacy,
      payment.senderAnonymous,
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
  return result.rows.map(decryptPaymentRow);
}

export async function getPendingPaymentsForUser(username: string) {
  const hashedIdentifier = hashIdentifier(username);
  const result = await pool.query(
    `SELECT * FROM tg_payments
     WHERE recipient_identifier = $1 AND status = 'pending'
     ORDER BY created_at ASC`,
    [hashedIdentifier]
  );
  return result.rows.map(decryptPaymentRow);
}

export async function getPaymentById(id: number) {
  const result = await pool.query(
    "SELECT * FROM tg_payments WHERE id = $1",
    [id]
  );
  return result.rows[0] ? decryptPaymentRow(result.rows[0]) : null;
}

export async function updatePaymentStatus(id: number, status: string) {
  await pool.query(
    "UPDATE tg_payments SET status = $1 WHERE id = $2",
    [status, id]
  );
}

// ============ Migration & Purge ============

/** Encrypt plaintext claim_urls and hash plaintext recipient_identifiers (idempotent) */
async function migrateExistingPayments(): Promise<void> {
  const rows = await pool.query(
    "SELECT id, claim_url, recipient_identifier FROM tg_payments"
  );

  let encCount = 0;
  let hashCount = 0;

  for (const row of rows.rows) {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    // Encrypt plaintext claim_urls
    if (row.claim_url && !isEncryptedClaimUrl(row.claim_url)) {
      const encrypted = encryptClaimUrl(row.claim_url);
      updates.push(`claim_url = $${paramIdx++}`);
      values.push(encrypted);
      encCount++;
    }

    // Hash plaintext recipient_identifiers
    if (row.recipient_identifier) {
      const ri = row.recipient_identifier;
      const isAlreadyHashed = ri.length === 64 && /^[a-f0-9]+$/.test(ri);
      if (!isAlreadyHashed) {
        const hashed = hashIdentifier(ri);
        updates.push(`recipient_identifier = $${paramIdx++}`);
        values.push(hashed);
        hashCount++;
      }
    }

    if (updates.length > 0) {
      values.push(row.id);
      await pool.query(
        `UPDATE tg_payments SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
        values
      );
    }
  }

  if (encCount > 0) console.log(`[TG DB] Migrated ${encCount} claim_urls to encrypted format`);
  if (hashCount > 0) console.log(`[TG DB] Migrated ${hashCount} recipient_identifiers to hashed format`);
}

/** Purge claimed/recalled/expired payment records older than 48 hours */
async function purgeOldPayments(): Promise<number> {
  const result = await pool.query(`
    DELETE FROM tg_payments
    WHERE
      (status IN ('claimed', 'recalled') AND created_at < NOW() - INTERVAL '48 hours')
      OR status = 'expired'
      OR (status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW())
    RETURNING id
  `);
  return result.rowCount || 0;
}
