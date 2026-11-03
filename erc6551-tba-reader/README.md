# erc6551-tba-reader

A small, read-only helper for [ERC-6551](https://eips.ethereum.org/EIPS/eip-6551) token-bound accounts (TBAs) - the smart-contract wallet every NFT can own. MIT licensed, extracted from Emblem's Vault Robbers.

It does the common jobs around TBAs and does them at **collection scale on weak RPCs**:

- resolve the deterministic TBA address for a tokenId, or a whole collection
- read an ERC-20 balance held *inside* each TBA ("what's in the NFT's wallet")
- map which wallet owns each tokenId
- build (but **never sign**) the calldata for the NFT owner to sweep an ERC-20 out of a TBA to themselves

**The trick that makes it work:** public RPCs frequently reject ethers' default JSON-RPC array batching, so a naive `ownerOf`/`balanceOf` sweep over thousands of tokens falls over. This creates providers with `batchMaxCount: 1` and fans out through **Multicall3** (one `eth_call` per chunk of up to 500) instead. That alone makes whole-collection reads reliable on a cheap/public RPC.

No keys, no secrets, no hardcoded project addresses - you pass your own config. It reads on-chain and builds unsigned calldata; the NFT owner signs with their own wallet.

## Usage

```js
const { createReader } = require('erc6551-tba-reader');

const reader = createReader({
  rpc: 'https://your-rpc',          // required
  chainId: 4663,                    // required
  nft: '0xYourCollection',          // required
  accountImpl: '0xAccountV3Impl',   // required (your ERC-6551 account implementation)
  token: '0xYourErc20',             // optional (needed for balance reads / claim calldata)
  // registry, multicall3, salt all default to the canonical values
});

await reader.tbaOf(42);                       // deterministic TBA address for token #42
await reader.ownerMap(1000);                  // { tokenId: ownerWallet } for ids 1..1000
await reader.owned('0xWallet', 1000);         // tokens that wallet holds, each with TBA + balance
await reader.tokenBalances([tba1, tba2]);     // ERC-20 balance inside each TBA (BigInt[])
await reader.claimCalldata(42, '0xOwner');    // unsigned steps for the owner to sweep the token out
```

`claimCalldata` verifies on-chain that `0xOwner` actually owns the token, then returns `steps` (activate the account if not yet deployed, then `execute` an ERC-20 transfer to the owner) for the owner to submit from their own wallet. It never signs anything.

Defaults: registry = `0x000000006551c19487814612e58FE06813775758` (ERC-6551 Registry v0.3.1), Multicall3 = `0xcA11bde05977b3631167028862bE2a173976CA11`, salt = `0x00…00`. Override any of them in the config.

Run the self-test: `node index.js --self-test`

## License

MIT. Use it, fork it, build on it.
