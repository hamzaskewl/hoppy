/**
 * PostgreSQL Database Connection
 *
 * Uses Railway's DATABASE_URL environment variable.
 */

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

export default pool;

/** Increment link created counter (no PII stored) */
export async function incrementLinksCreated(): Promise<void> {
  try {
    await pool.query(
      `UPDATE link_stats SET total_links_created = total_links_created + 1, last_updated = NOW() WHERE id = 1`
    );
  } catch (e) {
    console.error("[DB] Failed to increment links created:", e);
  }
}

/** Increment link claimed counter (no PII stored) */
export async function incrementLinksClaimed(): Promise<void> {
  try {
    await pool.query(
      `UPDATE link_stats SET total_links_claimed = total_links_claimed + 1, last_updated = NOW() WHERE id = 1`
    );
  } catch (e) {
    console.error("[DB] Failed to increment links claimed:", e);
  }
}

/** Get link stats */
export async function getLinkStats(): Promise<{ totalCreated: number; totalClaimed: number }> {
  try {
    const res = await pool.query(`SELECT total_links_created, total_links_claimed FROM link_stats WHERE id = 1`);
    if (res.rows.length > 0) {
      return {
        totalCreated: res.rows[0].total_links_created,
        totalClaimed: res.rows[0].total_links_claimed,
      };
    }
  } catch (e) {
    console.error("[DB] Failed to get link stats:", e);
  }
  return { totalCreated: 0, totalClaimed: 0 };
}

/**
 * Initialize the database schema.
 * Idempotent — safe to run repeatedly. Adds Bitrefill columns to legacy
 * tables that may have Starpay-era schema.
 */
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS gift_card_orders (
        order_id VARCHAR(64) PRIMARY KEY,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        amount INTEGER NOT NULL,
        product_slug VARCHAR(128),
        product_name VARCHAR(256),
        card_type VARCHAR(20),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE,
        bitrefill_invoice_id VARCHAR(64),
        bitrefill_order_id VARCHAR(64),
        starpay_order_id VARCHAR(64),
        payment_address VARCHAR(64),
        payment_amount DECIMAL(18, 9),
        payment_currency VARCHAR(20),
        payment_amount_sol DECIMAL(18, 9),
        deposit_tx_hash VARCHAR(128),
        withdraw_tx_hash VARCHAR(128),
        encrypted_card JSONB,
        claim_link TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE gift_card_orders ADD COLUMN IF NOT EXISTS product_slug VARCHAR(128);
      ALTER TABLE gift_card_orders ADD COLUMN IF NOT EXISTS product_name VARCHAR(256);
      ALTER TABLE gift_card_orders ADD COLUMN IF NOT EXISTS bitrefill_invoice_id VARCHAR(64);
      ALTER TABLE gift_card_orders ADD COLUMN IF NOT EXISTS bitrefill_order_id VARCHAR(64);
      ALTER TABLE gift_card_orders ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(18, 9);
      ALTER TABLE gift_card_orders ADD COLUMN IF NOT EXISTS payment_currency VARCHAR(20);

      -- Legacy Starpay schema had card_type NOT NULL; the Bitrefill flow
      -- doesn't populate it (we use product_slug instead). Drop the constraint.
      ALTER TABLE gift_card_orders ALTER COLUMN card_type DROP NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_orders_status ON gift_card_orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_bitrefill_invoice ON gift_card_orders(bitrefill_invoice_id);

      CREATE TABLE IF NOT EXISTS link_stats (
        id INTEGER PRIMARY KEY DEFAULT 1,
        total_links_created INTEGER NOT NULL DEFAULT 0,
        total_links_claimed INTEGER NOT NULL DEFAULT 0,
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CHECK (id = 1)
      );
      INSERT INTO link_stats (id) VALUES (1) ON CONFLICT DO NOTHING;
    `);
    console.log("[DB] Database schema initialized");
  } finally {
    client.release();
  }
}
