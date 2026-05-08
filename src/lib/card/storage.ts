/**
 * Card Order Storage - PostgreSQL
 * 
 * Stores gift card orders in Railway PostgreSQL.
 * Falls back to file-based storage for local development if DATABASE_URL is not set.
 */

import { EncryptedCard } from "./encryption";

export type GiftCardOrderStatus = 
  | "pending"      // Order created, waiting for payment
  | "paid"         // Payment received, waiting for card email
  | "ready"        // Card received and encrypted, claim link ready
  | "claimed"      // Card has been viewed
  | "expired";     // Order expired

export interface GiftCardOrder {
  orderId: string;
  status: GiftCardOrderStatus;
  amount: number;
  cardType: "visa" | "mastercard";
  createdAt: string;
  expiresAt: string;
  
  // Starpay data
  starpayOrderId?: string;
  paymentAddress?: string;
  paymentAmountSol?: number;
  
  // Umbra payment data
  depositTxHash?: string;
  withdrawTxHash?: string;
  
  // Card data (encrypted - server can't read without key)
  encryptedCard?: EncryptedCard;
  
  // Claim link (generated when card is ready)
  claimLink?: string;
}

// Check if we have a database connection
const hasDatabase = !!process.env.DATABASE_URL;

// ============================================================================
// PostgreSQL Implementation
// ============================================================================

async function getPool() {
  const { default: pool } = await import("./db");
  return pool;
}

async function createOrderPg(order: GiftCardOrder): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO gift_card_orders 
     (order_id, status, amount, card_type, created_at, expires_at, starpay_order_id, payment_address, payment_amount_sol)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      order.orderId,
      order.status,
      order.amount,
      order.cardType,
      order.createdAt,
      order.expiresAt,
      order.starpayOrderId || null,
      order.paymentAddress || null,
      order.paymentAmountSol || null,
    ]
  );
}

async function getOrderPg(orderId: string): Promise<GiftCardOrder | null> {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT * FROM gift_card_orders WHERE order_id = $1`,
    [orderId]
  );
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    orderId: row.order_id,
    status: row.status,
    amount: row.amount,
    cardType: row.card_type,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    starpayOrderId: row.starpay_order_id,
    paymentAddress: row.payment_address,
    paymentAmountSol: row.payment_amount_sol ? parseFloat(row.payment_amount_sol) : undefined,
    depositTxHash: row.deposit_tx_hash,
    withdrawTxHash: row.withdraw_tx_hash,
    encryptedCard: row.encrypted_card,
    claimLink: row.claim_link,
  };
}

async function updateOrderPg(orderId: string, updates: Partial<GiftCardOrder>): Promise<GiftCardOrder | null> {
  const pool = await getPool();
  
  // Build dynamic UPDATE query
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;
  
  if (updates.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }
  if (updates.depositTxHash !== undefined) {
    fields.push(`deposit_tx_hash = $${paramIndex++}`);
    values.push(updates.depositTxHash);
  }
  if (updates.withdrawTxHash !== undefined) {
    fields.push(`withdraw_tx_hash = $${paramIndex++}`);
    values.push(updates.withdrawTxHash);
  }
  if (updates.encryptedCard !== undefined) {
    fields.push(`encrypted_card = $${paramIndex++}`);
    values.push(JSON.stringify(updates.encryptedCard));
  }
  if (updates.claimLink !== undefined) {
    fields.push(`claim_link = $${paramIndex++}`);
    values.push(updates.claimLink);
  }
  
  fields.push(`updated_at = NOW()`);
  values.push(orderId);
  
  await pool.query(
    `UPDATE gift_card_orders SET ${fields.join(", ")} WHERE order_id = $${paramIndex}`,
    values
  );
  
  return getOrderPg(orderId);
}

async function getOrdersByStatusPg(status: GiftCardOrderStatus): Promise<GiftCardOrder[]> {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT * FROM gift_card_orders WHERE status = $1`,
    [status]
  );
  
  return result.rows.map(row => ({
    orderId: row.order_id,
    status: row.status,
    amount: row.amount,
    cardType: row.card_type,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    starpayOrderId: row.starpay_order_id,
    paymentAddress: row.payment_address,
    paymentAmountSol: row.payment_amount_sol ? parseFloat(row.payment_amount_sol) : undefined,
    depositTxHash: row.deposit_tx_hash,
    withdrawTxHash: row.withdraw_tx_hash,
    encryptedCard: row.encrypted_card,
    claimLink: row.claim_link,
  }));
}

