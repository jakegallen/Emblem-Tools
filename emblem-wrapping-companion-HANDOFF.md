# Emblem Wrapping Companion - Handoff

> **v1.7.0 (live): curated-mint hardening + EVM gas/send fixes.** Live version is `EMBLEM_WRAPPING_COMPANION_VERSION = '1.7.0'` (verified in `emblem-wrapping-companion/emblem-wrapping-companion.js`). Changes since v1.3.0:
> - **v1.4.0:** `buyEvmListing` now WAITS for the approval receipt before the fill AND REQUIRES a successful fulfillment receipt, so a reverted or allowance-racing buy can no longer read as "bought" (which previously made the app try to wrap an asset it never received).
> - **v1.5.0:** `mintCuratedWithRetry`, the proven emblem.vision curated signed-price mint path (quote, sign, submit `buyWithSignedPrice`). It works for EVM L2 RWA (Beezie / Courtyard) where the plain SDK mint path stalls; uniform across chains, returns the on-chain `{tokenId, nftContract}`.
> - **v1.6.0:** `makeEvmSender` sets an explicit clamped gas limit (estimate +30%, bounded 120k–1.5M) so a flaky RPC can no longer balloon the ERC-721 send to the block cap (fixes the Polygon "gas limit too high, 56M vs 33.5M" bug).
> - **v1.7.0:** `_qBig` handles ethers-v5 BigNumber quote objects (`{type:'BigNumber', hex}`) + decimals, so the curated mint no longer dies on "Cannot convert [object Object] to a BigInt".
>
> NOTE: the **connector.zip** in this handoffs set bundles the companion at **v1.3.0** (not this standalone v1.7.0). The standalone `emblem-wrapping-companion/` dir is the current v1.7.0 source.
>
> **v1.3.0 (2026-08-26): strict EVM-owner enforcement in `wrapAsset`.** Before `createCuratedVault`, `wrapAsset` now resolves the owner via the connector's `wrappingOwner()` (falls back to `wallet.evmAddress` for older connectors) and forces `template.fromAddress`/`toAddress` to it, throwing if no EVM wallet is connected. This makes it impossible for any app on the companion to create a vault under a sending wallet (Solana/BTC/etc.), the bug that stranded two Collector Crypt vaults under Phantom's injected EVM. Pairs with connector v1.17.0.
>
> **v1.2.0 (2026-08-23). The 2nd pillar** (Emblem Connector → **Wrapping Companion** → apps). The batteries-included wrap engine that turns "I have a wallet" into "my asset is wrapped." Built on the Connector + the emblem-vault-sdk, with image work delegated to the Metadata Assistant. **Finished + unit-tested** (orchestration + EVM-encoding + nonce-retry + resume checks); EVM wraps work out of the box.
>
> **v1.2.0 (2026-08-23):** adds the shared **Relay token list** (`emblem-relay-tokens.js`, re-exported from this module) so every app can price any Relay-swappable token to USDC from one canonical source. **v1.1.0 (2026-08-22):** added `buyEvmListing()`, the shared Seaport buy engine (exact-amount ERC-20 approve if allowance is short, then send the fulfill tx) that drives both OpenSea native fulfillment AND the self-build path, incl. Robinhood-chain items; propagated md5-identical to every app copy.

## What it does

- **`wrapAsset()`** - the full lifecycle: create vault → move asset in → detect deposit → ensure gas → **mint (with a nonce auto-retry)**. Staged callbacks (`create` → `sent` → `detect` → `mint` → `done`). Pass `resumeVault` to resume a created-but-unminted vault after a reload (the safety net).
- **`awaitDeposit()`** - the SDK two-call pattern done right (refreshBalance is a trigger, then fetchMetadata; funded = `metadata.values.length > 0`), per-chain confirmation thresholds.
- **`mintWithRetry()`** - catches Emblem's rare "Nonce already used" revert and re-mints with a fresh signed quote (up to 3x).
- **`unwrap()`** - claim (reveal keys) → sweep.
- **`addrExplorer()` / `txExplorer()` / `confWaitNote()`** - chain-aware UX helpers.
- **`buyEvmListing({ fulfill, wallet, chainHex, onStage })`** (v1.1.0) - the shared EVM buy engine used by buy-and-wrap. `ensureChain`, then an EXACT-amount ERC-20 (USDC) approve only if the current allowance is short (spender + amount come from the server, never unlimited), then send the fulfill tx (value `0x0` for erc20 orders); returns the tx hash. Drives BOTH OpenSea native fulfillment and the self-build (`via:'self'`) path, and works for Robinhood-chain items.
- **Image resolution DELEGATES to the Metadata Assistant** (`artOk` / `resolveAssetArt` / `proxyImg`), so the one dead-area blocklist + Counterparty card map are shared. (The old inline card-CDN list that pointed at the now-dead xchain/github CDNs is gone.)

