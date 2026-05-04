# hoppy 

**Privacy-First Payments on Solana**
🏆 Privacy Cash SDK Bounty $1,000 Winner 🏆

Sending crypto shouldn't require the recipient to have a wallet set up, share their address, or expose their identity. With hoppy, you just share a link. The money is in the link. They claim it privately.

[![Live on Mainnet](https://img.shields.io/badge/Live-Mainnet-brightgreen)](https://hoppy.cash)
[![Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js%2015-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[**Live Demo**](https://hoppy.cash) · [**Watch Demo Video**](https://www.youtube.com/watch?v=6PiOxw07JJ4) · [**Roadmap**](https://hoppy.cash/roadmap)

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

### How Double Hop Privacy Works

When using **Private Mode**, hoppy routes funds through the shielded pool twice, making transactions completely unlinkable.

**Sender Side (First Hop):**
1. Sender deposits funds into a temporary wallet
2. That wallet sends funds through the shielded pool
3. Funds arrive at **Ephemeral Wallet 2** (a fresh keypair)
4. A **384-bit composite secret** (containing a 256-bit Ed25519 private key seed) is encoded into the claim link

**Recipient Side (Second Hop):**
1. Recipient opens the claim link
2. The app extracts the Ephemeral Wallet 2 keypair from the link
3. Using that keypair, funds are sent through the shielded pool again
4. Funds arrive at the recipient's actual wallet

**Why Neither Party Can Trace:**
- **Sender** doesn't have the claim note, so they can't see where funds went after Ephemeral Wallet 2
- **Recipient** doesn't know where the funds in Ephemeral Wallet 2 came from
- **On-chain observers** see two separate pool transactions with no connection between them

Two hops through the pool = complete sender-recipient unlinkability.

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
│   │       ├── relayer/         # Gas-funding relayer (breaks on-chain link)
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
- Railway deployment

---

## Roadmap

### Recently Completed
- [x] **Cancel/Recall Payments** - February 4th, 2026 - Get back unclaimed funds, send to your wallet or a custom address
- [x] **Partial Claims** - February 4th, 2026 - Claim only a portion, get a new link for the remainder
- [x] **Multi-token support (USDC, USDT)** - February 3rd, 2026
- [x] **Relayer for SPL gas fees** - February 3rd, 2026 - Automatic SOL subsidies for stablecoin claims

### In Progress
- [ ] Virtual debit cards (using Reloadly) - Convert shielded crypto to Visa/Mastercard
- [ ] Gift cards (using Reloadly) - Redeem to Amazon, Uber, DoorDash, and more

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
