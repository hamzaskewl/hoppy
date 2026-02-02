# hoppy

**Privacy-First Payments on Solana**

Sending crypto shouldn't require the recipient to have a wallet set up, share their address, or expose their identity. With hoppy, you just share a link. The money is in the link. They claim it privately.

[![Live on Mainnet](https://img.shields.io/badge/Live-Mainnet-brightgreen)](https://hoppy.cash)
[![Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js%2015-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[**Live Demo**](https://hoppy.cash) · [**Watch Demo Video**](#) · [**Roadmap**](https://hoppy.cash/roadmap)

---

`solana` `privacy` `zk-compression` `payments` `defi` `web3` `hackathon`

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Demo](#demo)
- [Features](#features)
- [How It Works](#how-it-works)
  - [Double Hop Privacy](#how-double-hop-privacy-works)
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

This friction prevents everyday use cases: sending money to friends, private gifts, paying someone who doesn't have crypto yet.

## The Solution

hoppy lets you send crypto by sharing a link. That's it.

You deposit funds into a shielded pool and get a claim link. Share that link with anyone via text, email, or QR code. They open it, connect any wallet, and claim the funds. Nobody except the link holder knows what it contains, and on-chain observers cannot connect sender to recipient.

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
| **Complete Privacy** | On-chain observers cannot link sender to recipient |
| **No Wallet Required** | Recipients can sign in with email to create a wallet instantly |
| **QR Code Sharing** | Generate scannable codes for mobile claiming |
| **Gasless Claims** | Recipients don't need SOL to claim, relayer pays fees |
| **Recipient Privacy Choice** | Recipients can choose quick (cheaper) or private (hidden from sender) |
| **Virtual Debit Cards** | Convert shielded crypto to Visa/Mastercard *(in progress)* |
| **Gift Card Payouts** | Redeem to Amazon, Uber, DoorDash *(in progress)* |
| **Live on Mainnet** | Real SOL, real privacy, production-ready |

---

## How It Works

<p align="center">
  <img src="public/howitworks.svg" alt="How hoppy works" width="100%" />
</p>

### Sending a Payment

1. Connect your wallet (or sign in with email)
2. Enter the amount you want to send
3. Funds are deposited into a shielded pool
4. You receive a claim link with a cryptographic secret
5. Share the link however you want (text, email, QR)

### Claiming Funds

1. Recipient opens the claim link
2. Connects any wallet (or creates one with email)
3. Chooses privacy level (Quick or Private)
4. Clicks "Claim" and funds arrive in their wallet
5. No SOL needed for gas (relayer pays transaction fees)

### Privacy Levels

| Level | What Happens | Who Can See Recipient |
|-------|--------------|----------------------|
| **Quick Claim** | Direct withdrawal, cheaper | Sender can see if they check |
| **Private Claim** | Extra routing hop, more private | Nobody, not even sender |

### How Double Hop Privacy Works

For maximum privacy, hoppy uses a **double hop** architecture that severs any connection between sender and recipient:

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│    SENDER    │ ──▶  │   TEMP 1     │ ──▶  │   SHIELDED   │ ──▶  │   TEMP 2     │ ──▶  RECIPIENT
│   (wallet)   │      │ (ephemeral)  │      │     POOL     │      │ (in link)    │      (wallet)
└──────────────┘      └──────────────┘      └──────────────┘      └──────────────┘
       │                     │                     │                     │
       │                     │                     │                     │
   Known to             Severs link           ZK compression       Keypair embedded
   sender only          from sender           hides everything     in claim URL
```

**Step 1: Sender Deposit**
- Sender creates a deposit, funds route through **Temp Wallet 1** (an ephemeral wallet)
- Temp 1 deposits into the shielded pool and is discarded
- This severs the on-chain link between sender and the pool deposit

**Step 2: Claim Link Generation**
- A new keypair is generated for **Temp Wallet 2**
- The private key for Temp 2 is embedded in the claim link URL (the "cryptographic secret")
- Only the link holder can control Temp 2

**Step 3: Recipient Claims (Private Mode)**
- Recipient opens the link and gains control of Temp 2 via the embedded keypair
- Temp 2 withdraws from the shielded pool to the recipient's actual wallet
- Since the recipient controls Temp 2, they can route funds however they want

**Why This Works:**
- Sender → Temp 1: visible, but Temp 1 is burned immediately
- Temp 1 → Pool: deposit is hidden via ZK compression
- Pool → Temp 2: withdrawal is unlinkable to the deposit
- Temp 2 → Recipient: recipient controls this hop, sender never sees it

The result: **complete unlinkability**. Even if someone watches the entire blockchain, they cannot connect the sender's wallet to the recipient's wallet.

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
NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Network
NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta
```

> See `.env.example` for the full list of environment variables including database, email polling, and gift card configuration.

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
| **Shielded Pool** | ZK-compressed state, cryptographic commitments, unlinkable deposits/withdrawals |
| **Claim Links** | Cryptographic secret in URL hash, only link holder can claim |
| **Nullifiers** | Each claim link can only be used once, prevents double-spending |
| **No Custody** | Funds flow directly through on-chain pool, hoppy never holds your crypto |
| **Recipient Choice** | Recipients choose their privacy level when claiming |
| **Open Source** | All code is auditable |

### Important Notes

- **Claim link is the secret.** Anyone with the URL can claim the funds. Share securely.
- **Quick claims are traceable.** If recipient chooses "Quick Claim", sender can see who claimed by checking the blockchain.
- **Private claims are hidden.** If recipient chooses "Private Claim", even the sender cannot see who received the funds.

---

## Tech Stack

**Frontend**
- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- Framer Motion

**Privacy Infrastructure**
- Privacy Cash SDK
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
- [ ] Partial withdrawals
- [ ] Multi-token support (USDC, USDT, BONK)
- [ ] Virtual debit cards
- [ ] Gift card payouts
- [ ] Claim expiration with auto-refund

### Up Next
- [ ] Split claims (one deposit → multiple links)
- [ ] Stealth addresses
- [ ] Recall unclaimed payments
- [ ] Viewing keys for compliance
- [ ] Conditional release

### Future
- [ ] x402 Protocol for AI agents
- [ ] Agent wallets
- [ ] EVM support
- [ ] Cross-chain swaps

---

## Acknowledgments

- **Privacy Cash** - ZK compression infrastructure
- **Light Protocol** - Underlying ZK technology
- **Helius** - Reliable Solana RPC
- **Solana Foundation** - Hackathon sponsorship

---

## Links

- **Live Demo:** [hoppy.cash](https://hoppy.cash)
- **GitHub:** [github.com/hamzaskewl/hoppy](https://github.com/hamzaskewl/hoppy)
- **Twitter:** [@hoppyprivacy](https://x.com/hoppyprivacy)
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

> ⚠️ **Hackathon Software Notice:** This project was built during a hackathon. While it is live on mainnet and functional, it has not been formally audited. Use at your own risk and with amounts you're comfortable with.