async function getOrderByStarpayIdPg(starpayOrderId: string): Promise<GiftCardOrder | null> {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT * FROM gift_card_orders WHERE starpay_order_id = $1`,
    [starpayOrderId]
  );
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    orderId: row.order_id,
    status: row.status,
    amount: row.amount,
    cardType: row.card_type,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    starpayOrderId: row.starpay_order_id,
    paymentAddress: row.payment_address,
    paymentAmountSol: row.payment_amount_sol ? parseFloat(row.payment_amount_sol) : undefined,
    depositTxHash: row.deposit_tx_hash,
    withdrawTxHash: row.withdraw_tx_hash,
    encryptedCard: row.encrypted_card,
    claimLink: row.claim_link,
  };
}

// ============================================================================
// File-based Fallback (Local Development)
// ============================================================================

import fs from "fs";
import path from "path";

const STORAGE_FILE = path.join(process.cwd(), ".card-orders.json");

function loadOrdersFile(): Record<string, GiftCardOrder> {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("[Storage] Error loading orders:", e);
  }
  return {};
}

function saveOrdersFile(orders: Record<string, GiftCardOrder>): void {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(orders, null, 2));
  } catch (e) {
    console.error("[Storage] Error saving orders:", e);
  }
}

function createOrderFile(order: GiftCardOrder): void {
  const orders = loadOrdersFile();
  orders[order.orderId] = order;
  saveOrdersFile(orders);
}

function getOrderFile(orderId: string): GiftCardOrder | null {
  const orders = loadOrdersFile();
  return orders[orderId] || null;
}

function updateOrderFile(orderId: string, updates: Partial<GiftCardOrder>): GiftCardOrder | null {
  const orders = loadOrdersFile();
  if (!orders[orderId]) return null;
  
  orders[orderId] = { ...orders[orderId], ...updates };
  saveOrdersFile(orders);
  return orders[orderId];
}

function getOrdersByStatusFile(status: GiftCardOrderStatus): GiftCardOrder[] {
  const orders = loadOrdersFile();
  return Object.values(orders).filter(o => o.status === status);
}

function getOrderByStarpayIdFile(starpayOrderId: string): GiftCardOrder | null {
  const orders = loadOrdersFile();
  return Object.values(orders).find(o => o.starpayOrderId === starpayOrderId) || null;
}

// ============================================================================
// Exported Functions (Auto-select implementation)
// ============================================================================

export async function createOrder(order: GiftCardOrder): Promise<void> {
  if (hasDatabase) {
    return createOrderPg(order);
  }
  createOrderFile(order);
}

export async function getOrder(orderId: string): Promise<GiftCardOrder | null> {
  if (hasDatabase) {
    return getOrderPg(orderId);
  }
  return getOrderFile(orderId);
}

export async function updateOrder(orderId: string, updates: Partial<GiftCardOrder>): Promise<GiftCardOrder | null> {
  if (hasDatabase) {
    return updateOrderPg(orderId, updates);
  }
  return updateOrderFile(orderId, updates);
}

export async function getOrdersByStatus(status: GiftCardOrderStatus): Promise<GiftCardOrder[]> {
  if (hasDatabase) {
    return getOrdersByStatusPg(status);
  }
  return getOrdersByStatusFile(status);
}

export async function getOrderByStarpayId(starpayOrderId: string): Promise<GiftCardOrder | null> {
  if (hasDatabase) {
    return getOrderByStarpayIdPg(starpayOrderId);
  }
  return getOrderByStarpayIdFile(starpayOrderId);
}

export function getAllOrders(): GiftCardOrder[] {
  // Only for file-based (debugging)
  const orders = loadOrdersFile();
  return Object.values(orders);
}
