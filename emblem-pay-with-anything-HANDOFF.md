# Emblem Pay-With-Anything — Relay Funnel Module (Handoff)

A drop-in, non-custodial "pay with any supported token on any supported chain" funnel. The user pays in whatever
they hold (ETH, SOL, USDC/USDT/DAI, USDG, BNB, …) across the supported origins, and your app receives an **exact
amount of one destination token on one destination chain** — the swap/bridge is routed by [Relay](https://relay.link).
No custody, no server-held keys: the user's own wallet signs, and your server is only a locked-down read proxy.

This is the generalized extraction of the funnel that powers Vault Standoff's "$10 buy-in in any coin" and the
Vault Robbers mint. It is a GENERALIZED template — other apps integrate it — but the chain list, balance filter,
and gas pattern below reflect exactly what the live mint does today.

**Current supported origins (Jake 2026-10-18): exactly 5 — Solana, Ethereum (1), Base (8453), Robinhood (4663),
BNB (56).** No Arbitrum/Optimism/Polygon, no Bitcoin. (Polygon et al. may still appear in the wallet CONNECTOR's
network add/switch list — that's wallet-network UX, separate from this pay-origin scope.) Widen or narrow via the
server router's `supportedOrigins` option.

---

## Architecture (the only correct shape)

```
Browser (user wallet signs)  ──►  Your App Server (this router)  ──►  api.relay.link  (quote/status)
         │                                   └────────────────────►  Solana RPC (read-only, whitelisted)
         └── submits the signed tx itself (EVM eth_sendTransaction / Solana v0 tx)
```

- **Quote + status go through YOUR server** (`relay-proxy`), never the browser directly — this hides any Relay
  API key and, critically, lets you **pin the destination server-side** so the proxy can't be abused as a free
  open swap oracle. Origin (what the user pays in) is the user's choice, but constrained to `supportedOrigins`;
  destination (what you receive) is NOT negotiable by the client.
- **The transaction is signed and submitted by the user's wallet**, client-side. The server never touches a key.
- **Solana is a first-class origin.** SOL + Solana-USDC are offered like any EVM balance. Relay Solana legs return
  raw instructions (+ address-lookup-tables), not a serialized tx, so the client assembles a v0
  `VersionedTransaction` using a **read-only, method-whitelisted** Solana RPC proxy. `getAddressLookupTable` MUST
  be whitelisted (it is) so the browser can resolve the ALTs the leg references.

## Files

| File | Where it runs | What it is |
|------|---------------|------------|
| `emblem-pay-relay-proxy.js` | server (Node/Express) | `makeRelayRouter({...})` → a mountable Express router: `GET /relay/chains`, `POST /relay/quote`, `GET /relay/status`, `POST /sol-rpc`. Rate-limited, destination-pinned, **origin-allow-listed** (`supportedOrigins`), timeout-bounded. |
| `emblem-pay.client.js` | browser | `relayDeliver(...)` + the EVM/Solana signing helpers + `filterPayable(...)` (the dust/sub-cost balance filter) + `SUPPORTED_ORIGINS`. Framework-agnostic; takes an EIP-1193 provider (and optionally a Solana wallet). |

---

## Server integration (3 lines)

```js
const { makeRelayRouter } = require('./emblem-pay-relay-proxy');
app.use('/api', makeRelayRouter({
  // DESTINATION is pinned here and can never be overridden by the client:
  destinationChainId: 4663,                                   // where you receive
  destinationCurrency: '0x77061B45C5E4D440bd681B5F72BD0F4231a6fC04', // the token you receive
  // ORIGIN allow-list — the client can only pay FROM these chains. Default is the canonical 5-chain set
  // [792703809, 1, 8453, 4663, 56] (Solana, Ethereum, Base, Robinhood, BNB); pass your own to widen/narrow.
  supportedOrigins: [792703809, 1, 8453, 4663, 56],
  enabled: () => true,                                        // gate (e.g. () => escrow.config().on)
  relayApiKey: process.env.RELAY_API_KEY,                     // optional; raises Relay rate limits
  solRpc: process.env.SOL_RPC || 'https://solana-rpc.publicnode.com',
  rateLimit: myRateLimiter                                    // optional (key,max,winMs)=>bool; a default is included
}));
```

Env: `RELAY_API_KEY` (optional but recommended for production — without it Relay rate-limits and the funnel
degrades), `SOL_RPC` (optional, defaults to a public node).

## Client integration

```html
<script src="emblem-pay.client.js"></script>
<script>
  const pay = EmblemPay({
    evmProvider: window.ethereum,      // or an EIP-6963-selected provider
    solWallet:   window.solana,        // optional, only if you accept Solana origins
    apiBase:     'api'                 // relative base for the server routes (no leading slash)
  });

  // Deliver EXACTLY `amountAtomic` of the pinned destination token to `recipient`, paid from the user's
  // chosen origin token/chain. Resolves once Relay reports the swap filled.
  await pay.relayDeliver({
    originChainId: 1,                                  // 1=eth, 8453=base, 56=bnb, 4663=Robinhood, 792703809=Relay Solana
    originCurrency: '0x0000000000000000000000000000000000000000', // EVM native sentinel, a 0x ERC-20, or a base58 Solana mint
    amountAtomic: '5000000000000000000000',            // EXACT_OUTPUT amount of the DESTINATION token (wei/atomic)
    recipient: '0xYourUserEvmAddress',
    onStage: (label) => setLoadingText(label)          // 'Approve the payment…', 'Confirming on Base…', etc.
  });

  // Optional: show only currencies the wallet can actually complete one purchase with (hide $0 dust + sub-cost).
  // `perUnitUsd` = the USD cost of one mint/entry.
  const payable = pay.filterPayable(pricedBalanceRows, perUnitUsd);
</script>
```

Quote by `tradeType`: default **EXACT_OUTPUT** (deliver a precise destination amount, user pays the variable
input — use this when your price is fixed in the destination token). Pass `EXACT_INPUT` to spend a precise
input amount instead (use this to implement a fixed-USD quote: price the input in a stablecoin, take whatever
destination token it buys).

## Dual-wallet guard: require BOTH wallets before any payment (opt-in)

When a Pay-with-Anything flow delivers to an EVM destination the user must then act on (sign a follow-up
mint/entry tx on Robinhood Chain), a Solana-origin payer with no EVM wallet connected can pay and then be
stranded with nothing to sign. Pass `requireBothWallets: true` to `relayDeliver` and it throws a clear,
pre-payment error unless BOTH an EVM and a Solana wallet are connected:

```js
await pay.relayDeliver({ /* …origin, amount, recipient… */, requireBothWallets: true });
// throws 'Connect your EVM (Robinhood) wallet before paying.' / '…Solana wallet…' BEFORE quoting.

// Or check yourself to gate a Pay button:
const { evm, solana } = await pay.walletsReady();
```

**Emblem house rule (Jake, 2026-10-21):** for the EVM connector / Pay-with-Anything tooling, both Solana and
EVM should be connected before any payment is made. Vault Robbers mint + Vault Standoff set
`requireBothWallets: true`. Pair this with the connector's `mobileWalletHint()` so mobile users get warned to
open an in-app wallet browser first.

---

## Supported origins (the 5-chain scope, proven on mainnet)

| Origin | `originChainId` | Native | Stablecoins offered |
|--------|-----------------|--------|---------------------|
| Solana | `792703809` | SOL (base58 native) | Solana-USDC (`EPjFWdd5…TDt1v`) |
| Ethereum | `1` | ETH (`0x0000…0000`) | USDC, USDT, DAI |
| Base | `8453` | ETH (`0x0000…0000`) | USDC, DAI |
| BNB Chain | `56` | BNB (`0x0000…0000`) | USDC, USDT, DAI (18-dec on BSC, not 6) |
| Robinhood | `4663` | ETH (`0x0000…0000`) | USDC, USDG (6-dec canonical, not the 18-dec spam), + direct destination token |

`originCurrency` is the Relay origin currency: EVM native sentinel `0x0000…0000`, a 0x ERC-20 address, or a base58
Solana mint. **No Arbitrum/Optimism/Polygon, no Bitcoin** — removed from scope. Robinhood is the mint/settle chain,
so a Robinhood-native origin (or holding the destination token directly) needs no bridge.

> Decimals gotcha: USDC/USDT are 6-dec on every chain **except BSC**, where they are 18-dec. USDG on Robinhood is
> 6-dec. Read decimals from your own per-chain token map, not a hardcoded 6.

## Hide-zero / dust / sub-cost balance filter

The "Pay from" dropdown shows only currencies the wallet can actually complete at least one purchase with. Price
each balance row in USD, then filter (`pay.filterPayable(rows, perUnitUsd)` does this, or do it server-side):

1. Drop anything you couldn't price (`usd == null`) or that values `<= 0` — this hides 1-wei dust that reads as "$0".
2. Drop anything **below the cost of one mint/entry** (`perUnitUsd`). The floor falls back to **$1** when the live
   cost read failed (`perUnitUsd` falsy), so a transient RPC blip never over-filters the list to empty.

The live mint computes `perUnitUsd = oneUnitTokenCost × tokenUsd × (1 + premiumPct/100)` and applies exactly this.

## Always-on gas leg (deliver a little native gas even at 0% premium)

A cross-chain / Solana buyer can arrive on the destination chain with **zero native gas** and be unable to sign the
final approve + settle. So on any cross-chain/Solana origin the mint-quote ALWAYS bridges a small native
destination-chain gas slice (~0.0004 ETH on Robinhood) to the buyer — **even when the premium is 0%**. Gas is
decoupled from the premium: the delivered leg = `premiumWei (may be 0) + GAS_HEADROOM`.

Pattern (destination-pinned app server, building a two-leg Relay quote):
```js
const GAS_HEADROOM = 400000000000000n;        // ~0.0004 ETH, always delivered on a cross-chain/Solana purchase
const legWei = premiumEthWei + GAS_HEADROOM;   // premium (may be 0) + the always-on gas slice
// Leg A: EXACT_OUTPUT the destination token the purchase needs.
// Leg B: EXACT_OUTPUT `legWei` of native destination-chain gas to the buyer, so they can always sign.
```
On a **same-chain / direct** origin (the wallet already holds the destination token on the destination chain) there
is NO bridged gas leg — instead run a client-side gas preflight: if the wallet's native balance is below a tiny
threshold (~0.0003 ETH), tell the user plainly to top up rather than letting the approve revert cryptically.

## Security checklist (do not skip)

1. **Destination is pinned server-side.** The client supplies only origin + amount + recipient. If you ever
   forward a client-supplied destination to Relay, you've built an open swap oracle for anyone with the URL.
2. **No key in the browser.** The server proxies reads only; the user's wallet signs and submits.
3. **Origin allow-list.** The quote route rejects any `originChainId` not in `supportedOrigins` (default: the 5-chain
   set) so the funnel can't be driven from an unsupported/unexpected chain.
4. **Solana RPC proxy is method-whitelisted** (`getLatestBlockhash`, `getMultipleAccounts`, `getAccountInfo`,
   `getSignatureStatuses`, `getAddressLookupTable`, `getBalance`, `getTokenAccountsByOwner`, `getFeeForMessage`,
   `getSlot`). `getAddressLookupTable` is required for the Solana leg. It must **never** forward `sendTransaction`
   — the signed tx is submitted by the wallet, not your server.
5. **Validate origin addresses by type** (EVM `0x40hex` / Solana base58) before reflecting them into the Relay
   request. The router does this.
6. **Rate-limit** `/relay/*` and `/sol-rpc` (the router ships a default limiter; pass your own to share limits).
7. **Timeouts** on every upstream fetch (the router uses `AbortSignal.timeout`).
8. **EVM fees:** the client attaches EIP-1559 fees (base×2 + tip) so a low default gas estimate can't strand an
   L1 origin tx. Over-delivery dust (Relay rounds up) stays in the user's wallet — surface it if you want.

## Notes / gotchas

- Relay bridge latency is a near-constant ~3s; all other variance is **origin-chain** confirmation (Ethereum L1
  slowest at default gas, Solana near-instant). Label your loading state per origin chain for good UX.
- `requestId` for status polling is on the quote's steps (`check.endpoint`) or `quote.requestId`.
- Not every pair has a route; handle `NO_SWAP_ROUTES_FOUND` by hiding that origin.
- Solana: `getAddressLookupTable` must be whitelisted on the sol-rpc proxy — the client resolves the ALTs the
  Relay leg references before compiling the v0 message, or the tx won't assemble.

Source of truth for the live implementation (2026-10-19): `vaultrobbers-mint/server.js` (the pay routes —
`PAYCHAINS`, `/api/balances` with the hide-zero/dust/sub-cost filter, `/api/relay/quote`, `/api/relay/mint-quote`
with the always-on gas leg, `SOL_RPC_METHODS`) and `vaultrobbers-mint/public/index.html` (the pay UI — `buildPayMenu`,
the Solana-first-class row, `relayPayAndMint` / `relaySolPayAndMint`, the direct-RVLT gas preflight). Vault Standoff's
server is a second reference. This module is the generalized, destination-configurable extraction of those.
