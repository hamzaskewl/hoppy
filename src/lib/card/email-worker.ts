/**
 * IMAP Email Worker
 * 
 * Polls the hoppy email inbox for Starpay card delivery emails.
 * Extracts card details, encrypts them, and updates the order.
 * 
 * Run this as a background process or cron job.
 */

import { ImapFlow } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import { 
  generateEncryptionKey, 
  encryptCardDetails, 
  createClaimLink,
  CardDetails 
} from "./encryption";
import { 
  getOrdersByStatus, 
  updateOrder, 
  getOrderByStarpayId 
} from "./storage";

// Email configuration from environment
const IMAP_CONFIG = {
  host: process.env.IMAP_HOST || "imap.gmail.com",
  port: parseInt(process.env.IMAP_PORT || "993"),
  secure: true,
  auth: {
    user: process.env.IMAP_USER || "",
    pass: process.env.IMAP_PASSWORD || "",
  },
};

// Email address pattern: cards+{orderId}@hoppy.app
const EMAIL_PREFIX = process.env.EMAIL_PREFIX || "cards";
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || "hoppy.app";

/**
 * Extract card details from Starpay email
 * This regex pattern may need adjustment based on actual Starpay email format
 */
function parseCardFromEmail(email: ParsedMail): CardDetails | null {
  const text = email.text || "";
  const html = email.html || "";
  const content = text + html;
  
  // Try to extract card details using regex
  // Adjust patterns based on actual Starpay email format
  const numberMatch = content.match(/card\s*number[:\s]*([0-9\s-]{16,19})/i) ||
                      content.match(/([0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4})/);
  const expiryMatch = content.match(/expir[ey][:\s]*([0-9]{2}\/[0-9]{2,4})/i) ||
                      content.match(/valid\s*thru[:\s]*([0-9]{2}\/[0-9]{2,4})/i);
  const cvvMatch = content.match(/cvv[:\s]*([0-9]{3,4})/i) ||
                   content.match(/cvc[:\s]*([0-9]{3,4})/i) ||
                   content.match(/security\s*code[:\s]*([0-9]{3,4})/i);
  const valueMatch = content.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
  const typeMatch = content.match(/\b(visa|mastercard)\b/i);
  
  if (!numberMatch || !expiryMatch || !cvvMatch) {
    console.error("[Email] Could not parse card details from email");
    return null;
  }
  
  return {
    number: numberMatch[1].replace(/[\s-]/g, ""),
    expiry: expiryMatch[1],
    cvv: cvvMatch[1],
    value: valueMatch ? parseFloat(valueMatch[1]) : 0,
    cardType: typeMatch ? typeMatch[1].toLowerCase() : "unknown",
  };
}

/**
 * Extract order ID from email address (cards+{orderId}@hoppy.app)
 */
function extractOrderIdFromEmail(toAddresses: string[]): string | null {
  for (const addr of toAddresses) {
    const match = addr.match(new RegExp(`${EMAIL_PREFIX}\\+([a-zA-Z0-9-]+)@`, "i"));
    if (match) return match[1];
  }
  return null;
}

/**
 * Process a single email
 */
async function processEmail(email: ParsedMail): Promise<boolean> {
  const to = email.to?.value?.map(v => v.address || "") || [];
  const from = email.from?.value?.[0]?.address || "";
  const subject = email.subject || "";
  
  console.log(`[Email] Processing: "${subject}" from ${from}`);
  
  // Check if it's from Starpay
  if (!from.toLowerCase().includes("starpay")) {
    console.log("[Email] Not from Starpay, skipping");
    return false;
  }
  
  // Extract order ID from email address
  const orderId = extractOrderIdFromEmail(to);
  if (!orderId) {
    console.log("[Email] Could not extract order ID from recipient");
    return false;
  }
  
  console.log(`[Email] Found order ID: ${orderId}`);
  
  // Parse card details
  const cardDetails = parseCardFromEmail(email);
  if (!cardDetails) {
    console.log("[Email] Could not parse card details");
    return false;
  }
  
  console.log(`[Email] Parsed card: ****${cardDetails.number.slice(-4)}, exp: ${cardDetails.expiry}`);
  
  // Encrypt card details
  const encryptionKey = generateEncryptionKey();
  const encryptedCard = encryptCardDetails(cardDetails, encryptionKey);
  
  // Generate claim link
  const claimLink = createClaimLink(orderId, encryptionKey);
  
  // Update order
  const updated = updateOrder(orderId, {
    status: "ready",
    encryptedCard,
    claimLink,
  });
  
  if (updated) {
    console.log(`[Email] Order ${orderId} updated with claim link`);
    return true;
  }
  
  console.log(`[Email] Order ${orderId} not found in storage`);
  return false;
}

/**
 * Poll inbox for new emails
 */
export async function pollEmails(): Promise<number> {
  if (!IMAP_CONFIG.auth.user || !IMAP_CONFIG.auth.pass) {
    console.error("[Email] IMAP credentials not configured");
    return 0;
  }
  
  const client = new ImapFlow(IMAP_CONFIG);
  let processed = 0;
  
  try {
    await client.connect();
    console.log("[Email] Connected to IMAP server");
    
    // Open inbox
    await client.mailboxOpen("INBOX");
    
    // Search for unread emails
    const messages = client.fetch({ seen: false }, { source: true });
    
    for await (const msg of messages) {
      try {
        const parsed = await simpleParser(msg.source);
        const success = await processEmail(parsed);
        
        if (success) {
          // Mark as read
          await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
          processed++;
        }
      } catch (e) {
        console.error("[Email] Error processing message:", e);
      }
    }
    
    console.log(`[Email] Processed ${processed} emails`);
  } catch (e) {
    console.error("[Email] IMAP error:", e);
  } finally {
    await client.logout();
  }
  
  return processed;
}

/**
 * Start polling loop
 */
export function startPolling(intervalMs: number = 30000): () => void {
  console.log(`[Email] Starting poll loop (every ${intervalMs / 1000}s)`);
  
  // Initial poll
  pollEmails();
  
  const interval = setInterval(() => {
    pollEmails();
  }, intervalMs);
  
  return () => clearInterval(interval);
}
