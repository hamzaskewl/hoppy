# hoppy — System Design

Mermaid diagrams for every user-facing flow. Open this file in:
- GitHub (renders inline)
- VS Code with the "Markdown Preview Mermaid Support" extension
- https://mermaid.live (paste a single block)

---

## 0. High-level Architecture

```mermaid
flowchart TB
  subgraph Client[Browser]
    UI[Next.js App<br/>create / claim / payroll / card / reclaim]
    SDK_B[Umbra SDK<br/>+ Web ZK Prover WASM]
    LS[(LocalStorage<br/>AES-GCM by wallet)]
  end

  subgraph Server[Hoppy Backend — Next.js routes]
    APIp[/api/umbra/payroll/*/]
    APIc[/api/card/*/]
    APIr[/api/relayer/fund-gas/]
    SDK_S[Umbra SDK + Server ZK Prover]
    Keys[Master Key derivations<br/>UMBRA_ESCROW_MASTER_KEY<br/>→ per-business payroll escrow<br/>→ per-order card escrow + stealth]
    Rel[Hoppy Relayer Wallet<br/>HOPPY_RELAYER_PRIVATE_KEY]
    DB[(Postgres<br/>gift_card_orders)]
  end

  subgraph Sol[Solana mainnet-beta]
    Prog[Umbra Program<br/>queue tx → Arcium MPC callback]
    WSOL[wSOL Mint]
  end

  subgraph Umbra[Umbra Infrastructure]
    Idx[Umbra Indexer<br/>UTXO scanner]
    UR[Umbra Relayer<br/>~0.21% fee]
  end

  BR[Bitrefill API<br/>v2 invoices / orders]
  Hel[Helius RPC]
  Privy[Privy<br/>embedded wallets / social login]

  UI --> SDK_B
  UI --> LS
  UI <--> APIp
  UI <--> APIc
  UI -.optional.-> APIr
  UI --> Privy

  SDK_B --> Hel
  SDK_B --> Idx
  SDK_B --> UR
  SDK_B --> Prog

  APIp --> SDK_S
  APIp --> Keys
  APIc --> SDK_S
  APIc --> Keys
  APIc --> Rel
  APIc --> DB
  APIc <--> BR
  APIr --> Rel

  SDK_S --> Hel
  SDK_S --> Idx
  SDK_S --> UR
  SDK_S --> Prog
```

---

## 1. Personal Send

### 1A — Create Link, Basic mode (sender visible on-chain)

Token: SOL / USDC / USDT. No ZK proof, no Umbra. Funds sit in a fresh ephemeral keypair until claimed.

```mermaid
sequenceDiagram
  autonumber
  participant U as Sender Wallet
  participant App as Browser App<br/>(create-link-form.tsx)
  participant LS as LocalStorage
  participant Sol as Solana RPC

  App->>App: generateEphemeralKey() — 32 random bytes
  App->>U: build SystemProgram.transfer<br/>sender → ephemeral (+ SPL ix if token)
  U->>Sol: sign + submit (sender pays gas)
  Sol-->>App: confirmed
  App->>App: serializeUmbraNote<br/>fundsLocation = "ephemeral"
  App->>LS: encrypted saveLink (PBKDF2(walletAddr))
  App-->>U: claim URL + QR (hash carries ephemeral seed)
```

### 1B — Create Link, Private mode (mixer hides sender, SOL only)

Sender publicly funds an ephemeral. Ephemeral then deposits into Umbra's encrypted pool with a Groth16 proof. No Hoppy backend involved.

