# Emblem Tools

Shared, reusable SDK modules for integrating Emblem Vault into any app. These are the building blocks our own products (EmblemWrapped, EmblemScan, Vault Robbers, OneShot) are built on.

Modules:
- **Emblem Connector** (`emblem-wallet-connector`) - multi-chain wallet connect + sign (EVM, Solana, Bitcoin/Ordinals, Counterparty, Stacks, Tezos)
- **Wrapping Companion** (`emblem-wrapping-companion`) - the wrap/unwrap lifecycle, curated mint, buy-and-wrap
- **Metadata Assistant** (`emblem-metadata-assistant`) - resolves a vault's display name + art across source chains
- **Pay with Anything** (`emblem-pay.client.js` + `emblem-pay-relay-proxy.js`) - pay in any token on any chain via Relay, routed to the destination
- **Collection Handler** (`emblem-collection-handler.js`) - Emblem collection registry helper

Each module has a matching `*-HANDOFF.md` with integration notes. `sdk-manifest.json` is the machine-readable index.

Public SDK snapshot (2026-10-20). No secrets or server credentials, these are integration libraries. Add a LICENSE before external reuse.
