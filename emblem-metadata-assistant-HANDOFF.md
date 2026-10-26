# Emblem Metadata Assistant - Handoff

> **Server v0.9.1 · client v0.5.0. The 3rd pillar of the Emblem front-end stack.** One shared codebase that derives a vault's display art + name, correctly, for every collection and every vault state, across the apps.
>
> **Server v0.9.1 (2026-10-26) - SSRF hardening on the canonical server.** The `_ssrfSafeUrl` guard (used by `evmOnchainArt`'s attacker-influenceable tokenURI metadata fetch) is now async + DNS-resolving. It strips IPv6 brackets, blocks IPv6 ULA (fc/fd) + link-local (fe80) + mapped (`::ffff:`, including Node's hex-compressed form) + loopback (`::1`/`::`), blocks IPv4 loopback/RFC1918/link-local and CGNAT (100.64.0.0/10), rejects numeric-encoded hosts (`0x..`, decimal), and re-checks the DNS-resolved IP (defeats rebinding + names pointing at internal space). The metadata fetch now uses `redirect:'manual'` and re-validates every 3xx hop. Closes proven bypasses: `http://[::1]/`, `http://[::ffff:169.254.169.254]/`, `http://[fd00::1]/`, `http://100.100.100.200/`. Canonical only; app-copy propagation is the main agent's job (see below).
>
> **Version propagation (2026-10-26):** the CANONICAL standalone module is at **server v0.9.1 · client v0.5.0**. The app copies LAG and are being brought up by the main agent: `vault-explorer` server **v0.8.0 → v0.9.0** (then pick up v0.9.1 SSRF), EmblemWrapped prod/dev (`vault-mint`/`vault-mint-dev`) servers **v0.9.0 → v0.9.1**, and `wrapping-companion` client **v0.4.1 → v0.5.0**. SEPARATELY, the `emblem-wallet-connector.zip` in this handoffs set still bundles an OLDER metadata client at **v0.4.1** - re-sync it on the next connector-zip pass.

## Real Emblem vault id resolution (server v0.9.0, 2026-08-23)

The on-chain `tokenId` is NOT the Emblem vault id, so a viewer link built from the raw on-chain id lands on an UNRELATED vault (for ERC-721 wrappers the small tokenId is a wrapper-local id; for ERC-1155 the big number is a shared backing token). v0.9.0 adds the canonical resolver:

- **`resolveEmblemVaultId({ nft, tokenId, chain, base })`** - maps a `(wrapper contract, on-chain tokenId)` pair to the vault's real Emblem id via `GET {EV2}/v3/meta/{contract}/{tokenId}` → `.tokenId` (default base `v2.emblemvault.io`; needs a browser-like UA to pass Cloudflare). Uniform across ERC-721 and ERC-1155.
- **`emblemViewerUrl({ nft, tokenId, ... })`** - resolves the id, then returns the EmblemWrapped viewer URL (`emblemwrapped.com/?vault={id}`), or nothing if it cannot resolve (so a wrong link is never emitted).

Both are exported from the server module. an Emblem app consumes them server-side (`routes.js` attaches `asset.vault_id` + `asset.vault_url` and exposes a same-origin `/api/emblem-id` proxy); verified round-tripping the right named vault for NodeMonkes / OnChainHoodies / Fomoji / RPEPELIGHTER. Synced into the an Emblem app + vault-mint copies.

## Canonical display-name standardizer (client v0.5.0 · server v0.8.0, 2026-08-23)

**`cleanName(name, collection)`** - strips a redundant collection prefix and collapses a doubled name, so items never read "NodeMonkes NodeMonkes" or "Beezie Collectibles LUBU". Safe against real names that legitimately contain the collection word (e.g. "Bitcoin Puppet #9326" vs collection "Bitcoin Puppets"). Added to both halves and propagated md5-identical to all 7 apps; wired into Emblem (owner-vaults server + 5 client derivation sites), vault-mint (vault card title only, not the mint target asset), and vault-explorer (activity rows). an Emblem app keeps its own identical `cleanItemName`.

## Source-chain art resolution (server v0.5.0 → v0.7.0, 2026-08-22)

The server half gained the ability to resolve **wrapped-RWA** art from the *source* chain, because Emblem's `myvaults` returns the `EVTESTCOMMON` placeholder for Courtyard / Beezie / Collector Crypt / Cope / Robinhood vaults - the real item art lives on the chain the asset was wrapped FROM, at the vault's own deposit address.

- **v0.5.0** - built-in EVM on-chain art reader: reads `tokenURI` (including inline `image_data` SVG) on Base / Polygon / Shape / Robinhood.
- **v0.6.0** - `SOURCE_COLLECTIONS` registry + `sourceArt(collection, srcTokenId)`: for collections whose real art lives on a source chain (OnChainHoodies / StonkBrokers → Robinhood, Beezie → Base, Courtyard → Polygon, Cope Salada → Shape), resolves the source on-chain art from the source contract - so apps that only hold the ETH wrapper (e.g. EmblemScan activity rows) still get the true item art.
- **v0.7.0** - `sourceArtByOwner(collection, addresses, {evmHoldings, solHoldings})`: resolves the REAL item art from the vault's own source-chain **deposit-address holdings** (Courtyard / Beezie / Cope / Robinhood / Collector Crypt), so raffle / consign art never blanks to `EVTESTCOMMON`. This is what an Emblem app and Emblem call to fill grail images.

