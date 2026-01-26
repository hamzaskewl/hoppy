import type { Keypair, PublicKey } from "@solana/web3.js";
import { ClaimNote, createClaimNote, isValidNote } from "./claim-note";

/**
 * Result of a shielded pool operation
 */
export interface ShieldedPoolResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Result of a shielded deposit - includes the claim note
 */
export interface ShieldedDepositResult extends ShieldedPoolResult {
  note?: ClaimNote;
}

/**
 * Deposit parameters for shielding funds
 */
export interface DepositParams {
  /** The keypair that will sign the deposit transaction */
  signer: Keypair;
  /** Amount in lamports */
  amount: number;
}

/**
 * Shielded deposit parameters (sender deposits to pool)
 */
export interface ShieldedSendParams {
  /** The keypair that will sign the deposit transaction */
  signer: Keypair;
  /** Amount in lamports to deposit */
  amount: number;
  /** Network for the claim note */
  network?: "devnet" | "mainnet-beta";
}

/**
 * Claim with note parameters (recipient claims from pool)
 */
export interface ClaimWithNoteParams {
  /** The claim note containing the secret */
  note: ClaimNote;
  /** The recipient's wallet address */
  recipient: PublicKey;
}

/**
 * Withdraw parameters (legacy - for direct withdrawals)
 */
export interface WithdrawParams {
  recipient: PublicKey;
  amount?: number;
}

/**
 * Shielded balance info
 */
export interface ShieldedBalance {
  available: number;
  pending: number;
}

/**
 * Pool state for a commitment
 */
export interface CommitmentState {
  commitment: string;
  amount: number;
  depositor?: string; // We don't store this in production for privacy
  depositedAt: number;
  claimed: boolean;
  claimedAt?: number;
  claimedBy?: string; // Stored for sender visibility (per threat model)
}

/**
 * Abstract interface for shielded pool adapters
 * Supports both legacy deposit/withdraw and new shielded send flow
 */
export interface ShieldedPoolAdapter {
  /**
   * Shielded Send: Deposit funds and get a claim note
   * The sender deposits, receives a note to share with recipient
   */
  shieldedDeposit(params: ShieldedSendParams): Promise<ShieldedDepositResult>;

  /**
   * Claim funds using a claim note
   * The recipient provides the note and their destination address
   */
  claimWithNote(params: ClaimWithNoteParams): Promise<ShieldedPoolResult>;

  /**
   * Check if a note has been claimed (for sender visibility)
   */
  getNoteStatus(commitment: string): Promise<CommitmentState | null>;

  /**
   * Legacy: Direct deposit (for internal pool operations)
   */
  deposit(params: DepositParams): Promise<ShieldedPoolResult>;

  /**
   * Legacy: Direct withdraw (for internal pool operations)
   */
  withdraw(params: WithdrawParams): Promise<ShieldedPoolResult>;

  /**
   * Get the user's shielded balance
   */
  getShieldedBalance(): Promise<ShieldedBalance>;

  /**
   * Check if the adapter is ready
   */
  isReady(): Promise<boolean>;
}

/**
 * Mock implementation of the Umbra shielded pool
 * Simulates the shielded send flow with claim notes
 */
export class MockUmbraService implements ShieldedPoolAdapter {
  private shieldedBalance: number = 0;
  private pendingBalance: number = 0;
  private isInitialized: boolean = true;
  
  // Track commitments (in production, this would be on-chain)
  private commitments: Map<string, CommitmentState> = new Map();
  
  // Track nullifiers to prevent double-spending
  private spentNullifiers: Set<string> = new Set();

  // localStorage keys for persistence
  private readonly STORAGE_KEY_COMMITMENTS = "mock_umbra_commitments";
  private readonly STORAGE_KEY_NULLIFIERS = "mock_umbra_nullifiers";

  constructor() {
    console.log("[MockUmbra] Service initialized - Shielded Send mode");
    this.loadFromStorage();
  }

