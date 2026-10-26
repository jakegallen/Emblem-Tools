> **Update 2026-10-26 - canonical is v1.19.0 (NOT v1.18.0); separate standoff/robbers lineage flagged.**
> - **v1.19.0 is the canonical latest for ALL general and wrapping apps.** The standalone module (`emblem-wallet-connector/emblem-wallet-connector.js`) is at v1.19.0. v1.19.0 adds the pure-detection helpers `mobileWalletHint()` and `hasInjectedProvider()` (used for a mobile in-app-browser warning), on top of v1.18.0 (heal stale keyless Ankr RPC on `ensureChain` + keyless Polygon RPCs) and v1.17.0 (`wrappingOwner()` strict EVM-only rule).
> - **The prod/dev `public/` app copies are being brought up to v1.19.0 by the main agent** (they were lagging at v1.18.0). The 2026-10-19 note below saying "v1.18.0 is consistent/canonical" is now SUPERSEDED - treat v1.19.0 as the parity target for general/wrapping apps.
> - **SEPARATE LINEAGE WARNING (standoff / robbers forks):** The `vaultstandoff-*` apps and `vaultrobbers-mint` run a SEPARATE, larger connector lineage that currently REUSES the shared `1.18.0` version string. This is a version COLLISION: their forks carry extra standoff/robbers-specific code but report the same number as the shared base, so a parity audit can falsely assume they match the canonical connector. They do NOT. These forks should be given their own version SUFFIX (e.g. `1.18.0-standoff`, matching the existing `1.18.1-rvmint` convention) so future audits see the drift immediately. Only the canonical/standalone files were touched in this pass; the main agent / Jake can apply the suffix inside those app dirs later.
>
> **Prior: 2026-10-19 - version sync: v1.18.0 is now consistent across prod, dev, and standalone.**
> - **v1.18.0 is the canonical latest for ALL general and wrapping apps.** It is now identical in EmblemWrapped prod (`vault-mint`), the dev twin (`vault-mint-dev`), AND the standalone module (`emblem-wallet-connector/`). The dev + standalone copies were just upgraded from v1.17.0, so there is no longer any lag. v1.18.0 heals a broken wallet RPC (stale keyless Ankr) on `ensureChain` and adds keyless Polygon RPCs, on top of the v1.17.0 `wrappingOwner()` rule.
> - **The ONLY copy not at v1.18.0 is `vaultrobbers-mint/public/emblem-wallet-connector.js` at v1.18.1-rvmint. This is NOT a newer or better version.** It is a DELIBERATELY REDUCED, supply-chain-hardened build for the Vault Robbers mint hub ONLY. It vendors ethers/Solana locally and NEUTRALIZES Bitcoin (sats-connect), Counterparty, Stacks, Tezos, and frozen-Solana pNFT (mpl-token-metadata) because that hub mints EVM + Solana only.
>   - **DO NOT use v1.18.1-rvmint in EmblemWrapped or any multi-chain wrapping app.** It would break BTC / Ordinals / Counterparty / Stacks / Tezos wrapping. Use v1.18.0 for everything except the Vault Robbers mint hub.
> - **The `emblem-wallet-connector.zip` in this folder ships the v1.18.1-rvmint hub build** (its supply-chain-hardened, zero-CDN packaging). Treat that zip as the reference for the rvmint hub only; for general/wrapping apps, pull v1.18.0 from `vault-mint`, `vault-mint-dev`, or the standalone dir.
> - **rvmint hardening detail (v1.18.1-rvmint only):** zero third-party CDN imports (no esm.sh, no jsdelivr). `ethers` is read from a locally-served UMD global `window.ethers` (load your own pinned copy BEFORE the module); Solana web3/SPL are lazily imported from a local `./vendor/` dir (`solana-web3-1.98.4.esm.js`, `solana-spl-0.4.15.esm.js`); Tezos from `./vendor/tezos.mjs`. `sats-connect` + `mpl-token-metadata` are neutralized. The always-on EVM path needs NO external script origin in a CSP.
> - **Polygon is still listed in the connector's `CHAIN_HEX` / network-add table** for wallet add/switch — that's wallet-network UX and is SEPARATE from any app's pay-origin list. The Vault Robbers / Vault Standoff "pay from" list is a pinned 5-chain set (Solana, Ethereum, Base, Robinhood, BNB); see the Pay-With-Anything bundle. Do not conflate the two.
>
> **Prior: 2026-10-14 - Phantom-on-Robinhood correction + two-wallet (pay/mint) usage pattern.**
> - CORRECTION: Phantom NOW fully supports Robinhood Chain (operator-confirmed). It is a valid Robinhood EVM wallet, not Solana-only. Any older note saying "Phantom has no custom-EVM-network support / can't do Robinhood" is OBSOLETE; do not block or warn against Phantom on Robinhood anywhere. Safe Robinhood EVM wallets: MetaMask / Rabby / Phantom / Coinbase.
> - NEW CONSUMER PATTERN (from the Vault Robbers mint, vaultrobbers.com): a two-role connect. WALLET #1 = the PAY wallet — pull every chain it exposes and show all its assets together; a multi-chain wallet (Phantom, etc.) appears in BOTH `discoverEvm()` and `discoverSolana()` under one id, so connect BOTH legs (`connectEvm(id)` -> EVM addr, `connectSolana(id)` -> SOL addr) from the one pick. WALLET #2 = the MINT/settle wallet (EVM on the target chain) — default to REUSING the pay wallet when it is EVM-capable (no second pick), and only prompt for a second EVM wallet when the payer is pure-Solana. The connector already exposes everything needed (`discoverEvm/connectEvm/discoverSolana/connectSolana`); the pay-vs-mint split is app-level state.
>
> **Prior: 2026-08-26 - connector v1.17.0 (wrappingOwner: strict EVM-only vault-owner rule).**
> - `wrappingOwner()` added + exported: the single source of truth for who owns a wrapped vault. Returns the checksummed connected EVM address (via `ensureEvm`), or throws "connect an EVM wallet." STRICT RULE: a vault is ALWAYS created under the connected EVM wallet; the other chains (Solana, BTC, Ordinals, Counterparty, Tezos, Stacks) are ONLY sending wallets and must never own a vault. Closes the bug class where a Solana wrap grabbed Phantom's injected EVM address as the owner and stranded the vault under an address no lookup queries.
> - Consumed by the Wrapping Companion (`wrapAsset` forces `template.from/toAddress` to `wrappingOwner()` before create) and by an Emblem app's consign flow. Synced md5-identical to all app copies (plus dev twins + standalone).
>
> **Prior: 2026-08-21 - connector v1.13.0 (all 6 chains + ensureGas; two-layer split).**
> - All 6 chains now route connect through the shared connector: EVM, BTC, Solana, Counterparty (Horizon + XCP Wallet), Stacks (v1.11.0, Xverse via sats-connect), Tezos (v1.12.0, owns the single BeaconWallet; Taquito shared via `window.__tezos`).
> - `ensureGas(destChain, needWei, opts)` added (v1.13.0): gas-minimum enforcement. Reads what the wallet already holds on the destination chain and tops up only the shortfall + headroom via Relay, no-op when already covered. The buy/mint/escrow funding primitive.
> - Two-layer architecture (approved): this file is the **Emblem Connector**, the keyless base (connect + sign + chain-switch + Relay funding + ensureGas). A new **Wrapping Companion** (`emblem-wrapping-companion/`, v0.1.0) sits on top for the Emblem-specific wrap UX (wrapAsset lifecycle, deposit detection, explorers, image resolution, unwrap). Buy/acquire stays a separate keyed module.
> - Promoted into EmblemWrapped prod (vault-mint) via a surgical forward-port (dev had drifted behind prod on 4 hotfixes; a wholesale copy was avoided). Dev then re-synced so vault-mint and vault-mint-dev are byte-identical. All connector copies (vault-mint, vault-mint-dev, standalone) md5-unified at v1.13.0.
>
> **Prior: 2026-08-21 - connector v1.10.0 (unified single source across all Emblem apps).**
> - Unified across EmblemWrapped (vault-mint), Emblem (the shared app bundle), and the standalone module: all three copies are now byte-identical (md5-verified). They had drifted while all still labelled 1.9.2.
> - Relay funding added: `relayToUsdc`, `relayToNative`, `detectAssets`. Pay from ANY chain (BTC, SOL, or EVM native / USDC / USDT) into mainnet USDC or native gas, delivered to the connected EVM address. Powers Emblem's one-signature raffle entry and the wrap/deposit "pay from" pickers.
> - `connectEvm` hardened: a 30s timeout on `eth_requestAccounts` plus a clear "use Phantom (EVM)" message, so a dead or absent extension stub can no longer hang the connect with no popup.
>
> **Prior: 2026-08-19 - connector v1.8.0 (audit + harden pass).**
> - P0 fix: a global `express.json()` shadowed `/api/sol-rpc` (Solana RPC proxy was broken → Collector Crypt buy failed). Per-route body parsers now, so large signed-tx routes get their real limits.
> - Buy-and-wrap across 4 chains: EVM (OpenSea Seaport), Solana (Collector Crypt, USDC + Relay), Ordinals (ord.net, keyless), Counterparty (XCP/Horizon). Relay preflights: SOL→USDC and ETH/SOL→BTC.
> - Connector hardening: `clearSolanaContext()` + fresh-connect clears external context (no stale-address signing), on-chain confirm errors no longer swallowed, even-length hex guard on PSBT sign, cached Metaplex import, pubkey null guard.
> - Removed dead code (legacy CS_SEL create path, renderCompleted, seedRaffles/settleExpired); rate-limited the unauthenticated raffle writes; added live raffle economics + clearer owned/buyable grid states.