These are server-side only. The v0.9.0 server + v0.5.0 client are shared and consistent across the general app copies (standalone, prod, and the `vault-mint-dev` twin) — the dev twin is now at server v0.9.0, matching prod (see the version-propagation note at the top).

## The three pillars

1. **Emblem Connector** - wallet: connect, sign, chain-switch, cross-chain funding + `ensureGas`.
2. **Wrapping Companion** - the wrap lifecycle UX (scaffold, ready to become the shared wrap engine).
3. **Metadata Assistant** - this: given a vault, derive its display art/name once, so a display bug is provably "in derivation," never "this one app."

Wired into: **EmblemWrapped** (`vault-mint`, server + client), **EmblemScan** (`vault-explorer`, server), **Emblem**. Standalone, prod, and the `vault-mint-dev` twin are all at server v0.9.0 / client v0.5.0 — consistent, no dev lag (see the version note at the top).

## Two halves

- `emblem-metadata-assistant.client.js` (browser ESM): `artOk` / `isDeadArt` / `DEAD_ART_SOURCES` (the one dead-area blocklist), `proxyImg`, `COLLECTION_REGISTRY` + `inferByChain` + `collectionInfo` (supports every collection), `STRATEGIES` (the derivation methods), `buildCpAssetImgMap` / `cpAssetImg` (SDK card map), `makeImgCache`, `VAULT_STATES` + `resolveDisplayArt` (dual-key, state-aware), `bulkResolveServer`.
- `emblem-metadata-assistant.server.js` (Node): `createVaultMeta(deps)` → `{ resolveVaultArt, cpCardArt, strategyFor, saveArt, mountRoutes, artOkSrv }`, plus the standalone exports `cleanName`, `resolveEmblemVaultId`, `emblemViewerUrl`, `sourceArtByOwner`, `sourceArt`. Mounts `GET/POST /api/vault-art`.

The client `DEAD_ART_SOURCES` and the server's are copy-paste identical (one list, sync-proof).

## What's inside

- **Every collection, sorted + categorized.** Registry with `category` (`rwa` vs `digital`) + `strategy`, plus chain inference + a universal `emblem-values` fallback so a brand-new collection resolves with no code change.
  - **RWA (real-world assets, tokenized physical): EXACTLY 3** - Collector Crypt (Solana), Courtyard (Polygon), Beezie (Base).
  - **Robinhood Chain** - its OWN chain, DIGITAL-native (ERC-6551 token-bound accounts, on-chain SVG art), NOT RWA. Seven collections.
  - Counterparty/Bitcoin card families, Ordinals, Stacks, Tezos, plus other EVM-digital (Cope Salada).
- **The dead areas** - one blocklist (EVTESTCOMMON, the now-404 xchain/github card CDNs, dead EmBells `bellscdn.ordinalswallet`, alchemy derivatives…). Add a newly-dead host once, everywhere stops trusting it.
- **The right image per chain (STRATEGIES):** cp-asset-name (SDK map → hnft → Emblem values e.g. img.spellsofgenesis.com), evm-tokenuri (source tokenURI, RWA), evm-onchain (Robinhood ERC-6551 on-chain SVG), sol-content (Solana DAS), onchain-content (Ordinals/Stacks/Tezos), emblem-values (universal).
- **Right fallback order + backup methods.** Server: vm_art cache → shared corpus → catalog → CP card CDN → Emblem content metadata (prefers `values[].image`) → per-chain onchain backup (EVM tokenURI / Robinhood SVG). Blank is the honest last resort, never a broken image.

## Robustness (why it always shows)

- `cpCardArt` cache: positives kept, a clean miss expires in 10 min, a **network error is never cached** - a transient CDN outage can never permanently blank a real card.
- Per-chain onchain backup runs AFTER Emblem metadata (fills a gap, never overrides the real content image). Purely additive.
- Every source is gated by the dead-area blocklist, so a dead/placeholder URL is never emitted.

## Wiring an app

**Server:** `const { createVaultMeta } = require('./emblem-metadata-assistant.server.js'); const meta = createVaultMeta({ dbQuery, dbExec, emblemMeta, corpus, strategyResolvers });` then `meta.mountRoutes(app, { express, rateLimit })` - or delegate just the primitives (`meta.artOkSrv`, `meta.cpCardArt`) as EmblemWrapped/EmblemScan do.

**Client:** `import * as MDA from './emblem-metadata-assistant.client.js'; window.__MDA = MDA;` then use `MDA.artOk` in image validation.
