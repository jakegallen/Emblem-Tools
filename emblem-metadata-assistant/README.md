# Emblem Metadata Assistant

The third pillar of the Emblem front-end stack:

1. **Emblem Connector** — wallet: connect, sign, chain-switch, cross-chain funding
2. **Wrapping Companion** — the wrap lifecycle UX
3. **Metadata Assistant** — this: given a vault in *any* state, derive its display art + name, correctly, once

All three apps (EmblemWrapped `vault-mint`, EmblemScan `vault-explorer`, Bazaaro `emblem-bazaar`) render vault cards across states (created, funded, wrapped, unwrapped, raffled, listed). Today each app carries its own copy of the derivation logic, and when those copies drift, images break in one app but not another. The Metadata Assistant makes derivation **one codebase**, so a display bug is provably "in how it's derived," never "this one app."

```
Emblem Connector (wallet + funding)
        │
Metadata Assistant   ← given a vault, derive its display art/name (client + server)
        │
Wrapping Companion (wrap UX)   ─┐
Wrapped / EmblemScan / Bazaaro ─┴─ all consume the Metadata Assistant for vault displays
```

## What's inside (everything, in one place)

- **The right images for the right collections** — `COLLECTION_REGISTRY` maps each collection to its `chain`, `family`, and art `strategy` (`cp-asset-name`, `onchain-content`, `evm-tokenuri`, `sol-content`, `emblem-values`). The resolver uses the strategy to pick the correct source per collection.
- **The dead areas** — one `DEAD_ART` blocklist (client array + server regex, kept identical) for placeholders and dead hosts (EVTESTCOMMON, the now-404 `xchain.io/img/cards` and `EmblemCompany/vaultImages/master`, alchemy derivatives…). Add a newly-dead host once and every app stops trusting it.
- **The clean efficiency** — a namespaced localStorage cache, a same-origin image proxy, the SDK asset-image map built once, and an in-memory server card-CDN cache. No app re-derives what another already resolved.
- **How the vault states work** — a vault shows the same underlying asset in every state; what changes is *which* tokenId holds it (source/holdings id pre-mint, vault id post-mint). `resolveDisplayArt` checks *both* keys and mirrors a hit across them, so a card stays imaged from created → wrapped → unwrapped → raffled → listed.

## Two halves, one blocklist

- **`emblem-metadata-assistant.client.js`** (browser ESM): `artOk` / `isDeadArt` / `DEAD_ART`, `unwrapImg`, `proxyImg`, `COLLECTION_REGISTRY` / `collectionInfo` / `isCpFamily`, `buildCpAssetImgMap` / `cpAssetImg`, `makeImgCache`, `VAULT_STATES`, `resolveDisplayArt` (no-network best art, dual-key state-aware), `bulkResolveServer`.
- **`emblem-metadata-assistant.server.js`** (Node): `createVaultMeta(deps)` → `{ resolveVaultArt, saveArt, cpCardArt, mountRoutes, artOkSrv }`. Mounts `GET /api/vault-art` + `POST /api/vault-art/bulk`.

## Server resolution order

First real hit wins; dead/placeholder URLs rejected at **every** step:

1. `vm_art` persistent cache (by `token_id`)
2. shared corpus tables (EmblemScan's `ve_coll_items` / `ve_activity` / `ve_top_sales` / `ve_tvl1155_cards`)
3. on-disk asset catalog (optional)
4. Counterparty card CDN by asset name (`hnft` + `bitcorns`; **xchain and github are dead and omitted**)
5. Emblem content metadata — **prefer `values[].image`** (the real card, e.g. `img.spellsofgenesis.com`) over `m.image`

## Wiring an app

**Server:**
```js
const { createVaultMeta } = require('../emblem-metadata-assistant/emblem-metadata-assistant.server.js');
const meta = createVaultMeta({
  dbQuery, dbExec,
  emblemMeta: (id) => emblemFetchRetry(`${EV2}/meta/${id}?experimental=true`).then(r=>r.json()).catch(()=>null),
  catalogLookup,
  corpus: [
    { sql: 'SELECT image FROM ve_coll_items WHERE token_id=? AND image!=? LIMIT 1' },
    { sql: 'SELECT image FROM ve_tvl1155_cards WHERE UPPER(asset)=UPPER(?) AND image!=? LIMIT 1', byAsset: true },
  ],
});
meta.mountRoutes(app, { express, rateLimit });
```

**Client:**
```js
import { artOk, proxyImg, buildCpAssetImgMap, resolveDisplayArt, makeImgCache, bulkResolveServer }
  from './emblem-metadata-assistant.client.js';
const cache = makeImgCache('vm_tokenimg_v1');
const cpMap = buildCpAssetImgMap(sdk);
let img = resolveDisplayArt({ tokenId, sourceTokenId, asset, collection, current: v.image, cpMap, cache }); // '' → bulkResolveServer
```

## Rollout (phased, live app LAST)

EmblemWrapped is live money and its resolver was just hardened, so it is the canonical source this module was extracted from, and it migrates last.

1. **Ship the module** — done (this dir), v0.2.0.
2. **EmblemScan** — swap its `cpCardImg`/`_isDeadImg` resolver to the Assistant; verify CP thumbnails. Lowest risk.
3. **Bazaaro** — swap its raffle/vault image resolution (`cvRealImg`) to the Assistant.
4. **EmblemWrapped** — delegate behind a flag, verify across wrap/unwrap/vaults, then retire the inline copy. The Wrapping Companion's image layer re-points here too.

Each phase verified before the next. After phase 4, all three derive identically and there is exactly one derivation core.

## Status

**v0.2.0 — built + smoke-tested** (blocklist rejects dead xchain/github, accepts real `img.spellsofgenesis.com`; collection registry + vault-state resolution added). Not yet wired into any app; phases 2–4 pending go-ahead.
