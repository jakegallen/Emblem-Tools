> **Last updated 2026-08-19 — connector v1.8.0 (audit + harden pass).**
> - P0 fix: a global `express.json()` shadowed `/api/sol-rpc` (Solana RPC proxy was broken → Collector Crypt buy failed). Per-route body parsers now, so large signed-tx routes get their real limits.
> - Buy-and-wrap across 4 chains: EVM (OpenSea Seaport), Solana (Collector Crypt, USDC + Relay), Ordinals (ord.net, keyless), Counterparty (XCP/Horizon). Relay preflights: SOL→USDC and ETH/SOL→BTC.
> - Connector hardening: `clearSolanaContext()` + fresh-connect clears external context (no stale-address signing), on-chain confirm errors no longer swallowed, even-length hex guard on PSBT sign, cached Metaplex import, pubkey null guard.
> - Removed dead code (legacy CS_SEL create path, renderCompleted, seedRaffles/settleExpired); rate-limited the unauthenticated raffle writes; added live raffle economics + clearer owned/buyable grid states.

# Emblem Wallet Connector

A shared, app-agnostic multi-chain wallet layer for Emblem front-ends. It handles wallet
**discovery, connect, chain-switch, and signing** only. No DOM, no server calls, no framework,
so it drops into any page. Your app keeps its own server / holdings / wrap logic and asks this
connector for an address and a signer.

Used by EmblemWrap (vault-mint) and Emblem's Bazaaro World from one source of truth: edit this
file and every app that loads it updates.

## Chains and wallets

- **EVM** via EIP-6963 discovery + injected fallback: MetaMask, Rabby, Coinbase, OKX, Rainbow,
  Phantom, Trust, Brave, Zerion, Frame, Bitget, Enkrypt, Taho, and Robinhood. Chain add + switch
  for Ethereum, Base, Polygon, Shape, and Robinhood Chain.
- **Solana** injected: Phantom, Solflare, Backpack, OKX.
- **Bitcoin Ordinals**: Unisat (taproot) and Xverse (via sats-connect).
- **Counterparty**: XCP Wallet (`window.xcpwallet`), returns legacy-first addresses and signs PSBTs.

## Install

It is a single ES module with two CDN dependencies loaded at runtime (ethers v6, and sats-connect
lazily only if you touch Xverse). No build step.

```html
<script type="module">
  import { createEmblemWallet } from 'https://YOUR-HOST/pub/main/emblem-wallet-connector/emblem-wallet-connector.js';
  const wallet = createEmblemWallet({ onWalletChange: (chain, addr) => console.log(chain, addr) });
  // ... or use the ready singleton: window.EmblemWallet
</script>
```

## Quick start

```js
// 1) show a connect menu of what's actually installed
const evmWallets = wallet.discoverEvm();      // e.g. ['metamask','rabby','robinhood']
const solWallets = wallet.discoverSolana();   // e.g. ['phantom']

// 2) connect
const addr = await wallet.connectEvm('metamask');   // -> checksummed 0x address

// 3) target a chain (adds it to the wallet if missing)
await wallet.ensureChain(wallet.CHAIN_HEX.Base);

// 4a) sign a message
const sig = await wallet.evmSigner.signMessage('hello');

// 4b) drive the emblem-vault-sdk mint / claim with the connected wallet
const client = wallet.emblemClient();
await sdk.performMintChainWithClient(client, tokenId, 1, cb);
```

## API

Factory: `createEmblemWallet({ onWalletChange })` where `onWalletChange(chain, address)` fires on
connect and on account switches (`chain` is `'eth' | 'sol' | 'btc' | 'xcp'`).

**EVM**
- `discoverEvm()` → array of installed wallet ids
- `findInjectedEvm(id)` → the raw EIP-1193 provider (or null)
- `connectEvm(id)` → checksummed address (prompts)
- `attachEvmSilently(id)` → re-attach without a popup, or null
- `ensureEvm()` → re-sync signer/address (call before a tx)
- `ensureChain(hexChainId)` → switch, adding the network if needed
- `emblemClient()` → `{ toEthersWallet() }` adapter for emblem-vault-sdk
- `CHAIN_HEX`, `CHAIN_ADD_PARAMS`

**Solana**: `discoverSolana()`, `connectSolana(id)`, `solProvider()`

**Bitcoin**: `connectBtc(id)` (`'unisat' | 'xverse'`), `connectUnisat()`, `connectXverse()`, `ensureBtc()`

**Counterparty**: `xcpAvailable()`, `connectXcp(silent)` → legacy-first `[{address,purpose,type}]`,
`xcpSignPsbtHex(psbtHex, signInputs, opts)`

**State getters**: `evmAddress`, `evmSigner`, `evmProvider`, `evmEip1193`, `evmWalletId`,
`solAddress`, `solWalletId`, `btcAddress`, `btcPaymentAddress`, `btcOrdinalsPubkey`,
`btcPaymentPubkey`, `xcpAddrs`, and a combined `state` snapshot.

## What it does NOT do

Holdings lookups, wrap/mint/unwrap composition, PSBT building, and RPC proxying are **app-specific**
and stay in each app's server. This connector is only the wallet boundary: connect and sign.

## Versioning

`EMBLEM_WALLET_CONNECTOR_VERSION` is exported and stamped on the instance (`wallet.version`). Bump it
on every change so consumers can detect the loaded revision.

## License / provenance

Extracted from the production EmblemWrap (vault-mint) connect layer, verified live across the wallets
listed above. Internal Emblem use.
