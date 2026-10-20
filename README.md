# Emblem Tools

Shared, reusable SDK modules for integrating Emblem Vault into any app. These are the building blocks our own products (EmblemWrapped, EmblemScan, Vault Robbers, OneShot) are built on.

## Modules

- **Emblem Connector** (`emblem-wallet-connector/`) - multi-chain wallet connect + sign (EVM, Solana, Bitcoin / Ordinals, Counterparty, Stacks, Tezos).
  - Usage: see `emblem-wallet-connector-HANDOFF.md`.
- **Wrapping Companion** (`emblem-wrapping-companion/`) - the wrap / unwrap lifecycle, curated mint, buy-and-wrap.
  - Usage: see `emblem-wrapping-companion-HANDOFF.md`.
- **Metadata Assistant** (`emblem-metadata-assistant/`) - resolves a vault's display name + art across source chains.
  - Usage: see `emblem-metadata-assistant-HANDOFF.md`.
- **Pay with Anything** (`emblem-pay.client.js` + `emblem-pay-relay-proxy.js`) - pay in any token on any chain via Relay, routed to the destination.
  - Usage: see `emblem-pay-with-anything-HANDOFF.md`.
- **Collection Handler** (`emblem-collection-handler.js`) - Emblem collection registry helper.
  - Usage: see `emblem-collection-handler-HANDOFF.md`.

Each module has a matching `*-HANDOFF.md` with integration notes. `sdk-manifest.json` is the machine-readable index of the modules.

## How to use

The client modules (`emblem-wallet-connector.js`, the wrapping companion, the metadata assistant client, `emblem-pay.client.js`, `emblem-collection-handler.js`) load in the browser. The server-side pieces (`emblem-pay-relay-proxy.js`, `emblem-metadata-assistant.server.js`) run on your Node server so secrets and external API calls stay off the browser. Start from each module's HANDOFF for the exact wiring, the functions it exposes, and the order to initialize them.

## How to update

```bash
git clone https://github.com/jakegallen/Emblem-Tools.git
cd Emblem-Tools
# edit files
git add -A
git commit -m "your change"
git push https://x-access-token:<token>@github.com/jakegallen/Emblem-Tools.git main
```

Use a fine-grained token with Contents: Read and Write.

## License

MIT. See `LICENSE`.

Public SDK snapshot (2026-10-20). No secrets or server credentials; these are integration libraries.