# Emblem Wallet Connector  -  Handoff

A shared, app-agnostic multi-chain wallet layer for Emblem front-ends. Handles wallet
**discovery, connect, chain-switch, and signing** only  -  no DOM, no server calls, no framework.
Extracted from the production EmblemWrap (vault-mint) connect code so every app runs the same,
verified wallet layer from one source.

## What's in the zip
- `emblem-wallet-connector.js`  -  the module (single file, ES module, v1.18.1-rvmint).
- `emblem-relay-tokens.js`  -  the shared Relay-swappable token list.
- `emblem-wrapping-companion.js`  -  the wrap/unwrap lifecycle layer on top of the connector. **NOTE: the copy bundled in this zip is v1.3.0**, not the standalone v1.7.0 (the v1.4.0-v1.7.0 curated-mint + gas/send fixes live in `emblem-wrapping-companion/`). See the Wrapping Companion handoff.
- `emblem-metadata-assistant.client.js`  -  vault art/name resolution. **The copy in this zip is client v0.4.1**, not the current standalone client v0.5.0.
- `README.md`  -  full API reference, quick start, and the supply-chain hardening notes.

## Version propagation (what each live copy actually is, verified 2026-10-19)
v1.18.0 is now unified across every general/wrapping copy. The only outlier is the Vault Robbers mint hub, which runs the reduced v1.18.1-rvmint build on purpose. If you open an app, this is what you will find:

