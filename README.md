# hoppy

**Privacy-First Payments on Solana**

Send crypto to anyone without revealing the link between sender and recipient. Share a claim link. They withdraw. No trace.

[![Live on Mainnet](https://img.shields.io/badge/Live-Mainnet-brightgreen)](https://hoppy.lol)
[![Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js%2015-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[**Live Demo**](https://hoppy.lol) · [**Watch Demo Video**](#) · [**Roadmap**](https://hoppy.lol/roadmap)

---

`solana` `privacy` `zk-compression` `payments` `defi` `web3` `hackathon`

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Demo](#demo)
- [Features](#features)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Security Model](#security-model)
- [Tech Stack](#tech-stack)
- [Roadmap](#roadmap)
- [Acknowledgments](#acknowledgments)

---

## The Problem

On-chain payments are **completely transparent**. Every transaction is permanently visible:

- Anyone can see who paid whom
- Wallet addresses become linked identities
- Payment history is exposed forever
- No way to send money privately without complex tooling

This transparency prevents legitimate use cases: private donations, confidential payroll, gifts without revealing your wallet, and basic financial privacy.

## The Solution

hoppy makes private payments as simple as sharing a link.

Instead of sending directly to a wallet address, you deposit funds into a **shielded pool** and receive a **claim link**. Share that link with anyone—they connect their wallet and withdraw. On-chain, there's no connection between sender and recipient.

**Create a private payment in 10 seconds. No trace left behind.**

---

## Demo

### For Hackathon Judges

1. Open [hoppy.lol/create](https://hoppy.lol/create)
2. Connect your wallet (or sign in with email)
3. Enter an amount and click **"Create Private Link"**
4. Copy the claim link
5. Open the link in an incognito window
6. Connect a different wallet and claim the funds

**That's it.** The deposit and withdrawal are unlinkable on-chain.

---

## Features

| Feature | Description |
|---------|-------------|
| **Private Payments** | Deposits and withdrawals are cryptographically unlinkable |
| **Claim Links** | Share via text, email, or QR code—recipient claims to any wallet |
| **No Seed Phrases** | Sign in with email, Google, or existing wallet |
| **QR Codes** | Generate scannable codes for mobile claiming |
| **Virtual Cards** | Convert shielded crypto to Visa/Mastercard *(in progress)* |
| **Gift Card Payouts** | Redeem to Amazon, Uber, DoorDash *(in progress)* |
| **Live on Mainnet** | Real SOL, real privacy, production-ready |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SENDER DEVICE                                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   Connect       │───▶│   Enter Amount  │───▶│   Deposit to Pool       │  │
│  │   Wallet        │    │                 │    │   (ZK Shielded)         │  │
│  └─────────────────┘    └─────────────────┘    └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                          Claim Link Generated
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SHIELDED POOL                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │   Commitment Storage  │  Nullifier Tracking  │  ZK Proof Verification │  │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│   On-chain: Only sees deposits IN and withdrawals OUT (no link between)     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                          Recipient Opens Link
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RECIPIENT DEVICE                                  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   Open Claim    │───▶│   Connect Any   │───▶│   Withdraw from Pool    │  │
│  │   Link          │    │   Wallet        │    │   (Funds Received)      │  │
│  └─────────────────┘    └─────────────────┘    └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## How It Works

### Sending a Private Payment

```
User connects wallet
    ↓
Enters amount (e.g., 0.5 SOL)
    ↓
Funds deposited to shielded pool
    ↓
Cryptographic claim link generated
    ↓
User shares link with recipient
    ↓
✓ No on-chain connection to recipient
```

### Claiming Funds

```
Recipient opens claim link
    ↓
Connects their wallet (any wallet)
    ↓
Clicks "Claim Funds"
    ↓
ZK proof verified on-chain
    ↓
Funds withdrawn to recipient wallet
    ↓
✓ Nullifier prevents double-claiming
```

### Privacy Guarantee

| Observer | Can See |
|----------|---------|
| **Blockchain** | Deposit to pool ✓, Withdrawal from pool ✓, **Link between them ✗** |
| **Sender** | Recipient's address (only after they claim) |
| **Recipient** | Only that they received funds |

---

## Quick Start

### Prerequisites

- Node.js 22+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/AgroTree-Ledger/hoppy.git
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
NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Network
NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta
```

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

```
hoppy/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── page.tsx             # Landing page
│   │   ├── create/              # Create private payment
│   │   ├── claim/               # Claim funds
│   │   ├── card/                # Virtual cards (WIP)
│   │   ├── roadmap/             # Project roadmap
│   │   └── api/                 # API routes
│   │       ├── privacy-cash/    # Shielded pool integration
│   │       │   ├── create-link/ # Create deposit + claim link
│   │       │   └── claim/       # Process claim
│   │       ├── card/            # Virtual card issuance
│   │       └── sol-price/       # Price feed
│   │
│   ├── components/
│   │   ├── create/              # Deposit flow UI
│   │   ├── claim/               # Claim flow UI
│   │   ├── card/                # Card purchase UI
│   │   └── ui/                  # Reusable components
│   │
│   └── lib/
│       ├── privacy/             # Privacy pool SDK integration
│       ├── solana/              # Solana utilities
│       └── card/                # Card issuance logic
│
├── public/                       # Static assets
├── .env.example                  # Environment template
└── package.json
```

---

## Security Model

| Layer | Protection |
|-------|------------|
| **Privacy Pool** | ZK-compressed state, cryptographic commitments, unlinkable deposits/withdrawals |
| **Claim Links** | Cryptographic secret in URL hash—only link holder can claim |
| **Nullifiers** | Each claim link can only be used once—prevents double-spending |
| **No Custody** | Funds flow directly through on-chain pool—hoppy never holds your crypto |
| **Open Source** | All code is auditable |

### Threat Model

- **Claim link is the secret** — Anyone with the URL can claim. Share securely.
- **Sender visibility** — Sender learns recipient's address after claim (accepted tradeoff)
- **Pool privacy** — On-chain observers cannot link sender to recipient

---

## Tech Stack

**Frontend**
- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- Framer Motion

**Blockchain**
- Solana Web3.js
- Light Protocol (ZK Compression)
- Helius RPC

**Authentication**
- Embedded wallets + social login
- External wallet support (Phantom, Solflare, etc.)

**Infrastructure**
- PostgreSQL (card order tracking)
- Vercel / Railway deployment

---

## Roadmap

### In Progress
- [ ] Partial withdrawals — claim only a portion, leave the rest
- [ ] Multi-token support — USDC, USDT, BONK, SPL tokens
- [ ] Virtual debit cards — shielded crypto to Visa/Mastercard
- [ ] Gift card payouts — Amazon, Uber, DoorDash
- [ ] Claim expiration — auto-refund unclaimed links

### Up Next
- [ ] Split claims — one deposit → multiple claim links
- [ ] Stealth addresses — one-time recipient addresses
- [ ] Recall payments — cancel unclaimed links
- [ ] Viewing keys — optional compliance/audit capability
- [ ] Conditional release — oracle-based fund release

### Future
- [ ] x402 Protocol — HTTP 402 payments for AI agents
- [ ] Agent wallets — autonomous AI spending
- [ ] EVM support — Ethereum, Base, Arbitrum, Polygon
- [ ] Cross-chain swaps — swap + shield in one transaction

---

## Acknowledgments

- **Light Protocol** — ZK compression infrastructure
- **Helius** — Reliable Solana RPC
- **Solana Foundation** — Hackathon sponsorship

---

## Links

- **Live Demo:** [hoppy.lol](https://hoppy.lol)
- **GitHub:** [github.com/hamzaskewl/hoppy](https://github.com/hamzaskewl/hoppy)
- **Twitter:** [@hoppyprivacy](https://x.com/hoppyprivacy)
- **Roadmap:** [hoppy.lol/roadmap](https://hoppy.lol/roadmap)

---

<p align="center">
  <img src="public/hoppy-logo.png" alt="hoppy" width="80" />
  <br /><br />
  <strong>Load. Redeem. Privately.</strong>
  <br /><br />
  Built for the Solana Hackathon
</p>

---

> ⚠️ **Hackathon Software Notice:** This project was built during a hackathon. While it is live on mainnet and functional, it has not been formally audited. Use at your own risk and with amounts you're comfortable with.
