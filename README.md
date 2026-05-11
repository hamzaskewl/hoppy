# hoppy

**Privacy-First Payments on Solana**

Sending crypto shouldn't require the recipient to have a wallet set up, share their address, or expose their identity. With hoppy, you just share a link. The money is in the link. They claim it privately.

[![Live on Devnet](https://img.shields.io/badge/Live-Devnet-blue)](https://hoppy.cash)
[![Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js%2015-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[**Live Demo**](https://hoppy.cash) · [**Watch Demo Video**](https://www.youtube.com/watch?v=6PiOxw07JJ4) · [**Roadmap**](https://hoppy.cash/roadmap)

---

`solana` `privacy` `stealth-addresses` `zk` `payments` `payroll` `web3`

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Demo](#demo)
- [Features](#features)
- [How It Works](#how-it-works)
  - [Stealth-Address Privacy](#stealth-address-privacy)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Security Model](#security-model)
- [Tech Stack](#tech-stack)
- [Roadmap](#roadmap)
- [Acknowledgments](#acknowledgments)

---

## The Problem

Sending crypto is harder than it should be:

- Recipient needs a wallet already set up
- You need to ask for their address (awkward, error-prone)
- If you send to the wrong address, funds are gone forever
- Every transaction is publicly visible on-chain
- Your wallet history becomes your financial identity

This friction prevents everyday use cases: sending money to friends, private gifts, paying someone who doesn't have crypto yet, running payroll without exposing every employee's salary on-chain.

## The Solution

hoppy lets you send crypto by sharing a link.

You deposit funds into an encrypted Umbra UTXO and get a claim link. Share that link with anyone via text, email, or QR code. They open it, connect any wallet, and the funds are routed to them through a stealth address. The deposit and the withdrawal don't have a direct on-chain edge — observers can't connect sender to recipient.

**No address needed. No wallet required upfront. Complete privacy.**

---

## Demo

### For Testers

1. Open [hoppy.cash/create](https://hoppy.cash/create)
2. Connect your wallet or sign in with email
3. Enter an amount and click **"Create Private Link"**
4. Copy the claim link
5. Open the link in another tab or on your phone with a different wallet
6. Connect and claim the funds

**That's it.** The deposit and withdrawal are unlinkable on-chain.

---

## Features

| Feature | Description |
|---------|-------------|
| **Link-Based Payments** | Send money by sharing a link, no recipient address needed |
| **Stealth-Address Privacy** | On-chain observers cannot link sender to recipient |
| **No Wallet Required** | Recipients can sign in with email to create a wallet instantly |
| **QR Code Sharing** | Generate scannable codes for mobile claiming |
| **Gasless Claims** | Recipients don't need SOL to claim; the relayer subsidizes fees |
| **Recipient Privacy Choice** | Recipients can choose Quick (cheaper) or Private (hidden from sender) |
| **Private Payroll** | Upload a CSV, fund one escrow, mint a claim link per employee. Refunds unclaimed funds. |
| **Multi-Token** | SOL, USDC, USDT on Solana devnet |
| **Virtual Cards & Gift Cards** | Buy Visa, Mastercard, Amazon, Uber, DoorDash, Starbucks, and 100+ other brands privately via Bitrefill |
| **Live on Devnet** | Battle-testing the full flow on Solana devnet before mainnet |

---

## How It Works

<p align="center">
  <img src="public/howitworks.svg" alt="How hoppy works" width="100%" />
</p>

### Stealth-Address Privacy

hoppy is built on top of the [Umbra](https://umbra.cash) privacy SDK, which combines stealth addresses with encrypted UTXOs.

**Sender Side:**
1. Sender deposits funds into Umbra's encrypted balance, bound to an ephemeral keypair
2. The on-chain artifact is ciphertext — amount and destination aren't visible to outside observers
3. The ephemeral keypair seed is encoded into the URL hash of the claim link

**Recipient Side:**
1. Recipient opens the claim link; the app extracts the ephemeral key from the URL hash
2. The encrypted UTXO is unlocked and routed to the recipient via a fresh stealth address
3. A relayer covers gas, so recipients don't need any SOL to claim

**Why Neither Party Can Trace:**
- **On-chain observers** see a deposit into ciphertext and an unrelated withdrawal to a fresh stealth address. There's no direct edge connecting the two.
- **Sender** doesn't have the recipient's claim destination, only the link.
- **Recipient** doesn't know which deposit funded their UTXO.

ZK proofs (Groth16) guarantee the math is correct — the deposit was legitimately encrypted, the withdrawal corresponds to a real UTXO that hasn't been claimed before — without revealing the participants.

### Sending a Payment

1. Connect your wallet (or sign in with email)
2. Enter the amount you want to send
3. Funds are deposited into Umbra's encrypted balance
4. You receive a claim link with the ephemeral key embedded in the URL hash
5. Share the link however you want (text, email, QR)

### Claiming Funds

1. Recipient opens the claim link
2. Connects any wallet (or creates one with email)
3. Chooses privacy level (Quick or Private)
4. Clicks "Claim" and funds arrive in their wallet
5. No SOL needed for gas — the relayer pays transaction fees

### Privacy Levels

| Level | What Happens | Who Can See Recipient |
|-------|--------------|----------------------|
| **Quick Claim** | Direct withdrawal to recipient's wallet, cheaper | Sender can see if they check |
| **Private Claim** | Routes through Umbra's mixer first, then to recipient | Nobody, not even sender |

### Private Payroll

For paying multiple recipients in one go:

1. Upload a CSV with names and amounts
2. Sign **one** bulk deposit transaction into a deterministic Umbra escrow tied to your wallet
3. The server mints a self-claimable UTXO per recipient and returns one claim link each
4. Recipients claim through the same flow above
5. Anything left unclaimed can be refunded to your wallet at any time

Each ZK proof for link generation takes ~30–120s server-side, so larger payrolls take a moment to issue.

### Private Virtual Gift Cards

For buying gift cards (Visa, Mastercard, Amazon, Uber, etc.) without leaving an on-chain trail to the merchant:

1. Pick a brand and amount from the Bitrefill catalog (`/card`)
2. SOL deposit lands in a per-order Umbra escrow — not a public Bitrefill address
3. The escrow privately routes funds: encrypted balance → receiver-claimable UTXO → fresh stealth wallet → Bitrefill
4. Once Bitrefill fulfills, the redemption code is encrypted with a per-order key and surfaced as a `/card/claim#<key>` link
5. Recipient opens the link; card details are decrypted **client-side** — the server never sees the key

On-chain observers see your deposit into an ephemeral escrow and an unrelated stealth wallet paying Bitrefill. The link between you and the gift card is broken at the Umbra layer.

---

## Quick Start

### Prerequisites

- Node.js 22+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/hamzaskewl/hoppy.git
cd hoppy

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
```

### Environment Variables

```env
# Required
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
NEXT_PUBLIC_SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY

# Network — currently devnet; switch to mainnet-beta when ready
NEXT_PUBLIC_SOLANA_NETWORK=devnet
UMBRA_NETWORK=devnet

# Payroll & card escrows (server-side keypair derivation)
UMBRA_ESCROW_MASTER_KEY=...           # 64 hex chars (openssl rand -hex 32)

# Gift card flow
BITREFILL_API_KEY=...
```

> See `.env.example` for the full list of environment variables including PostgreSQL, the relayer wallet, and Bitrefill webhook configuration.

### Run Locally

```bash
npm run dev
# Open http://localhost:3000
```

### Build for Production

```bash
npm run build
npm start
```

---

## Project Structure

Each route is self-contained: `page.tsx` is a thin wrapper that imports its UI from a colocated `components/` folder. `src/components/` is reserved for genuinely shared code only.

```
hoppy/
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── page.tsx                     # Landing
│   │   ├── components/                  # Landing-only components (hero, bento, carousel)
│   │   ├── create/                      # Send private payment
│   │   │   └── components/
│   │   ├── claim/                       # Claim private payment
│   │   │   └── components/
│   │   ├── card/                        # Virtual gift cards (Bitrefill catalog)
│   │   │   ├── components/              # Catalog, product detail flow
│   │   │   └── claim/                   # Decrypt + display card details
│   │   │       └── components/
│   │   ├── payroll/                     # Bulk private payroll dashboard
│   │   │   ├── components/              # Dashboard, CSV import, employee table, history
│   │   │   └── claim/                   # Legacy redirect → /claim
│   │   ├── reclaim/                     # Manual ephemeral-wallet recovery
│   │   ├── how-it-works/
│   │   ├── roadmap/
│   │   └── api/
│   │       ├── card/                    # Bitrefill orchestration:
│   │       │                            #   products, product-details, gift-order,
│   │       │                            #   private-execute, status, claim,
│   │       │                            #   bitrefill-webhook, poll-bitrefill, refund
│   │       ├── umbra/payroll/           # Bulk issuance: deposit, issue-link, refund, escrow-address
│   │       ├── relayer/                 # Gas-funding relayer for SPL claims
│   │       ├── telegram/                # Telegram bot webhook
│   │       └── sol-price, stats, health
│   │
│   ├── components/                       # Truly shared (cross-route) only
│   │   ├── nav-header.tsx
│   │   ├── wallet-button.tsx
│   │   ├── providers.tsx
│   │   └── ui/                          # Button, Card, Input primitives
│   │
│   └── lib/
│       ├── card/                        # Bitrefill client, Umbra-pay orchestration, AES encryption, Postgres storage
│       ├── umbra/                       # Server-side Umbra adapter (payroll + per-order card escrows)
│       ├── privacy/                     # Client-side Umbra adapter (/create + /claim)
│       ├── payroll/                     # CSV parsing, batch types
│       ├── solana/                      # RPC helpers
│       └── telegram/                    # grammy bot
│
├── public/                               # Static assets (bunny art, partner logos, ZK assets)
├── .env.example                          # Environment template
└── package.json
```

---

## Security Model

| Layer | Protection |
|-------|------------|
| **Encrypted UTXOs** | Amounts and destinations are stored as ciphertext on-chain |
| **Stealth Addresses** | Each withdrawal lands at a fresh address derived from a viewing key |
| **ZK Proofs (Groth16)** | Registration, deposit, and claim each require a proof of correctness |
| **Claim Links** | Ephemeral key in the URL hash; only the link holder can derive the UTXO |
| **Nullifiers** | Each UTXO can only be claimed once, preventing double-spending |
| **No Custody (personal sends)** | Funds flow directly through Umbra; hoppy never holds your crypto |
| **Server-Held Escrow (payroll only)** | Payroll escrows are derived from a server master key for bulk issuance; refundable to the depositing wallet |
| **Open Source** | All code is auditable |

### Important Notes

- **Claim link is the secret.** Anyone with the URL can claim the funds. Share securely.
- **Quick claims are traceable.** If recipient chooses "Quick Claim", sender can see who claimed by checking the blockchain.
- **Private claims are hidden.** If recipient chooses "Private Claim", even the sender cannot see who received the funds.
- **Payroll escrow is custodial.** Payroll deposits are held in a server-controlled escrow until employees claim or you refund. Personal sends remain non-custodial.

---

## Tech Stack

**Frontend**
- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- Framer Motion

**Privacy Infrastructure**
- `@umbra-privacy/sdk` v4 — stealth addresses + encrypted UTXOs
- `@umbra-privacy/web-zk-prover` — client-side Groth16 proofs (WASM)
- Server-side Groth16 prover for payroll + card link issuance
- Helius RPC

**Gift Cards & Payments**
- Bitrefill REST API for catalog, invoice creation, and webhook fulfillment
- logo.dev for brand imagery in the product catalog
- Per-order Umbra escrow keypair to break the on-chain link between buyer and Bitrefill

**Authentication**
- Privy (embedded wallets + social login)
- External wallet support (Phantom, Solflare, etc.)

**Infrastructure**
- PostgreSQL `gift_card_orders` table on Railway (order lifecycle + encrypted card blobs)
- Railway deployment

---

## Roadmap

### Recently Completed
- [x] **Virtual Cards & Gift Card Payouts** - May 2026 - Bitrefill catalog (Visa, Mastercard, Amazon, Uber, DoorDash, +100 more) with private Umbra-mediated payment and client-side-decrypted claim links
- [x] **Private Payroll** - May 2026 - CSV bulk issuance, deterministic escrow, refund for unclaimed funds
- [x] **Network-aware claims** - May 2026 - Claim links carry their own network so cross-network deposits resolve correctly
- [x] **Cancel/Recall Payments** - February 4th, 2026 - Get back unclaimed funds, send to your wallet or a custom address
- [x] **Partial Claims** - February 4th, 2026 - Claim only a portion, get a new link for the remainder
- [x] **Multi-token support (USDC, USDT)** - February 3rd, 2026
- [x] **Relayer for SPL gas fees** - February 3rd, 2026 - Automatic SOL subsidies for stablecoin claims

### In Progress
- [ ] Mainnet launch — currently battle-testing the full flow on devnet
- [ ] Faster payroll proofs — trim server-side Groth16 time so large batches issue in seconds, not minutes

### Up Next
- [ ] Claim expiration with auto-refund
- [ ] Split claims (one deposit → multiple links)
- [ ] Viewing keys for compliance
- [ ] Conditional release

### Future
- [ ] x402 Protocol for AI agents
- [ ] Agent wallets
- [ ] Cross-chain swaps

---

## Acknowledgments

- **Umbra** - Stealth-address + encrypted UTXO privacy SDK
- **Helius** - Reliable Solana RPC
- **Solana Foundation** - Hackathon sponsorship

---

## Links

- **Live Demo:** [hoppy.cash](https://hoppy.cash)
- **GitHub:** [github.com/hamzaskewl/hoppy](https://github.com/hamzaskewl/)
- **Roadmap:** [hoppy.cash/roadmap](https://hoppy.cash/roadmap)

---

<p align="center">
  <img src="public/hoppy-logo.png" alt="hoppy" width="80" />
  <br /><br />
  <strong>Load. Redeem. Privately.</strong>
  <br /><br />
  Built for the Solana Hackathon
</p>

---

> ⚠️ **Hackathon Software Notice:** This project was built during a hackathon. While it is running on Solana devnet and functional, it has not been formally audited. Use at your own risk and with amounts you're comfortable with.
