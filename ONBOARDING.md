# Hoppy — Codebase Audit & Onboarding

## Context

A one-page onboarding view of this repo: what the project is, what's in it, and how the pieces fit. Meant to be skimmed top-to-bottom in a few minutes.

---

## 1. What is Hoppy?

**Privacy-first crypto payments on Solana via shareable claim links.**

- Sender deposits SOL / USDC / USDT, gets a URL like `/claim#<secret>`.
- Recipient opens the link, picks a wallet (or Privy social login), claims.
- Both sides can independently choose **basic** (cheap, public) or **private** (routed through Privacy Cash ZK pool).
- Live on Solana mainnet. Won the $1k Privacy Cash SDK bounty.

Bonus surfaces: a **Telegram bot** for send/claim, a **virtual debit card** flow (Starpay), and a **Payroll dashboard** (`/payroll`) on the Umbra Privacy SDK for businesses paying many recipients at once.

---

## 2. Tech Stack (one-liner)

Next.js 15 (App Router) + React 19 + TS + Tailwind on Railway, Postgres for state, Privy for auth/wallets, Helius RPC for Solana, Privacy Cash SDK (Light Protocol ZK compression) for shielding, Anthropic Claude for Telegram NLP.

---

## 3. Repo Layout (what's where)

```
hoppy/
├── src/app/                  Next.js routes + API
│   ├── page.tsx                landing
│   ├── create/                 sender flow page
│   ├── claim/                  recipient flow page
│   ├── payroll/                business dashboard + /payroll/claim (Umbra)
│   ├── card/                   virtual card flow
│   ├── how-it-works, roadmap   marketing
│   └── api/
│       ├── privacy-cash/       create-link, claim  ← CORE
│       ├── umbra/payroll/      deposit, issue-link, claim (Umbra-backed)
│       ├── card/               init, gift-order, claim, poll-emails
│       ├── starpay/            order, status, price
│       ├── telegram/           webhook, set-webhook
│       └── sol-price, health, stats, relayer/status
├── src/components/           React UI (create/, claim/, card/, ui/, nav)
├── src/lib/
│   ├── privacy/                Privacy Cash adapter + UTXO cache  ← CORE
│   ├── umbra/                  Umbra Privacy SDK adapter (payroll backend)
│   ├── payroll/                payroll types + encrypted localStorage
│   ├── local-storage-crypto.ts shared AES-GCM helpers (wallet-keyed)
│   ├── solana/                 chain helpers
│   ├── card/                   db, encryption, IMAP email worker
│   └── telegram/               bot, intents, state, wallet, db
├── public/                   logos, bunny, bg art
├── next.config.js            externalizes node-only pkgs (privacycash, web3.js)
├── nixpacks.toml             Railway build (Node 22+, --legacy-peer-deps)
└── .env.example              every secret documented
```

---

## 4. Domain Nouns (the 5 things to know)

| Noun | What it is |
|---|---|
| **DoubleHopNote** | The "link" — a 384-bit composite secret (16B claim id + 32B keypair seed) base58'd into the URL hash. Carries amount, ephemeral address, status, sender/recipient privacy mode, token. |
| **Ephemeral wallet** | Throwaway Solana keypair derived from the seed. Eph1 (sender side), Eph2 (link target after pool hop), EphRemainder (partial-claim leftovers). |
| **Shielded pool** | On-chain Privacy Cash / Light Protocol ZK-compressed pool. Breaks the on-chain link between deposit and withdrawal. |
| **Relayer** | Hoppy-funded wallet that drips ~0.003 SOL of gas to Eph2 so it can move SPL tokens without creating a sender→Eph2 trace. |
| **GiftCardOrder** | Postgres row tracking a Starpay virtual debit card purchase (status, encrypted card JSON, claim link). |

**No PII in DB.** Postgres holds only `gift_card_orders` and `link_stats` (anonymous counters). The whole claim secret lives in the URL hash — backend doesn't need to know about it.

---

## 5. System Design (ASCII)

```
                                ┌──────────────────────────┐
                                │        BROWSER           │
                                │  (sender or recipient)   │
                                └────────────┬─────────────┘
                                             │
                  ┌──────────────────────────┼──────────────────────────┐
                  │                          │                          │
                  ▼                          ▼                          ▼
          ┌──────────────┐          ┌────────────────┐          ┌──────────────┐
          │  Privy Auth  │          │  Next.js App   │          │  /claim#hash │
          │  (wallets,   │◀────────▶│   (Railway)    │          │  link in URL │
          │   social)    │          │                │          │  (no DB hit) │
          └──────────────┘          └───────┬────────┘          └──────────────┘
                                            │
            ┌───────────────────────────────┼───────────────────────────────┐
            │                               │                               │
            ▼                               ▼                               ▼
   ┌─────────────────┐           ┌──────────────────────┐         ┌─────────────────┐
   │  /api/privacy-  │           │   /api/card/*        │         │ /api/telegram/  │
   │   cash/         │           │   /api/starpay/*     │         │   webhook       │
   │  create-link    │           │   (gift-card flow)   │         │  (grammy bot)   │
   │  claim          │           └──────────┬───────────┘         └────────┬────────┘
   └────────┬────────┘                      │                              │
            │                               │                              │
            ▼                               ▼                              ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │                       src/lib/  (server-only logic)                          │
   │  privacy/  ──── PrivacyCash SDK wrapper, UTXO cache, fee math, URL codec     │
   │  solana/   ──── tx build & send helpers                                      │
   │  card/     ──── Postgres schema, AES-256 card crypto, IMAP email worker      │
   │  telegram/ ──── command handlers, Claude intent parsing, wallet KMS          │
   └──────┬────────────────────┬──────────────────┬──────────────────┬────────────┘
          │                    │                  │                  │
          ▼                    ▼                  ▼                  ▼
   ┌────────────┐     ┌────────────────┐   ┌────────────┐    ┌────────────────┐
   │  Helius    │     │  Privacy Cash  │   │  Postgres  │    │  Anthropic     │
   │  RPC       │────▶│  pool (Light   │   │ (Railway)  │    │  Claude (NLP)  │
   │            │     │  Protocol ZK)  │   │            │    │                │
   └─────┬──────┘     └────────────────┘   └────────────┘    └────────────────┘
         │
         ▼
   ┌─────────────────────────────────┐    ┌────────────────┐    ┌──────────────┐
   │      Solana Mainnet             │    │  Starpay API   │    │ Gmail IMAP   │
   │  • Ephemeral wallets (Eph1/2)   │    │ (virtual debit │    │ poll-emails  │
   │  • Shielded pool commitments    │    │  card issuer)  │    │ for delivery │
   │  • Relayer wallet (gas drip)    │    └────────────────┘    └──────────────┘
   └─────────────────────────────────┘
```

