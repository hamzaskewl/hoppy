// Shielded Pool Adapter (Legacy - will be replaced by Umbra)
export {
  type ShieldedPoolAdapter,
  type ShieldedPoolResult,
  type ShieldedDepositResult,
  type DepositParams,
  type ShieldedSendParams,
  type ClaimWithNoteParams,
  type WithdrawParams,
  type ShieldedBalance,
  type CommitmentState,
  MockUmbraService,
  getUmbraService,
  createShieldedPoolAdapter,
} from "./umbra-adapter";

// Claim Note System (Legacy - will be replaced by Double Hop)
export {
  type ClaimNote,
  type SerializedNote,
  createClaimNote,
  reconstructNoteFromSecret,
  serializeNote,
  deserializeNote,
  createClaimUrl,
  extractNoteFromUrl,
  isValidNote,
} from "./claim-note";

// Privacy Cash Double Hop (Current Production Implementation)
// Note: Privacy Cash SDK operations are in API routes (server-side only)
export {
  // Types
  type CompositeSecret,
  type DoubleHopNote,
  type FeeEstimate,
  type PrivacyLevel,
  type PrivacyLevelInfo,
  // Constants
  PRIVACY_LEVELS,
  // Functions
  generateCompositeSecret,
  decodeCompositeSecret,
  calculateFees,
  calculateDepositForRecipientAmount,
  calculateTotalDeposit,
  serializeDoubleHopNote,
  deserializeDoubleHopNote,
  createDoubleHopClaimUrl,
  extractDoubleHopNoteFromUrl,
} from "./privacy-cash-adapter";
