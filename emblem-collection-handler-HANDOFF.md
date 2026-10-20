# Emblem Collection Handler — Handoff

_The 4th Wrapped SDK pillar. The canonical Emblem collection registry for every app._
_v1.0.0 · 2026-10-07 · module: `/pub/main/vault-explorer/emblem-collection-handler.js`_

---

## What it is

One shared module every Emblem app imports instead of hardcoding its own collection list. It reads the canonical registry from the **EmblemScan Data API** (`/api/v1/collections`), which surfaces the Emblem curated registry plus per-collection valuation and deposit metadata. Edit nothing per app: the set never drifts because there is exactly one source.

- No dependencies. Browser (`window.EmblemCollections`) + Node (`require`). Uses global `fetch` (Node 18+).
- In-memory cache (5 min TTL), single in-flight request, serves stale on a transient API error.

## Why

Before this, each Emblem app kept its own collection array — add a collection in one, forget the others, drift. The Collection Handler makes the enriched `/api/v1/collections` registry the single source; apps ask it instead of guessing.

## Install

Browser:
```html
<script src="https://api.emblemscan.com/emblem-collection-handler.js"></script>
<!-- or from EmblemScan directly: /pub/main/vault-explorer/emblem-collection-handler.js -->
```
Node:
```js
const C = require('./emblem-collection-handler');
```

## API

Every getter lazy-loads + caches; `load()` is optional warming.

```js
await C.load();                         // warm cache (opts: {force, base})
await C.all();                          // full registry (array of rows)
await C.byContract('0x8e1bb30a…');      // one row by any chain contract (case-insensitive)
await C.bySlug('collector-crypt-wrapped');
await C.standardOf(addr);               // 'ERC721' | 'ERC1155'
await C.isMintable(addr);               // can you create/wrap into it now
await C.depositInfo(addr);              // { depositChain, nativeAssets[], protocol } — what/where to deposit to wrap
await C.filter({ protocol:'counterparty', standard:'ERC1155', chain:'ethereum', mintable:true });
await C.detail('collector-crypt-wrapped'); // adds the full per-chain `contracts` map (uses /collections/:id)
await C.contractsOf(idOrContract);      // just the { chainId: address } map
C.cached();                             // sync access to last-loaded rows (null before first load)
C.setBase('https://api.emblemscan.com/api/v1');  // override API base (default)
```

**Row shape:** `{ name, contract, chain, standard, collectionType, protocol, depositChain, nativeAssets[], mintable, tvlUsd, floorUsd, owners, totalSupply, volumeUsd, vol30dUsd, slug }`. `detail()` adds `contracts`.

`standard` is authoritative (read from the Emblem registry, not guessed). `protocol` is one of `counterparty | ordinals | stamps | solana | stacks | tezos | bitcoin | evm`. `depositChain` + `nativeAssets` are the "deposit counterpart" — what and where a user deposits to wrap into the collection.

## Adoption (per app, do one at a time)

1. Drop in the script / require.
2. Replace the app's hardcoded collection array with `await C.all()` (or targeted getters at the call sites).
3. Keep any app-specific flags the registry does not carry as a thin local overlay keyed by contract, merged onto the registry row.
4. Verify holdings/wrap/valuation flows against the registry rows, then delete the old array.

The live Emblem apps are the adoption targets. Do them one at a time and verify each (they are live, money-handling apps).

## Source of truth

The registry data comes from `/api/v1/collections` (and `/collections/:id` for the contract map), which is built from the Emblem curated feed. This module is listed in `sdk-manifest.json` alongside the Connector, Wrapping Companion, and Metadata Assistant, so it appears in both the EmblemScan Developer Hub (Wrapped SDK tab) and this handoffs index automatically.