### Private send → private claim ("double hop")

```
 sender wallet ──deposit──▶ POOL ──ZK withdraw──▶ Eph2  (link points here)
                                                    │
                                       recipient opens link
                                                    │
                              Eph2 ──deposit──▶ POOL ──ZK withdraw──▶ recipient wallet
```

On-chain you only see: `sender → POOL` and `POOL → recipient`. No edge connects them.

### Payroll on Umbra (separate stack)

```
 business wallet ──one Privy sig──▶ bulk deposit (Umbra encrypted balance, wSOL)
                                              │
                       per-row server-side issuance (no extra sigs)
                                              │
                    ┌────────────┬────────────┼────────────┐
                    ▼            ▼            ▼            ▼
              stealth Eph1  stealth Eph2  stealth Eph3  ... (one per employee)
                    │            │            │
              /payroll/claim#<base58 note>  ← link the business shares

 employee opens link → connects any wallet → server uses stealth keypair to
 withdraw from Umbra encrypted balance → unwraps wSOL → SOL arrives.
```

Storage: encrypted in browser localStorage, keyed by the connected business
wallet (mirrors the existing `create-link-form.tsx` pattern). Nothing
sensitive on the backend.

---

## 6. Notable Architectural Choices

- **Stateless claims.** The full secret is in the URL hash → no DB lookup, no account, infinitely scalable. Trade-off: longer URLs.
- **Two ephemerals per private send.** Eph1 = funded directly, Eph2 = derived from the link's seed. Eph1 deposits to pool, Eph2 receives the ZK withdrawal. The pool hop is what hides the link between them.
- **Relayer for SPL gas.** ZK withdrawals of USDC/USDT give you tokens but no SOL for fees. Hoppy's relayer wallet drips gas instead of having Eph1 do it (which would re-link them).
- **`fundsLocation: "ephemeral" | "pool"`** on the note tracks where money currently sits — lets remainder links from partial claims skip the redundant deposit.
- **UTXO preseed** (`utxo-cache.ts`) skips the SDK's full pool scan for fresh ephemerals — big speedup on create-link.
- **Server-externalized packages** in `next.config.js`: `privacycash`, `@solana/web3.js` etc. are Node-only (crypto / curve issues in browser bundles).
- **Email polling, not webhook**, for Starpay card delivery — `cards+{orderId}@hoppy.cash` mailbox scraped by `/api/card/poll-emails` cron.
- **Payroll uses a separate stack (Umbra, not Privacy Cash).** Same "secret in the URL hash" idea, but the secret is an Umbra stealth keypair seed instead of a Privacy Cash composite secret. Business signs one bulk deposit; per-row link issuance happens server-side using a Hoppy-derived escrow signer (deterministic from `UMBRA_ESCROW_MASTER_KEY` + business wallet) so employees don't need to sign N times.

---

## 7. Where to start reading (in order)

1. `README.md` — written in user-facing voice, good orientation.
2. `src/lib/privacy/privacy-cash-adapter.ts` — type defs (`DoubleHopNote`), URL codec, fee math.
3. `src/app/api/privacy-cash/create-link/route.ts` — sender flow, well-commented.
4. `src/app/api/privacy-cash/claim/route.ts` — recipient flow + partial-claim logic.
5. `src/components/create/create-link-form.tsx` and `claim/claim-flow.tsx` — UI side of the same flows.
6. `src/lib/card/db.ts` + `.env.example` — Postgres schema and full env surface.
7. `src/lib/telegram/bot.ts` — separate side-quest if you care about the bot.

---

## 8. Verification (how to poke the running system)

- `npm install --legacy-peer-deps && npm run dev` → app on `:3000`.
- `GET /api/health` → deployment liveness.
- `GET /api/relayer/status` → relayer SOL balance (must be > ~0.05 SOL or SPL claims fail silently).
- `GET /api/stats` → anonymous link-created / link-claimed counters.
- Manual flow: `/create` (devnet) → copy link → open in incognito → `/claim` → confirm tx hash on Solscan.
- Payroll flow: `/payroll` → connect → add 3 rows → "Generate payroll links" → open each in incognito → `/payroll/claim#…` → "Claim payment". Adapter is currently mocked (see banner on the page); real Umbra wiring is the next iteration.
