// Shielded Pool Adapter
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

// Claim Note System
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
