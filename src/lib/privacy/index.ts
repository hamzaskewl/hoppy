// Privacy Cash Adapter (Production Implementation)
// Note: Privacy Cash SDK operations are in API routes (server-side only)
export {
  // Types
  type CompositeSecret,
  type DoubleHopNote,
  type FeeEstimate,
  type SenderPrivacy,
  type RecipientPrivacy,
  type SenderPrivacyInfo,
  type RecipientPrivacyInfo,
  // Legacy types
  type PrivacyLevel,
  // Constants
  SENDER_PRIVACY,
  RECIPIENT_PRIVACY,
  PRIVACY_LEVELS, // Legacy
  // Functions
  generateCompositeSecret,
  decodeCompositeSecret,
  calculateFees,
  calculateDepositForRecipientAmount,
  calculateSenderCost,
  calculateRecipientReceives,
  calculateTotalDeposit, // Legacy
  serializeDoubleHopNote,
  deserializeDoubleHopNote,
  createDoubleHopClaimUrl,
  extractDoubleHopNoteFromUrl,
} from "./privacy-cash-adapter";