```mermaid
sequenceDiagram
  autonumber
  participant U as Sender Wallet
  participant App as Browser App
  participant Eph as Ephemeral Keypair
  participant ZK as Web ZK Prover (CDN /umbra-zk)
  participant Umbra as Umbra Program

  App->>App: generateEphemeralKey()
  Note over App: total = wrapAmount + WSOL_ATA_RENT (0.00204)<br/>+ EPHEMERAL_GAS_BUFFER (0.012 SOL)
  App->>U: SystemProgram.transfer sender → eph (total)
  U->>Umbra: sign + submit
  Note over U,Umbra: chain sees sender → eph<br/>(only public on-chain link to sender)

  App->>Eph: build wrap tx<br/>create wSOL ATA + transfer + syncNative
  Eph->>Umbra: sendAndConfirm (eph pays its own gas)

  App->>ZK: load registration prover + CDN ZK assets
  App->>Umbra: ensureRegistered(eph)<br/>up to 3 anonymous reg txs (idempotent)
  App->>ZK: load createSelfClaimableUtxoFromPublicBalance prover
  Note over App,ZK: Groth16 proof in browser (~30s)
  App->>Umbra: createUtxo(amount, dest=eph, WSOL) — queue tx
  Umbra-->>Umbra: Arcium MPC callback tx mines<br/>encrypted UTXO credited

  App->>App: serializeUmbraNote (fundsLocation = "pool")
  App-->>U: claim URL (hash = ephemeral seed)
```

### 1C — Quick Claim (basic note, or private note where recipient forfeits pool)

Drains the ephemeral's leftover native SOL + closes its wSOL ATA. One tx, no Umbra. Recipient never signs.

```mermaid
sequenceDiagram
  autonumber
  participant R as Recipient (address only)
  participant App as Browser App (claim-flow.tsx)
  participant Eph as Ephemeral Keypair (decoded from URL hash)
  participant Sol as Solana RPC

  App->>App: extractNoteFromUrl + decodeCompositeSecret
  Note over App: drainEphemeralToRecipient<br/>(claim-flow.tsx:43)
  App->>Eph: build tx — closeAccount(wSOL ATA)<br/>+ transfer all SOL → recipient
  Eph->>Sol: sign + submit (eph pays gas)
  Sol-->>R: funds delivered
```

### 1D — Private Claim (note.fundsLocation = "pool", isSOL)

Recipient is invisible to chain observers and to the sender. Self-claimable path (personal send) vs receiver-claimable path (payroll/card links coming through /claim) diverge at the indexer scan.

```mermaid
sequenceDiagram
  autonumber
  participant R as Recipient (address only)
  participant App as Browser App
  participant Eph as Ephemeral / Stealth
  participant Idx as Umbra Indexer
  participant ZK as Web ZK Prover
  participant UR as Umbra Relayer
  participant Umbra as Umbra Program

  App->>App: decodeCompositeSecret → keypair
  App->>Umbra: getUmbraConfigForNetwork(note.network)<br/>+ createUmbraClientFromKeypair

  loop scan with backoff [0, 3s, 5s, 8s, 12s]
    App->>Idx: ClaimableUtxoScanner(keypair)
  end

  alt UTXO in selfBurnable / publicSelfBurnable<br/>(personal-send create path)
    App->>ZK: claimSelfClaimableIntoPublicBalance prover
    App->>UR: SelfClaimable...Claimer(claimFn)
    UR->>Umbra: claim tx (UR pays gas, takes ~0.21%)
    Umbra-->>App: wSOL credited to public balance
  else UTXO in received / publicReceived<br/>(payroll or card link)
    App->>ZK: claimReceiverIntoEncrypted prover
    App->>UR: claim into encrypted balance
    UR->>Umbra: claim tx
    loop poll [0,2,3,5,7,10s]
      App->>Umbra: getEncryptedBalance(keypair)
    end
    App->>Umbra: encrypted → public direct withdraw
  end

  App->>Eph: close wSOL ATA + transfer all SOL → recipient
  Eph-->>R: funds delivered
```

### 1E — Reclaim (orphan ephemeral recovery, /reclaim)

For when a deposit signed but the create-UTXO step failed. Recovery key is saved to localStorage as `hoppy_recovery_v1`.

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant App as /reclaim
  participant Eph as Pasted Keypair
  participant Sol as Solana RPC

  U->>App: paste base58 private key
  App->>Sol: handleCheck — getBalance + getATA
  U->>App: confirm reclaim
  App->>Eph: close ATA + transfer SOL → destination (fee-exact)
  Eph->>Sol: sign + submit
  Sol-->>U: funds returned
