/**
 * PostgreSQL Database Connection
 * 
 * Uses Railway's DATABASE_URL environment variable.
 */

import { Pool } from "pg";

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

export default pool;

/**
 * Initialize the database schema
 * Call this once on app startup
 */
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS gift_card_orders (
        order_id VARCHAR(64) PRIMARY KEY,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        amount INTEGER NOT NULL,
        card_type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE,
        starpay_order_id VARCHAR(64),
        payment_address VARCHAR(64),
        payment_amount_sol DECIMAL(18, 9),
        deposit_tx_hash VARCHAR(128),
        withdraw_tx_hash VARCHAR(128),
        encrypted_card JSONB,
        claim_link TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_orders_status ON gift_card_orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_starpay_id ON gift_card_orders(starpay_order_id);
    `);
    console.log("[DB] Database schema initialized");
  } finally {
    client.release();
  }
}
