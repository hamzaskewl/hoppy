/**
 * Card Order Storage
 * 
 * Simple file-based storage for gift card orders.
 * In production, replace with a proper database (Redis, PostgreSQL, etc.)
 */

import fs from "fs";
import path from "path";
import { EncryptedCard } from "./encryption";

const STORAGE_FILE = path.join(process.cwd(), ".card-orders.json");

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
  
  // Privacy Cash data
  depositTxHash?: string;
  withdrawTxHash?: string;
  
  // Card data (encrypted - server can't read without key)
  encryptedCard?: EncryptedCard;
  
  // Claim link (generated when card is ready)
  claimLink?: string;
}

function loadOrders(): Record<string, GiftCardOrder> {
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

function saveOrders(orders: Record<string, GiftCardOrder>): void {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(orders, null, 2));
  } catch (e) {
    console.error("[Storage] Error saving orders:", e);
  }
}

export function createOrder(order: GiftCardOrder): void {
  const orders = loadOrders();
  orders[order.orderId] = order;
  saveOrders(orders);
}

export function getOrder(orderId: string): GiftCardOrder | null {
  const orders = loadOrders();
  return orders[orderId] || null;
}

export function updateOrder(orderId: string, updates: Partial<GiftCardOrder>): GiftCardOrder | null {
  const orders = loadOrders();
  if (!orders[orderId]) return null;
  
  orders[orderId] = { ...orders[orderId], ...updates };
  saveOrders(orders);
  return orders[orderId];
}

export function getOrdersByStatus(status: GiftCardOrderStatus): GiftCardOrder[] {
  const orders = loadOrders();
  return Object.values(orders).filter(o => o.status === status);
}

export function getAllOrders(): GiftCardOrder[] {
  const orders = loadOrders();
  return Object.values(orders);
}

/**
 * Find order by Starpay order ID (used when processing emails)
 */
export function getOrderByStarpayId(starpayOrderId: string): GiftCardOrder | null {
  const orders = loadOrders();
  return Object.values(orders).find(o => o.starpayOrderId === starpayOrderId) || null;
}