| Copy | Connector version | Use for |
|---|---|---|
| `vault-mint/public/emblem-wallet-connector.js` (EmblemWrapped prod) | **v1.18.0** | canonical — all general/wrapping apps |
| `vault-mint-dev/public/emblem-wallet-connector.js` (dev twin) | **v1.18.0** | canonical — matches prod, no longer lags |
| standalone `emblem-wallet-connector/emblem-wallet-connector.js` | **v1.18.0** | canonical — matches prod, no longer lags |
| `vaultrobbers-mint/public/emblem-wallet-connector.js` | **v1.18.1-rvmint** | Vault Robbers mint hub ONLY (reduced EVM+Solana build; shipped in `emblem-wallet-connector.zip`) |

So an integrator who clones EmblemWrapped (`vault-mint`), the dev twin, OR the standalone module will find the same canonical **v1.18.0** — the three are consistent. The **v1.18.1-rvmint** build in the zip is the supply-chain-hardened Vault Robbers hub variant and must NOT be used by wrapping apps (it neutralizes BTC/Ordinals/Counterparty/Stacks/Tezos). v1.18.0 is the canonical latest for everything else.

## Drop-in usage
```html
<script type="module">
  import { createEmblemWallet } from './emblem-wallet-connector.js';
  const wallet = createEmblemWallet({ onWalletChange:(chain, addr)=>{} });
  const addr = await wallet.connectEvm('metamask');   // checksummed 0x…
  await wallet.ensureChain(wallet.CHAIN_HEX.Base);     // add+switch network
  const client = wallet.emblemClient();                // feeds emblem-vault-sdk mint/claim
</script>
```
A ready singleton is also on `window.EmblemWallet`.