## Relay token list (v1.2.0)

New shared file **`emblem-relay-tokens.js`** - the canonical list of tokens Relay can route to USDC, so every app prices any incoming token uniformly. It is imported and re-exported by `emblem-wrapping-companion.js` (v1.2.0) so consumers only ever import from the Companion.

- **`RELAY_TOKENS_FALLBACK`** - a 36-token offline fallback across Ethereum, Base, Arbitrum, Optimism, Polygon and Solana (each row: `symbol`, `chain`, `address`, `decimals`, price id).
- **`RELAY_CHAIN_IDS`** - the chain-name to chain-id map (+ the reverse label lookup).
- **`findRelayToken(symbol, chain, list)`** / **`findRelayTokenByAddress(address, list)`** - lookups against a token list.
- **`getRelayTokensBrowser()`** - browser helper that fetches the app's own `api/relay/tokens` route (relative), caches for 10 minutes, and falls back to `RELAY_TOKENS_FALLBACK` on any error.
- **`buildRelayTokenRoute(app, opts)`** - server helper that mounts `GET /api/relay/tokens`, live-fetching `POST api.relay.link/currencies/v1` (across the configured chains) with a 10-minute server cache and the 36-token offline fallback.

**Server side.** Mount the route (or, in an Emblem app, `lib/onchain.js` implements `GET /api/relay/tokens` directly): it live-fetches `api.relay.link/currencies/v1`, caches 10 min, warms ~15s post-boot, and falls back to the 36-token list offline.

**Client side.** Read the cached list synchronously via the Companion's re-exported `RELAY_TOKENS_FALLBACK` for an instant render, or `await getRelayTokensBrowser()` (which hits the relative `api/relay/tokens`) for the live list. The list is byte-identical across the canonical copy and every app's `public/` copy.

## Chain adapters

- **EVM is FULLY IMPLEMENTED, no ethers.** `makeEvmSender()` moves an ERC-721 to the vault deposit address using only the Connector (encodes `safeTransferFrom` calldata + `ensureChain` + the wallet's EIP-1193). `evmSenders()` wires Base/Polygon/Shape/Robinhood/Ethereum at once, and `createWrappingCompanion()` includes them by default. `makeEvmSweep({ ethers, rpcFor })` is the reference unwrap-sweep (needs ethers + the revealed key).
- **Exotic chains (Bitcoin Ordinals, Counterparty, Solana, Stacks, Tezos) are injected adapters** - their send/sweep is chain-library-heavy and app-owned. Pass `senders[chain]` / `sweep` / `holdingsResolvers[chain]`. EmblemWrapped's `live.js` is the reference implementation to lift from.

## Usage

```js
import { createWrappingCompanion } from './emblem-wrapping-companion.js';
const companion = createWrappingCompanion({
  sdk, client,                       // emblem-vault-sdk + a signer client
  walletCtx: { /* Connector ctx */ },
  senders: { /* add BTC / Solana / Counterparty / Stacks / Tezos; EVM is already wired */ },
  ethers,                            // enables the default EVM unwrap-sweep
});
const res = await companion.wrapAsset({ collection, asset, buildTemplate, mintGasWei, onStage });
```

## Where it lives

`emblem-wrapping-companion/` (client module + its Connector + Metadata Assistant deps) and bundled into `the shared app bundle` for Emblem's native-wrap build. Buy/acquire (OpenSea/Magic Eden/Collector Crypt) stays a separate keyed module, not baked into the keyless core.

## Next

Lift EmblemWrapped's five exotic-chain `senders`/`sweeps`/`holdingsResolvers` out of `live.js` into named companion adapters, then route all wrap flows through `wrapAsset()`.
