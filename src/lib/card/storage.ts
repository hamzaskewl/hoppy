/**
 * Card Order Storage - PostgreSQL
 *
 * Stores gift card orders in Railway PostgreSQL.
 * Falls back to file-based storage for local development if DATABASE_URL is not set.
 */

import { EncryptedCard } from "./encryption";

export type GiftCardOrderStatus =
  | "pending"      // Order created, waiting for payment
  | "paid"         // Payment received, waiting for Bitrefill to fulfill
  | "ready"        // Redemption details encrypted, claim link ready
  | "claimed"      // Claim link has been opened
  | "expired"      // Order expired
  | "failed";      // Bitrefill returned a failure

export interface GiftCardOrder {
  orderId: string;
  status: GiftCardOrderStatus;
  amount: number;                  // USD value of the card
  productSlug: string;             // e.g. "virtual-prepaid-visa-usa", "amazon_com-usa"
  productName: string;             // Display name
  createdAt: string;
  expiresAt: string;

  // Bitrefill identifiers
  bitrefillInvoiceId?: string;     // UUID with dashes
  bitrefillOrderId?: string;       // 24-char hex (MongoDB ObjectId)

  // Crypto payment details (returned to client to drive the Umbra deposit/withdraw)
  paymentAddress?: string;
  paymentAmount?: number;          // amount in payment currency (e.g. SOL)
  paymentCurrency?: string;        // "SOL", "BTC", etc.

  // Umbra flow tx hashes
  depositTxHash?: string;
  withdrawTxHash?: string;

  // Encrypted redemption blob (server can't decrypt without the key in the URL)
  encryptedCard?: EncryptedCard;

  // Generated claim link
  claimLink?: string;
}

const hasDatabase = !!process.env.DATABASE_URL;

// ============================================================================
// PostgreSQL Implementation
// ============================================================================

async function getPool() {
  const { default: pool } = await import("./db");
  return pool;
}

function rowToOrder(row: Record<string, unknown>): GiftCardOrder {
  return {
    orderId: row.order_id as string,
    status: row.status as GiftCardOrderStatus,
    amount: row.amount as number,
    productSlug: (row.product_slug as string) || (row.card_type as string) || "",
    productName: (row.product_name as string) || "",
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    bitrefillInvoiceId: (row.bitrefill_invoice_id as string) || undefined,
    bitrefillOrderId: (row.bitrefill_order_id as string) || undefined,
    paymentAddress: (row.payment_address as string) || undefined,
    paymentAmount: row.payment_amount != null ? parseFloat(row.payment_amount as string) : undefined,
    paymentCurrency: (row.payment_currency as string) || undefined,
    depositTxHash: (row.deposit_tx_hash as string) || undefined,
    withdrawTxHash: (row.withdraw_tx_hash as string) || undefined,
    encryptedCard: (row.encrypted_card as EncryptedCard) || undefined,
    claimLink: (row.claim_link as string) || undefined,
  };
}

async function createOrderPg(order: GiftCardOrder): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO gift_card_orders
     (order_id, status, amount, product_slug, product_name, created_at, expires_at,
      bitrefill_invoice_id, bitrefill_order_id, payment_address, payment_amount, payment_currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      order.orderId,
      order.status,
      order.amount,
      order.productSlug,
      order.productName,
      order.createdAt,
      order.expiresAt,
      order.bitrefillInvoiceId || null,
      order.bitrefillOrderId || null,
      order.paymentAddress || null,
      order.paymentAmount ?? null,
      order.paymentCurrency || null,
    ]
  );
}

async function getOrderPg(orderId: string): Promise<GiftCardOrder | null> {
  const pool = await getPool();
  const result = await pool.query(`SELECT * FROM gift_card_orders WHERE order_id = $1`, [orderId]);
  if (result.rows.length === 0) return null;
  return rowToOrder(result.rows[0]);
}

async function updateOrderPg(orderId: string, updates: Partial<GiftCardOrder>): Promise<GiftCardOrder | null> {
  const pool = await getPool();

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const set = (col: string, val: unknown) => {
    fields.push(`${col} = $${i++}`);
    values.push(val);
  };

  if (updates.status !== undefined) set("status", updates.status);
  if (updates.bitrefillInvoiceId !== undefined) set("bitrefill_invoice_id", updates.bitrefillInvoiceId);
  if (updates.bitrefillOrderId !== undefined) set("bitrefill_order_id", updates.bitrefillOrderId);
  if (updates.paymentAddress !== undefined) set("payment_address", updates.paymentAddress);
  if (updates.paymentAmount !== undefined) set("payment_amount", updates.paymentAmount);
  if (updates.paymentCurrency !== undefined) set("payment_currency", updates.paymentCurrency);
  if (updates.depositTxHash !== undefined) set("deposit_tx_hash", updates.depositTxHash);
  if (updates.withdrawTxHash !== undefined) set("withdraw_tx_hash", updates.withdrawTxHash);
  if (updates.encryptedCard !== undefined) set("encrypted_card", JSON.stringify(updates.encryptedCard));
  if (updates.claimLink !== undefined) set("claim_link", updates.claimLink);

  if (fields.length === 0) return getOrderPg(orderId);

  fields.push(`updated_at = NOW()`);
  values.push(orderId);

  await pool.query(
    `UPDATE gift_card_orders SET ${fields.join(", ")} WHERE order_id = $${i}`,
    values
  );
  return getOrderPg(orderId);
}

async function getOrdersByStatusPg(status: GiftCardOrderStatus): Promise<GiftCardOrder[]> {
  const pool = await getPool();
  const result = await pool.query(`SELECT * FROM gift_card_orders WHERE status = $1`, [status]);
  return result.rows.map(rowToOrder);
}

async function getOrderByBitrefillInvoicePg(invoiceId: string): Promise<GiftCardOrder | null> {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT * FROM gift_card_orders WHERE bitrefill_invoice_id = $1`,
    [invoiceId]
  );
  if (result.rows.length === 0) return null;
  return rowToOrder(result.rows[0]);
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

function getOrderByBitrefillInvoiceFile(invoiceId: string): GiftCardOrder | null {
  const orders = loadOrdersFile();
  return Object.values(orders).find(o => o.bitrefillInvoiceId === invoiceId) || null;
}

// ============================================================================
// Public API (auto-selects implementation)
// ============================================================================

export async function createOrder(order: GiftCardOrder): Promise<void> {
  if (hasDatabase) return createOrderPg(order);
  createOrderFile(order);
}

export async function getOrder(orderId: string): Promise<GiftCardOrder | null> {
  if (hasDatabase) return getOrderPg(orderId);
  return getOrderFile(orderId);
}

export async function updateOrder(orderId: string, updates: Partial<GiftCardOrder>): Promise<GiftCardOrder | null> {
  if (hasDatabase) return updateOrderPg(orderId, updates);
  return updateOrderFile(orderId, updates);
}

export async function getOrdersByStatus(status: GiftCardOrderStatus): Promise<GiftCardOrder[]> {
  if (hasDatabase) return getOrdersByStatusPg(status);
  return getOrdersByStatusFile(status);
}

export async function getOrderByBitrefillInvoice(invoiceId: string): Promise<GiftCardOrder | null> {
  if (hasDatabase) return getOrderByBitrefillInvoicePg(invoiceId);
  return getOrderByBitrefillInvoiceFile(invoiceId);
}

export function getAllOrders(): GiftCardOrder[] {
  const orders = loadOrdersFile();
  return Object.values(orders);
}
