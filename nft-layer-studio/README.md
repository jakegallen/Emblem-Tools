# nft-layer-studio

A manifest-driven generative NFT art pipeline, extracted from Emblem's Vault Robbers. MIT licensed. Ships with **placeholder art** so it runs out of the box - swap in your own layers.

It turns a folder of layered art + a manifest into a full collection:

- **weighted layer compositor** (PNG or SVG traits, composited by z-order via [sharp](https://sharp.pixelplumbing.com/))
- **tier/weight rarity** with optional categories, and **exclude/force rules** between traits
- **de-duplication** so every token is a unique trait combination
- **rarity ranking** (`_rarity.json`, rank 1 = rarest)
- **ERC-721 metadata** per token
- **BAYC-standard provenance**: SHA-256 of the concatenated per-image hashes, plus a per-image manifest so anyone can recompute and verify the collection wasn't swapped after reveal
- **IPFS pinning** (`pin.mjs`) via Pinata, two-phase (pin images, rewrite metadata with the image CID, pin metadata)

No keys or secrets are included; `pin.mjs` reads your Pinata JWT from the environment.

## Quick start

```bash
npm install            # installs sharp
node generate.js 8     # render an 8-token preview from the placeholder art
```

Output lands in `render-out/` (`images/`, `metadata/`, `_rarity.json`, `_provenance.txt`, `_provenance.json`). Render the whole collection with `node generate.js <supply>`.

## Manifest

`layers/manifest.json` describes the collection:

```json
{
  "name": "My Collection",
  "canvas": 2048,
  "categories": [
    { "key": "background", "z": 1, "label": "Background", "traits": [
      { "id": "ash", "name": "Ash", "file": "background/ash.svg", "tier": "common" },
      { "id": "gold", "name": "Gold", "file": "background/gold.svg", "tier": "ultra-rare" }
    ] },
    { "key": "body", "z": 2, "label": "Body", "optional": false, "traits": [ ... ] }
  ]
}
```

- `z` sets the stacking order (lowest at the back). `canvas` is the output size in px.
- Each trait points at a file under `layers/`. `tier` maps to a weight (`common` 100, `rare` 28, `ultra-rare` 6 by default); or set an explicit `weight`.
- Mark a category `"optional": true` and give it a `noneWeight` to let tokens sometimes skip it.

## Config (optional)

`data/config.json` overrides the manifest without editing it, and sets collection params:

```json
{
  "supply": 1000,
  "mythicCount": 10,
  "description": "...",
  "rules": [ { "ifCat": "body", "ifTrait": "prism", "type": "exclude", "thenCat": "background", "thenTrait": "gold" } ]
}
```

- `supply` total tokens; `mythicCount` reserves that many slots at the top of the index range for hand-made 1/1s (drop their files in and reference them), `0` for none.
- `rules`: `exclude` removes a trait from a category's pool when another trait is chosen; `force` pins it. Keeps impossible or ugly combinations out.
- Env overrides: `SUPPLY`, `MYTHIC_COUNT`, `POOL` (render only one named trait `pool`).

## Pinning to IPFS

```bash
PINATA_JWT=your_jwt node pin.mjs
```

Pins `render-out/images`, rewrites each metadata file's `image` to `ipfs://<CID>/<n>.png`, then pins the metadata folder and prints the base CID to put in your contract's `baseURI`.

## Placeholder art

The shapes in `layers/` are trivial SVGs so the pipeline runs immediately. Replace them with your real art (same manifest structure) - the compositor is art-agnostic (PNG or SVG). Bring your own art and its rights; nothing here is licensed to you beyond this tooling.

## License

MIT. Use it, fork it, build on it.