  /**
   * Load commitments and nullifiers from localStorage (for persistence across page loads)
   */
  private loadFromStorage(): void {
    if (typeof window === "undefined") return; // Server-side check

    try {
      // Load commitments
      const commitmentsData = localStorage.getItem(this.STORAGE_KEY_COMMITMENTS);
      if (commitmentsData) {
        const parsed = JSON.parse(commitmentsData);
        this.commitments = new Map(Object.entries(parsed));
        console.log(`[MockUmbra] Loaded ${this.commitments.size} commitments from storage`);
      }

      // Load nullifiers
      const nullifiersData = localStorage.getItem(this.STORAGE_KEY_NULLIFIERS);
      if (nullifiersData) {
        const parsed = JSON.parse(nullifiersData);
        this.spentNullifiers = new Set(parsed);
        console.log(`[MockUmbra] Loaded ${this.spentNullifiers.size} spent nullifiers from storage`);
      }
    } catch (error) {
      console.warn("[MockUmbra] Failed to load from storage:", error);
    }
  }

  /**
   * Save commitments to localStorage
   */
  private saveCommitments(): void {
    if (typeof window === "undefined") return; // Server-side check

    try {
      const data = Object.fromEntries(this.commitments);
      localStorage.setItem(this.STORAGE_KEY_COMMITMENTS, JSON.stringify(data));
    } catch (error) {
      console.warn("[MockUmbra] Failed to save commitments:", error);
    }
  }

  /**
   * Save nullifiers to localStorage
   */
  private saveNullifiers(): void {
    if (typeof window === "undefined") return; // Server-side check

    try {
      const data = Array.from(this.spentNullifiers);
      localStorage.setItem(this.STORAGE_KEY_NULLIFIERS, JSON.stringify(data));
    } catch (error) {
      console.warn("[MockUmbra] Failed to save nullifiers:", error);
    }
  }

  /**
   * Shielded Deposit: Sender deposits funds and receives a claim note
   */
  async shieldedDeposit(params: ShieldedSendParams): Promise<ShieldedDepositResult> {
    const { signer, amount, network = "devnet" } = params;
    const depositorAddress = signer.publicKey.toBase58();

    console.log(`[MockUmbra] 🔒 Shielded deposit: ${amount / 1_000_000_000} SOL`);
    console.log(`[MockUmbra] Depositor: ${depositorAddress.slice(0, 8)}...`);

    // Simulate network delay
    await this.simulateDelay(1500);

    try {
      // Generate claim note
      const note = await createClaimNote(amount, network);
      
      console.log(`[MockUmbra] Generated commitment: ${note.commitment.slice(0, 12)}...`);

      // Store commitment in pool (simulated on-chain storage)
      this.commitments.set(note.commitment, {
        commitment: note.commitment,
        amount,
        depositedAt: Date.now(),
        claimed: false,
        // Note: In production, we would NOT store depositor for privacy
        // But per threat model, sender can track via commitment
      });
      this.saveCommitments(); // Persist to localStorage

      // Update pool balance
      this.pendingBalance += amount;
      setTimeout(() => {
        this.shieldedBalance += amount;
        this.pendingBalance -= amount;
      }, 500);

      const mockTxHash = this.generateMockTxHash();
      
      console.log(`[MockUmbra] ✅ Deposit successful. TxHash: ${mockTxHash.slice(0, 16)}...`);
      console.log(`[MockUmbra] 📝 Claim note generated - share with recipient`);

      return {
        success: true,
        txHash: mockTxHash,
        note,
      };
    } catch (error) {
      console.error("[MockUmbra] Deposit failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Deposit failed",
      };
    }
  }

