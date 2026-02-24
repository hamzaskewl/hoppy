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
  type SupportedToken,
  type TokenInfo,
  // Legacy types
  type PrivacyLevel,
  // Constants
  SENDER_PRIVACY,
  RECIPIENT_PRIVACY,
  PRIVACY_LEVELS, // Legacy
  TOKEN_MINTS,
  SPL_SOL_BUFFER,
  // Functions
  generateCompositeSecret,
  decodeCompositeSecret,
  calculateFees,
  calculateSPLFees,
  calculateDepositForRecipientAmount,
  calculateSPLDepositForRecipientAmount,
  calculateSenderCost,
  calculateRecipientReceives,
  calculateSPLRecipientReceives,
  calculateTotalDeposit, // Legacy
  serializeDoubleHopNote,
  deserializeDoubleHopNote,
  createDoubleHopClaimUrl,
  extractDoubleHopNoteFromUrl,
  getTokenInfo,
} from "./privacy-cash-adapter";