## Mobile in-app-browser warning (v1.19.0)
On mobile, wallets inject `window.ethereum` / `window.solana` ONLY inside their own in-app browser. A user who opens the site in Safari or Chrome has no injected provider and dead-ends at connect. The connector exposes a PURE-DETECTION helper (no DOM, true to the no-DOM boundary) so each app renders its own banner however it likes:
```js
const hint = wallet.mobileWalletHint();   // { isMobile, hasInjected, shouldWarn, message }
if (hint.shouldWarn) showBanner(hint.message);   // desktop + in-app-browser => shouldWarn:false
// wallet.hasInjectedProvider() is also exported for standalone checks.
```
Detection spans the broad wallet set (MetaMask/OKX/Coinbase/Phantom/Trust/Bitget/Bybit/Rainbow/Jupiter/Backpack/Solflare/etc.). Re-check on load and ~1.5s later (some wallets inject late). Vault Robbers mint + Vault Standoff buy-ticket both ship this banner.

## Chains / wallets
- EVM (EIP-6963 + injected): MetaMask, Rabby, Coinbase, OKX, Rainbow, Phantom, Trust, Brave,
  Zerion, Frame, Bitget, Enkrypt, Taho, Robinhood. Add+switch (`CHAIN_HEX`) for Ethereum, Base,
  Polygon, Shape, Robinhood Chain.
- Solana: Phantom, Solflare, Backpack, OKX.
- Bitcoin Ordinals: Unisat (taproot), Xverse (sats-connect) — re-vendor `sats-connect` in this build to enable.
- Counterparty: XCP Wallet (legacy-first addresses, PSBT signing) — re-vendor to enable.

Note: Polygon in `CHAIN_HEX` is wallet add/switch UX only; it is NOT in any app's pay-origin list.

## Boundaries
The connector is the wallet boundary only: connect + sign. Holdings lookups, wrap/mint/unwrap
composition, PSBT building, and RPC proxying are app-specific and stay in each app's server.

## Runtime deps (LOCAL/vendored — no CDN, no build step) — v1.18.1-rvmint
- `ethers` — read from a locally-served UMD global `window.ethers`; load your own pinned copy before the module. (No esm.sh import.)
- `@solana/web3.js` + `@solana/spl-token` — lazily imported from `./vendor/solana-web3-1.98.4.esm.js` + `./vendor/solana-spl-0.4.15.esm.js` (only when Solana connect/sign is used). Ship these files alongside the connector.
- `@taquito` / `@airgap/beacon` — lazily imported from `./vendor/tezos.mjs` (only when `connectTezos` is called).
- `sats-connect`, `mpl-token-metadata` — NEUTRALIZED in this build (EVM + Solana hub); re-vendor to re-enable Xverse/Ordinals/Counterparty/Stacks.

## Dependencies / keys
None. Pure browser wallet layer; requires no API keys.

## Provenance
Canonical source 2026-10-19: `vaultrobbers-mint/public/emblem-wallet-connector.js` (v1.18.1-rvmint, the
supply-chain-hardened build). Originally extracted 2026-08-19 from `vault-mint/public/live.js`. Internal Emblem use.