  /**
   * Claim funds using a claim note
   */
  async claimWithNote(params: ClaimWithNoteParams): Promise<ShieldedPoolResult> {
    const { note, recipient } = params;
    const recipientAddress = recipient.toBase58();

    console.log(`[MockUmbra] 🎫 Claiming with note...`);
    console.log(`[MockUmbra] Commitment: ${note.commitment.slice(0, 12)}...`);
    console.log(`[MockUmbra] Recipient: ${recipientAddress.slice(0, 8)}...`);

    // Validate note
    if (!isValidNote(note)) {
      console.error("[MockUmbra] Invalid note structure");
      return { success: false, error: "Invalid claim note" };
    }

    // Check if commitment exists
    const commitmentState = this.commitments.get(note.commitment);
    if (!commitmentState) {
      console.error("[MockUmbra] Commitment not found in pool");
      return { success: false, error: "Claim note not found - may be invalid or expired" };
    }

    // Check if already claimed (nullifier check)
    if (this.spentNullifiers.has(note.nullifier)) {
      console.error("[MockUmbra] Nullifier already spent - double-spend attempt");
      return { success: false, error: "This note has already been claimed" };
    }

    if (commitmentState.claimed) {
      console.error("[MockUmbra] Commitment already claimed");
      return { success: false, error: "This note has already been claimed" };
    }

    // Simulate network delay
    await this.simulateDelay(2000);

    // Mark as claimed
    this.spentNullifiers.add(note.nullifier);
    commitmentState.claimed = true;
    commitmentState.claimedAt = Date.now();
    commitmentState.claimedBy = recipientAddress; // Per threat model, sender can see this

    // Persist changes
    this.saveCommitments();
    this.saveNullifiers();

    // Update balances
    this.shieldedBalance -= note.amount;

    const mockTxHash = this.generateMockTxHash();

    console.log(`[MockUmbra] ✅ Claim successful!`);
    console.log(`[MockUmbra] Sent ${note.amount / 1_000_000_000} SOL to ${recipientAddress.slice(0, 8)}...`);
    console.log(`[MockUmbra] TxHash: ${mockTxHash.slice(0, 16)}...`);

    return {
      success: true,
      txHash: mockTxHash,
    };
  }

  /**
   * Get status of a note (for sender to check if claimed)
   */
  async getNoteStatus(commitment: string): Promise<CommitmentState | null> {
    return this.commitments.get(commitment) || null;
  }

  /**
   * Legacy deposit (direct to pool, no note)
   */
  async deposit(params: DepositParams): Promise<ShieldedPoolResult> {
    const { signer, amount } = params;
    const address = signer.publicKey.toBase58();

    console.log(`[MockUmbra] Legacy deposit: ${amount / 1_000_000_000} SOL from ${address}`);
    
    await this.simulateDelay(2000);

    this.pendingBalance += amount;
    setTimeout(() => {
      this.shieldedBalance += amount;
      this.pendingBalance -= amount;
    }, 500);

    const mockTxHash = this.generateMockTxHash();

    return {
      success: true,
      txHash: mockTxHash,
    };
  }

  /**
   * Legacy withdraw (direct from pool)
   */
  async withdraw(params: WithdrawParams): Promise<ShieldedPoolResult> {
    const { recipient, amount } = params;
    const withdrawAmount = amount || this.shieldedBalance;
    const recipientAddress = recipient.toBase58();

    console.log(`[MockUmbra] Legacy withdraw: ${withdrawAmount / 1_000_000_000} SOL to ${recipientAddress}`);

    if (withdrawAmount > this.shieldedBalance) {
      return {
        success: false,
        error: "Insufficient shielded balance",
      };
    }

    await this.simulateDelay(2000);

    this.shieldedBalance -= withdrawAmount;

    const mockTxHash = this.generateMockTxHash();

    return {
      success: true,
      txHash: mockTxHash,
    };
  }

  async getShieldedBalance(): Promise<ShieldedBalance> {
    return {
      available: this.shieldedBalance,
      pending: this.pendingBalance,
    };
  }

  async isReady(): Promise<boolean> {
    return this.isInitialized;
  }

  /**
   * For testing: manually add a commitment
   */
  addMockCommitment(note: ClaimNote): void {
    this.commitments.set(note.commitment, {
      commitment: note.commitment,
      amount: note.amount,
      depositedAt: Date.now(),
      claimed: false,
    });
    this.saveCommitments(); // Persist to localStorage
    this.shieldedBalance += note.amount;
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generateMockTxHash(): string {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let result = "";
    for (let i = 0; i < 88; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

// Singleton instance
let umbraServiceInstance: MockUmbraService | null = null;

export function getUmbraService(): MockUmbraService {
  if (!umbraServiceInstance) {
    umbraServiceInstance = new MockUmbraService();
  }
  return umbraServiceInstance;
}

export function createShieldedPoolAdapter(): ShieldedPoolAdapter {
  return getUmbraService();
}
