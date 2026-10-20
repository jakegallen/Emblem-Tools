# Emblem Wrapping Companion

The batteries-included layer for building wrap/unwrap experiences on Emblem Vault. It sits on top of two dependencies and adds everything an integrator would otherwise reinvent.

```
                 emblem-vault-sdk            (the vault engine: create / refresh / mint / claim)
                        ▲
                        │
  Emblem Wrapping Companion  ── wrap lifecycle · deposit detection · explorers · image resolution · unwrap
                        │
                        ▼
   Emblem Connector (emblem-wallet-connector.js)  ── connect · sign · chain-switch · Relay funding · ensureGas
```

Two layers, on purpose:

- **Emblem Connector** (`emblem-wallet-connector.js`) is the keyless, app-agnostic engine: connect, sign, switch chains, cross-chain funding (`relayToUsdc` / `relayToNative`), and gas-minimum enforcement (`ensureGas`). It talks only to relative `api/*` endpoints the host provides (Relay quote/status, pay-assets, sol-rpc). No marketplace keys, no DOM. This is the piece meant to be open-sourced on top of the EmblemVault SDK.
- **Wrapping Companion** (this module) is the Emblem-specific UX on top of the Connector + SDK.

## What this module owns

| Area | Export | Notes |
|------|--------|-------|
| Wrap lifecycle | `wrapAsset()` | create → send → detect → ensure gas → mint, one call, staged callbacks |
| Deposit detection | `awaitDeposit()` | SDK two-call pattern (refreshBalance trigger, then fetchMetadata; funded = `metadata.values.length > 0`) |
| Confirmation thresholds | `CONFIRMATIONS`, `confirmationsFor()`, `confWaitNote()` | Bitcoin-family waits 2, fast chains 1 |
| Explorer links | `addrExplorer()`, `txExplorer()` | chain-aware, Counterparty routes by wallet (Horizon vs xcp.io) |
| Image resolution | `artOk()`, `resolveAssetArt()`, `cpCardArtCandidates()`, `firstLoadable()` | never emits EVTESTCOMMON; resolves Counterparty cards by asset name across card CDNs |
| Gas | `ensureGas()` | passthrough to the Connector primitive |
| Unwrap | `unwrap()` | claim (reveal keys) → pluggable sweep |
| Holdings | `holdings()` | routes to a per-chain resolver you register |

## What YOU inject (the pluggable adapters)

The chain-specific "move the asset" steps legitimately differ per chain, so they are injection points, not baked in:

- **`senders[chain]`** — moves the source asset into the vault deposit address. EVM `safeTransferFrom`, Solana pNFT/MPL Core, Ordinals `sendInscription`, Counterparty PSBT, Stacks SIP-009, Tezos FA2. If no sender is registered for the source chain, `wrapAsset` treats the deposit as **manual** (fires `onStage('await-deposit-manual', {depositAddr})` so you can surface the address + QR).
- **`sweep`** — moves the underlying asset out on unwrap after the claim reveals the keys.
- **`holdingsResolvers[chain]`** — discovers wrappable assets in a wallet (Alchemy / Ordinals indexer / Horizon / Hiro / TzKT).
- **`buildTemplate(collection, asset)`** (or a prepared `template`) — builds the `createCuratedVault` template. For `select` collections the `targetAsset` must come from the collection's allow-list (`sdk.getAssetMetadata(collection.name)`).

Everything else, the orchestration and the parts that are pure pain to rebuild, is done for you.

## Usage

```js
import { createWrappingCompanion } from './emblem-wrapping-companion.js';
import EmblemVaultSDK from 'emblem-vault-sdk';

const sdk = new EmblemVaultSDK('demo');
const companion = createWrappingCompanion({
  sdk,
  walletCtx: { /* passed to createEmblemWallet: onStage, etc. */ },
  client: myEmblemVaultClient,          // satisfies the SDK signer contract (see emblem-vault-sdk skill)
  senders: {
    'Bitcoin Ordinals': async ({ depositAddr, asset, wallet, onStage }) => {
      // wallet.* from the Connector; return the send txid
    },
    'Base': async ({ depositAddr, asset, wallet }) => { /* safeTransferFrom */ },
    // ...one per source chain you support
  },
  holdingsResolvers: {
    'Base': ({ collection, address }) => fetch(`api/holdings/base?addr=${address}`).then(r => r.json()),
  },
});

const res = await companion.wrapAsset({
  collection, asset,
  buildTemplate: (coll, a) => { /* return a createCuratedVault template */ },
  mintGasWei: 3_000_000_000_000_000n,   // ensureGas tops up ETH mainnet only if short
  onStage: (stage, data) => console.log(stage, data),
});
// res => { tokenId, depositAddr, sendTxid, mintTx, metadata }
```

### wrapAsset stages (for driving UI)

`create` → `created` → (`send` → `sent`) | `await-deposit-manual` → `detect` → `detect-poll`* → `ensure-gas` → `gas`* → `mint` → `done`

## Status

**v1.0.0 — finished + unit-tested (14/14).** The full wrap engine: `wrapAsset()` (create → send → detect → ensure gas → mint) with a **mint nonce auto-retry** and **resume-after-reload** (`resumeVault`), `awaitDeposit()`, `unwrap()`, chain-aware explorers, confirmation thresholds. Image work DELEGATES to the Metadata Assistant (the old inline card-CDN list, which pointed at the now-dead xchain/github CDNs, is gone). **EVM is fully implemented, no ethers** — `makeEvmSender()` / `evmSenders()` move an ERC-721 via `safeTransferFrom` calldata + the Connector's EIP-1193 + `ensureChain` (Base/Polygon/Shape/Robinhood/Ethereum, wired by default); `makeEvmSweep({ ethers, rpcFor })` is the reference unwrap-sweep. The five exotic chains (Ordinals / Counterparty / Solana / Stacks / Tezos) stay injected `senders` / `sweep` / `holdingsResolvers` (chain-library-heavy, app-owned); EmblemWrapped's `live.js` is the reference to lift them from. Not yet the LIVE wrap engine in any app, that migration is a separate step.

The **buy / acquire** flow (OpenSea Seaport, Magic Eden, Collector Crypt) is intentionally NOT here: it needs server-side marketplace API keys, so it belongs in a separate opt-in `emblem-acquire` companion, not in the keyless core. It reuses this module's `ensureGas` + funding once a listing is fetched.

## Versioning

`EMBLEM_WRAPPING_COMPANION_VERSION` (this module) and `EMBLEM_WALLET_CONNECTOR_VERSION` (the Connector dependency) are both exported. Keep the connector copy in this directory in sync with the canonical one in `emblem-bazaar/public/`.