```

---

## 2. Private Payroll (SOL only, always private)

### 2A — Top-up Deposit

Business signs ONE SystemProgram.transfer into a deterministic escrow keypair. Server wraps to wSOL and deposits to encrypted balance.

```mermaid
sequenceDiagram
  autonumber
  participant B as Business Wallet
  participant UI as Payroll Dashboard
  participant API as /api/umbra/payroll/*
  participant E as Payroll Escrow<br/>(server keypair)
  participant Umbra as Umbra Program

  UI->>API: GET escrow-address?businessWallet
  Note over API: getEscrowAddress = SHA-256(masterKey ‖ businessWallet)
  API-->>UI: escrowAddress

  Note over UI: delta = totalLamports − poolBalance<br/>+ N × STEALTH_FUND_BUDGET (0.03)<br/>+ ESCROW_BUFFER (0.2 SOL)
  UI->>B: SystemProgram.transfer business → escrow (delta)
  B-->>UI: signed + confirmed (business pays gas)

  UI->>API: POST /payroll/deposit {signedDepositTxHash}
  API->>API: confirmSolTransferTo (meta delta check)
  API->>E: wrapSol(delivered − ESCROW_BUFFER)
  API->>Umbra: ensureRegistered(escrow)
  API->>Umbra: public → encrypted balance<br/>(queue + Arcium callback)
  API->>API: confirmCallbackOnChain + verifyEncryptedBalance
  API-->>UI: poolPositionId + tx hashes
```

### 2B — Issue Link (per recipient, server-side)

One POST per CSV row. Server-side Groth16 proof (30–120s each).

```mermaid
sequenceDiagram
  autonumber
  participant UI as Dashboard
  participant API as /api/umbra/payroll/issue-link
  participant E as Escrow
  participant S as Per-recipient Stealth<br/>(fresh 32B seed)
  participant Umbra as Umbra Program
  participant Idx as Umbra Indexer

  UI->>API: POST {businessWallet, amount, from}
  API->>API: random 32B → stealthKeypairFromSeed
  API->>E: transferSol escrow → stealth (0.03 SOL gas budget)
  Note over API,Umbra: stealth MUST be registered BEFORE UTXO is created<br/>(commit b0328e9 — escrow encrypts to stealth's viewing key)
  API->>Umbra: ensureRegistered(stealth)
  API->>Umbra: ensureRegistered(escrow) — refresh
  API->>Umbra: verifyEncryptedBalance(escrow)

  Note over API: ZK prove createReceiverClaimableUtxo (30–120s)
  API->>Umbra: createUtxo(amount, dest=stealth, WSOL) — queue
  Umbra-->>Umbra: Arcium callback mines (90s budget)
  loop indexer visibility wait (90s budget, 3s poll)
    API->>Idx: scanner(stealth)
  end

  API->>API: serialize as UmbraNote<br/>(fundsLocation="pool", secret=bs58(stealthSeed))
  API-->>UI: { /claim#<note>, issueTxHash }
```

### 2C — Recipient Claim

Shares /claim with personal sends. UTXO lands in `received` bucket → receiver-claimable path. See Diagram 1D (right branch).

### 2D — Bulk Refund (drain unissued escrow)

Recovers everything still inside the escrow keypair. Cannot recover already-issued links — only the URL holder has the stealth seed.

```mermaid
sequenceDiagram
  autonumber
  participant UI as Dashboard
  participant API as /api/umbra/payroll/refund
  participant E as Escrow
  participant Umbra as Umbra Program
  participant B as Business Wallet

  UI->>API: POST refund
  alt encrypted balance > 0
    API->>Umbra: encrypted → public direct withdraw
  end
  API->>E: unwrapAllWsol (close ATA + recover rent)
  API->>B: transferSol escrow → business (nativeBal − 5000)
  API-->>UI: { encryptedWithdrawn, nativeRefunded, refundTxHash }
```

---

## 3. Gift Cards via Bitrefill (SOL only, server-orchestrated)

### 3A — Order Creation

Server-side escrow + stealth keypairs per order. Deposit amount is jittered (+0.002–0.006 SOL) so the on-chain amount doesn't match the Bitrefill invoice.

```mermaid
sequenceDiagram
  autonumber
  participant U as User Wallet
  participant UI as Card UI
  participant API as /api/card/*
  participant BR as Bitrefill API
  participant DB as Postgres
  participant E as Per-order Escrow

  UI->>API: GET /products, /product-details
  API->>BR: GET /v2/products, /v2/products/<slug>?currency=SOL
  BR-->>UI: catalog + price range

  UI->>API: POST /gift-order<br/>{amount, slug, userAddress, prepayment?}
  API->>BR: getProductDetails (validate range)
  opt prepayment required
    loop ≤6 steps
      API->>BR: submitPrepaymentStep
      alt needs more fields
        API-->>UI: 422 needsForm
      end
    end
  end
  API->>BR: createInvoice (paymentMethod="solana", webhookUrl)
  BR-->>API: paymentAddress + paymentLamports

  Note over API: getCardEscrowAddress(orderId)<br/>computeDepositLamports = bitrefill + 0.04 overhead + jitter
  API->>DB: createOrder (status=pending)
  API-->>UI: { orderId, escrowAddress, depositLamports }

  UI->>U: SystemProgram.transfer user → escrow
  U-->>UI: signed + confirmed
```

### 3B — Private Execute (the 13-step orchestration)

Fire-and-forget POST returns 202; server runs the pipeline. Result: chain shows two **disjoint** graphs — `(user → escrow → user refund)` and `(relayer → stealth → bitrefill)` — connected only inside the encrypted UTXO.

```mermaid
sequenceDiagram
  autonumber
  participant UI as Card UI
  participant API as /api/card/private-execute
  participant E as Escrow (server)
  participant S as Stealth (server)
  participant H as Hoppy Relayer
  participant Umbra as Umbra Program
  participant Idx as Umbra Indexer
  participant BR as Bitrefill SOL address
  participant U as User Wallet
  participant DB as Postgres

  UI->>API: POST /private-execute (depositTxHash)
  API-->>UI: 202 (fire-and-forget)

  Note over API,DB: status = depositing
  API->>API: 1. confirmSolTransferTo (user → escrow)
  API->>Umbra: 2. ensureRegistered(escrow)
  API->>E: 3. wrapSol(balance − 0.025 buffer)

  Note over API,DB: status = mixing
  API->>Umbra: 4. escrow public → encrypted (queue + callback, 90s)

  API->>H: 5. relayer.transferSol → stealth (0.025 SOL)
  Note over H,S: chain edge: relayer → stealth<br/>(NO link from escrow)
  API->>Umbra: 6. ensureRegistered(stealth) — before UTXO
  Note over API: utxoAmount = floor(bitrefillLamports × 1.005)
  API->>Umbra: 7. escrow createUtxo to stealth<br/>(receiver-claimable, callback 120s)

  Note over API,DB: status = withdrawing
  loop waitForUtxoVisible (180s)
    API->>Idx: scanner(stealth)
  end
  API->>Umbra: 8. stealth claim → encrypted balance (callback 90s)
  API->>Umbra: 9. stealth encrypted → public withdraw bitrefillLamports
  API->>S: 10. unwrapAllWsol(stealth)

  Note over API,DB: status = paying
  API->>BR: 11. stealth.transferSol → bitrefillAddress<br/>(EXACT bitrefillLamports)

  API->>U: 12. escrow sweep leftover → user (auto-refund)
  API->>H: 13. stealth sweep leftover → relayer
  Note over API,DB: status = paid
```

### 3C — Bitrefill Fulfillment (webhook + polling fallback)

Bitrefill notifies via webhook when redemption details are ready. A cron-driven `/poll-bitrefill` covers missed webhooks. AES-256-GCM key lives only in the claim URL fragment — server never persists it.

```mermaid
sequenceDiagram
  autonumber
  participant BR as Bitrefill
  participant WH as /api/card/bitrefill-webhook
  participant Cron as /api/card/poll-bitrefill<br/>(cron fallback, Bearer auth)
  participant DB as Postgres

  alt webhook
    BR->>WH: POST {invoice_id} + HMAC-SHA256
    WH->>WH: verifyWebhookSignature (BITREFILL_WEBHOOK_SECRET)
  else polling
    Cron->>WH: iterate pending + paid orders (shared fulfillOrder)
  end

  WH->>BR: getInvoice + getBitrefillOrder<br/>(include_redemption_info=true)
  WH->>WH: extractRedemption → CardDetails
  WH->>WH: generateEncryptionKey (AES-256-GCM)
  WH->>WH: encryptCardDetails → {iv, data, tag}
  WH->>WH: createClaimLink = /card/claim#<orderId>.<base64url-key>
  WH->>DB: updateOrder(status=ready, encryptedCard, claimLink)
  WH->>DB: increment links_created
  Note over WH: AES key lives in URL fragment only
```

### 3D — Card Claim

Server returns ciphertext; browser decrypts with the URL-fragment key.

```mermaid
sequenceDiagram
  autonumber
  participant Buyer as Browser
  participant API as /api/card/claim
  participant DB as Postgres

  Buyer->>Buyer: parseClaimHash(window.location.hash) → {orderId, key}
  Buyer->>API: GET ?id=orderId
  API->>DB: load order (require status = ready | claimed)
  API->>DB: set status=claimed, increment links_claimed
  API-->>Buyer: encryptedCard {iv, data, tag}
  Note over Buyer: Web Crypto AES-GCM decrypt — server never sees key
  Buyer->>Buyer: render code / PIN / URL / instructions
```

### 3E — Card Refund (pre-fulfillment only)

Wallet must sign a refund challenge. Refund drains BOTH escrow and stealth keypairs (failure could leave funds in either).

```mermaid
sequenceDiagram
  autonumber
  participant U as User Wallet
  participant UI as Card UI
  participant API as /api/card/refund
  participant E as Order Escrow
  participant S as Order Stealth
  participant Umbra as Umbra Program

  UI->>API: GET ?orderId → {canRefund, challenge}
  UI->>U: signMessage("hoppy-card-refund:<orderId>:<addr>")
  U-->>UI: signature (base58)
  UI->>API: POST {orderId, challenge, signature}
  API->>API: nacl.sign.detached.verify<br/>(reject if status ready|claimed)

  par drain escrow
    alt encrypted balance > 0
      API->>Umbra: escrow encrypted → public withdraw
    end
    API->>E: unwrapAllWsol + transfer → user
  and drain stealth
    alt encrypted balance > 0
      API->>Umbra: stealth encrypted → public withdraw
    end
    API->>S: unwrapAllWsol + transfer → user
  end
  API-->>UI: status=refunded + refundTxHash
```

---

## 4. Cross-cutting

### 4A — ZK Prover Map

```mermaid
flowchart LR
  R[getUserRegistrationProver] -->|anonymous registration| All

  CS[getCreateSelfClaimable<br/>UtxoFromPublicBalance] -->|browser, personal send create| PS[Personal Send 1B]
  CR[getCreateReceiverClaimable<br/>UtxoFromEncryptedBalance] -->|server, payroll + card create| PR[Payroll 2B / Card step 7]

  KS[getClaimSelfClaimable<br/>UtxoIntoPublicBalance] -->|browser, personal claim self-bucket| PC[Personal Claim 1D-self]
  KR[getClaimReceiverClaimable<br/>UtxoIntoEncryptedBalance] -->|browser + server, receiver-bucket| BR[Payroll Claim / Card step 8]
```

### 4B — Privacy & Trust Comparison

| Flow | Token | Sender visible? | Recipient visible? | ZK proofs | Custody | Key holder |
|---|---|---|---|---|---|---|
| Personal — Basic | SOL/USDC/USDT | yes (sender → eph) | yes (eph → recipient) | none | non-custodial | URL holder |
| Personal — Private + Quick claim | SOL | partial (funded eph) | yes (eph → recipient) | 2× (sender deposit) | non-custodial | URL holder |
| Personal — Private + Private claim | SOL | partial (funded eph) | NO | 4× | non-custodial | URL holder |
| Payroll claim (always private) | SOL | partial (business → escrow once) | NO | per-link Groth16 | server-custodial escrow | URL holder + server (for unissued) |
| Gift card | SOL | partial (user → escrow) | recipient = Bitrefill | per-order Groth16 | server-custodial (escrow + stealth) | server only |

### 4C — On-chain Edges Visible to Observers

```mermaid
flowchart LR
  subgraph BasicSend[Personal Basic]
    direction LR
    s1[sender] --> e1[eph] --> r1[recipient]
  end

  subgraph PrivateSend[Personal Private + Private Claim]
    direction LR
    s2[sender] --> e2[eph]
    e2 -. ZK / encrypted UTXO .-> pool2((Umbra pool))
    pool2 -. ZK / encrypted UTXO .-> e3[eph]
    e3 --> r2[recipient]
  end

  subgraph Card[Gift Card]
    direction LR
    u[user] --> es[escrow] --> u2[user refund]
    rel[hoppy relayer] --> st[stealth] --> br[Bitrefill]
    es -. encrypted UTXO .-> st
  end
```

### 4D — Limitations vs Personal Sends

| Capability | Personal | Payroll | Gift Card |
|---|---|---|---|
| Tokens | SOL / USDC / USDT | SOL only | SOL only |
| Basic (non-private) mode | yes | no | no |
| Custody | non-custodial | server holds escrow | server holds escrow + stealth |
| ZK location | browser | server | server |
| Time per issue | ~30s | 30–120s per row | 3–5 min orchestration |
| Refundable by sender | recall via own claim | yes (bulk, unissued) | yes (pre-fulfillment only) |

---

## 5. File-path Index (quick jump)

**Personal send**
- `src/app/create/components/create-link-form.tsx` — `handleDeposit:487`, basic `:652`, private `:543`
- `src/lib/privacy/umbra-adapter.ts` — `generateEphemeralKey:441`, `serializeUmbraNote:546`, `createUmbraClientFromKeypair:702`, `ensureRegistered:800`

**Personal claim**
- `src/app/claim/components/claim-flow.tsx` — `handleClaim:303`, `drainEphemeralToRecipient:43`, receiver branch `:502`, self branch `:650`
- `src/app/reclaim/components/reclaim-page.tsx` — orphan ephemeral recovery

**Payroll**
- `src/app/payroll/components/payroll-dashboard.tsx` — `generate:160`, `handleRefund:59`
- `src/app/api/umbra/payroll/{escrow-address,deposit,issue-link,refund}/route.ts`
- `src/lib/umbra/adapter.ts` — `umbraPayrollDeposit:402`, `umbraPayrollIssueLink:545`, `umbraPayrollRefund:788`
- `src/lib/umbra/keys.ts` — `deriveEscrowSeed:32`, `stealthKeypairFromSeed:50`

**Gift card**
- `src/app/card/components/product-detail-flow.tsx` — `handleCreateOrder:446`, `handleRefund:580`
- `src/app/api/card/{gift-order,private-execute,status,bitrefill-webhook,poll-bitrefill,claim,refund}/route.ts`
- `src/lib/card/umbra-pay.ts` — `umbraCardExecute:360` (13-step), `umbraCardRefund:693`, `computeDepositLamports:138`
- `src/lib/card/bitrefill.ts`, `encryption.ts`, `client-decryption.ts`, `storage.ts`, `db.ts`

**Relayer**
- `src/app/api/relayer/fund-gas/route.ts` (idle today; reserved for SPL flows)
- `src/app/api/relayer/status/route.ts`
