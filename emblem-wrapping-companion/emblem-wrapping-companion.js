// ─────────────────────────────────────────────────────────────────────────────
// Emblem Wrapping Companion  (v1.0.0)
// ─────────────────────────────────────────────────────────────────────────────
// The 2nd pillar. The batteries-included wrap engine on top of:
//   1. Emblem Connector  (emblem-wallet-connector.js) — connect, sign, chain-switch, cross-chain funding, ensureGas
//   2. emblem-vault-sdk                                — createCuratedVault / refreshBalance / fetchMetadata / mint / claim
//   3. Metadata Assistant (emblem-metadata-assistant)  — display art derivation (this module DELEGATES image work to it)
//
// It turns "I have a wallet" into "my asset is wrapped": the full wrap lifecycle (create -> send -> detect deposit ->
// ensure gas -> mint, with a mint nonce auto-retry), deposit detection with per-chain confirmation thresholds, unwrap
// (claim -> sweep), chain-aware explorer links, and resume-after-reload.
//
// The chain-specific "move the asset" step differs per chain. EVM is FULLY IMPLEMENTED here using only the connector (no
// ethers): `makeEvmSender()` moves an ERC-721 to the deposit address. The exotic chains (Bitcoin Ordinals, Counterparty,
// Solana, Stacks, Tezos) are pluggable adapters the host injects, because their send/sweep is chain-library-heavy and
// app-owned (EmblemWrapped's live.js is the reference). Pass them via `senders` / `sweep` / `holdingsResolvers`.
//
// Design contract: no DOM required for the orchestration. User-facing strings never use em dashes.
// ─────────────────────────────────────────────────────────────────────────────

import { Contract } from 'https://esm.sh/ethers@6.17.0';
import { createEmblemWallet, EMBLEM_WALLET_CONNECTOR_VERSION } from './emblem-wallet-connector.js';
import * as MDA from './emblem-metadata-assistant.client.js';
import * as RT from './emblem-relay-tokens.js';

export const EMBLEM_WRAPPING_COMPANION_VERSION = '1.7.0';   // 1.7.0: _qBig handles ethers-v5 BigNumber quote objects ({type:'BigNumber',hex}) + decimals so the curated mint no longer dies on "Cannot convert [object Object] to a BigInt". 1.6.0: makeEvmSender sets an explicit clamped gas limit (estimate+30%, 120k-1.5M) so a flaky RPC can't balloon the NFT-send to the block cap (Polygon "gas limit too high 56M vs 33.5M"). 1.5.0: mintCuratedWithRetry — the PROVEN emblem.vision curated signed-price mint (quote→sign→submit buyWithSignedPrice), works for EVM L2 RWA (Beezie/Courtyard) where the SDK mint path stalls; uniform across chains, returns the ON-CHAIN {tokenId,nftContract}. 1.4.0: buyEvmListing now WAITS for the approval receipt before the fill and REQUIRES a successful fulfillment receipt — a reverted/allowance-racing buy can no longer read as "bought" (which made the app try to wrap an asset never received). 1.3.0: wrapAsset strictly forces the vault owner to the connected EVM wrapping wallet (via wallet.wrappingOwner) so a sending wallet can never own/strand a vault. 1.2.0: adds emblem-relay-tokens — canonical Relay-swappable token list (RELAY_TOKENS_FALLBACK, findRelayToken, getRelayTokensBrowser, buildRelayTokenRoute) so every app prices any token Relay can route to USDC.

// ── Relay token list (re-exported from emblem-relay-tokens.js so consumers only import from this module) ──
export const EMBLEM_RELAY_TOKENS_VERSION = RT.EMBLEM_RELAY_TOKENS_VERSION;
export const RELAY_CHAIN_IDS             = RT.RELAY_CHAIN_IDS;
export const RELAY_TOKENS_FALLBACK       = RT.RELAY_TOKENS_FALLBACK;
export const findRelayToken              = RT.findRelayToken;
export const findRelayTokenByAddress     = RT.findRelayTokenByAddress;
export const getRelayTokensBrowser       = RT.getRelayTokensBrowser;
export const relayPriceIdFor             = RT.priceIdFor;
export const buildRelayTokenRoute        = RT.buildRelayTokenRoute;
export { EMBLEM_WALLET_CONNECTOR_VERSION };
export const EMBLEM_METADATA_ASSISTANT_VERSION = MDA.EMBLEM_METADATA_ASSISTANT_VERSION;

// ── Per-chain confirmation thresholds the deposit watcher waits for before a vault is considered funded. ──
export const CONFIRMATIONS = {
  'Bitcoin': 2, 'Bitcoin Ordinals': 2, 'Counterparty': 2, 'Litecoin': 2, 'Dogeparty': 2, 'Doginals': 2,
  'Stacks': 1, 'Tezos': 2, 'Ethereum': 1, 'Base': 1, 'Polygon': 1, 'Shape': 1, 'Robinhood': 1, 'Solana': 1,
  default: 1,
};
export function confirmationsFor(chain){ return CONFIRMATIONS[chain] != null ? CONFIRMATIONS[chain] : CONFIRMATIONS.default; }

// User-facing wait note. No em dashes.
export function confWaitNote(chain){
  const n = confirmationsFor(chain);
  if (/bitcoin|ordinal|counterparty|litecoin|dogeparty|doginals/i.test(chain || '') || n >= 2)
    return `Bitcoin needs ${n} confirmations, so this can take a little while. You can safely leave and come back, the vault waits under Created.`;
  return `We watch ${chain || 'the chain'} and detect the deposit automatically once it confirms. You can safely leave and come back.`;
}

// ── Chain-aware block-explorer links (address + transaction). ──
const ADDR_EXPLORER = {
  'Ethereum': 'https://etherscan.io/address/', 'Base': 'https://basescan.org/address/',
  'Polygon': 'https://polygonscan.com/address/', 'Shape': 'https://shapescan.xyz/address/',
  'Robinhood': 'https://robin.etherscan.io/address/',
  'Bitcoin': 'https://mempool.space/address/', 'Bitcoin Ordinals': 'https://mempool.space/address/',
  'Stacks': 'https://explorer.hiro.so/address/', 'Tezos': 'https://tzkt.io/',
  'Litecoin': 'https://blockchair.com/litecoin/address/',
  'Dogeparty': 'https://blockchair.com/dogecoin/address/', 'Doginals': 'https://blockchair.com/dogecoin/address/',
};
export function addrExplorer(chain, addr, opts){
  if (!addr) return '';
  opts = opts || {};
  const a = encodeURIComponent(addr);
  if (opts.src === 'sol' || chain === 'Solana') return 'https://solscan.io/account/' + a;
  if (/counterparty/i.test(chain || '')) return (opts.xcpWallet === 'horizon' ? 'https://horizon.market/explorer/addresses/' : 'https://xcp.io/address/') + a;
  const base = ADDR_EXPLORER[chain];
  return base ? base + a : '';
}
export function txExplorer(chain, txid, opts){
  if (!txid) return '';
  opts = opts || {};
  const t = encodeURIComponent(txid);
  if (/counterparty/i.test(chain || '')) return 'https://xcp.io/tx/' + t;
  if (chain === 'Stacks') return 'https://explorer.hiro.so/txid/' + t;
  if (chain === 'Tezos') return 'https://tzkt.io/' + t;
  if (opts.src === 'sol' || chain === 'Solana') return 'https://solscan.io/tx/' + t;
  const map = { 'Ethereum': 'https://etherscan.io/tx/', 'Base': 'https://basescan.org/tx/', 'Polygon': 'https://polygonscan.com/tx/',
    'Shape': 'https://shapescan.xyz/tx/', 'Robinhood': 'https://robin.etherscan.io/tx/',
    'Bitcoin': 'https://mempool.space/tx/', 'Bitcoin Ordinals': 'https://mempool.space/tx/' };
  const base = map[chain];
  return base ? base + t : '';
}

// ── Image resolution: DELEGATED to the Metadata Assistant (the one derivation core), so the dead-area blocklist +
// Counterparty card map are shared with every app. (The old inline card-CDN list is gone; those CDNs died 2026-08-21.) ──
export const artOk = (u) => !!MDA.artOk(u);
export function resolveAssetArt(o){ o = o || {}; const cur = MDA.artOk(o.current); if (cur) return cur;
  if (o.cpMap) { const c = MDA.artOk(MDA.cpAssetImg(o.cpMap, o.assetName, o.longname)); if (c) return c; } return ''; }
export const proxyImg = (u, route) => MDA.proxyImg(u, route);

// ── Gas-minimum enforcement passthrough to the Connector. ──
export function ensureGas(wallet, destChain, needWei, opts){ return wallet.ensureGas(destChain, needWei, opts); }

// ── Deposit detection: poll the SDK until metadata.values populates (the authoritative funded signal). ──
export async function awaitDeposit(sdk, tokenId, opts){
  opts = opts || {};
  const intervalMs = opts.intervalMs || 5000;
  const maxAttempts = opts.maxAttempts || 240;   // ~20 min at 5s
  const onPoll = opts.onPoll || (() => {});
  for (let i = 0; i < maxAttempts; i++){
    try {
      await sdk.refreshBalance(tokenId);
      const md = await sdk.fetchMetadata(tokenId);
      const funded = Array.isArray(md && md.values) && md.values.length > 0;
      onPoll({ attempt: i + 1, funded, metadata: md });
      if (funded) return md;
    } catch (e) { onPoll({ attempt: i + 1, funded: false, error: e && e.message }); }
    if (opts.signal && opts.signal.aborted) throw new Error('Deposit wait cancelled.');
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for the deposit to confirm.');
}

// ── Mint with a nonce auto-retry. Emblem's buyWithSignedPrice can rarely revert "Nonce already used"; re-calling
// performMintChainWithClient fetches a FRESH signed quote (new nonce), so a retry clears it. Up to 3 attempts. ──
export async function mintWithRetry(sdk, client, tokenId, chainId, onSdkProgress, onStage){
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++){
    try { return await sdk.performMintChainWithClient(client, tokenId, chainId, onSdkProgress); }
    catch (e){
      lastErr = e; const msg = String((e && e.message) || e);
      if (attempt < 3 && /nonce already used|nonce too low|replacement transaction|already known/i.test(msg)){
        onStage && onStage('mint-retry', { attempt, reason: 'nonce' });
        await new Promise(r => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// ── CURATED signed-price mint (the path emblem.vision actually uses, incl. EVM L2 RWA: Beezie=Base, Courtyard=Polygon).
// This is EmblemWrapped's PROVEN default (the SDK's performMintChainWithClient stalls for L2 RWA because Emblem's
// per-vault credit lags the L2 deposit; this quote path issues the signed price off the address balance instead).
// Steps: reconcile (emblem-refresh) → sign "Curated Minting: <id>" once → poll /api/mint-curated for the signed price
// (nudging refreshBalance each round so Emblem records the deposit) → submit buyWithSignedPrice on the curated handler.
// Returns { txHash, tokenId (ON-CHAIN), nftContract, is1155 }. Same primitive for EVERY chain, so wrap→mint is uniform;
// only the deposit mechanism + settlement wait differ. `chainId` defaults to '1' (the vault NFT mints on Ethereum).
const CURATED_HANDLER = '0x23859b51117dbfbcdef5b757028b18d7759a4460';   // Emblem curated buyWithSignedPrice handler (ETH mainnet)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
// Coerce an Emblem mint-quote numeric field to BigInt. Emblem serializes big numbers as ethers-v5 BigNumber objects
// ({type:'BigNumber', hex:'0x..'}) through the JSON proxy, so String(v) is "[object Object]" and BigInt() throws
// ("Cannot convert [object Object] to a BigInt"). Handles bigint/number/{hex|_hex|value}/hex-string/decimal-string.
// (Ported from vault-mint's proven qBig — the reference curated-mint path.)
const _qBig = (v) => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (v && typeof v === 'object') { const h = v.hex || v._hex; if (h != null) return BigInt(h); if (v.value != null) return _qBig(v.value); throw new Error('Unexpected numeric quote field: ' + JSON.stringify(v).slice(0, 80)); }
  const s = String(v == null ? '0' : v).trim(); return s.startsWith('0x') ? BigInt(s) : BigInt(s.split('.')[0] || '0');
};
const _qBytes = (v) => (v && v !== '' && v !== '0x') ? v : '0x';
export async function mintCuratedWithRetry(o){
  o = o || {};
  const { sdk, wallet, tokenId, collection } = o;
  const chainId = String(o.chainId || '1');
  const onStage = o.onStage || (() => {});
  const isAborted = o.isAborted || (() => false);
  const api = (p) => (o.apiBase ? (o.apiBase.replace(/\/$/, '') + '/' + p) : p);   // relative by default (served under /pub/{group}/{app}/)
  const stg = (m) => { try { onStage(String(m || '')); } catch (e) {} };
  const bail = () => { if (isAborted()) throw new Error('Wrap cancelled.'); };
  const id = String(tokenId || '');
  if (!/^\d+$/.test(id)) throw new Error('Invalid vault token id for mint.');
  if (!wallet || !wallet.evmSigner) throw new Error('Connect an EVM wallet to mint.');
  await wallet.ensureChain('0x1');   // the vault NFT mints on Ethereum mainnet regardless of the source deposit chain
  const signer = wallet.evmSigner;
  const me = String(wallet.evmAddress || '').toLowerCase();
  const forceLive = async () => { try { return await fetch(api('api/emblem-refresh?tokenId=' + encodeURIComponent(id))).then(r => r.json()); } catch (e) { return null; } };
  const doneIfMinted = (lr) => {
    const owner = lr && lr.owner && !/^0x0+$/i.test(lr.owner) ? String(lr.owner).toLowerCase() : '';
    if (!(lr && (lr.minted || lr.status === 'minted') && owner)) return null;
    if (!me || owner === me) return { txHash: '', tokenId: lr.onchainId ? String(lr.onchainId) : '', nftContract: lr.contract || '', is1155: false, alreadyMinted: true };
    throw new Error('This vault is already wrapped (owner ' + owner.slice(0, 6) + '…). Check your vaulted grails.');
  };
  stg('Confirming your deposit with Emblem…');
  { const d = doneIfMinted(await forceLive()); if (d) return d; }
  bail();
  const chainL = String((collection && collection.chain) || '').toLowerCase();
  const isFast = /^(ethereum|base|polygon|shape)$/.test(chainL) || !!(collection && (collection.kind === 'sol' || collection.src === 'sol'));
  const DEADLINE = Date.now() + (isFast ? 240000 : 1500000);   // 4 min fast (EVM/Sol), 25 min slow (Bitcoin/Counterparty/etc.)
  stg('Approve the wrap in your wallet…');
  const userSig = await signer.signMessage('Curated Minting: ' + id);   // ONE signature, reused across poll rounds
  bail();
  const quoteFor = async () => {
    let resp = null; try { resp = await fetch(api('api/mint-curated'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tokenId: id, signature: userSig, chainId }) }).then(r => r.json()); } catch (e) {}
    const cand = resp && (resp._signature ? resp : (resp.data || resp.result || resp.quote || resp.signedPrice || resp));
    if (cand && cand._signature && cand._nftAddress && cand._price != null && cand._to) return { q: cand };
    if (resp && typeof resp.ready !== 'undefined' && (resp.errored === true || resp.isFinishedForever === true)) throw new Error('Emblem could not finalize this mint (' + (resp.error || resp.msg || resp.reason || 'the deposit may still be confirming') + '). Your deposit is safe in the vault; try again shortly.');
    if ((resp && resp.signedByCreator === false) || (cand && cand.signedByCreator === false)) throw new Error('This vault can only be minted by the wallet that created it. Switch to that account and try again.');
    return { q: null };
  };
  let q = null;
  while (Date.now() < DEADLINE) {
    bail();
    try { const d = doneIfMinted(await forceLive()); if (d) return d; } catch (e) { if (/already wrapped/i.test(String(e && e.message))) throw e; }
    try { await sdk.refreshBalance(id); } catch (e) {}   // TRIGGER Emblem to record the deposit so the quote issues
    const r = await quoteFor(); if (r.q) { q = r.q; break; }
    stg('Finalizing your wrap. The wallet transaction will appear shortly…');
    await new Promise(r => setTimeout(r, 15000));
  }
  if (!q) throw new Error('The mint is not ready yet. Your asset is safe in the vault and will be listable shortly.');
  bail();
  const handler = new Contract(CURATED_HANDLER, ['function buyWithSignedPrice(address _nftAddress,address _payment,uint256 _price,address _to,uint256 _tokenId,uint256 _nonce,bytes _signature,bytes serialNumber,uint256 _amount) payable'], signer);
  const NONCE_RE = /nonce.*already.*used|already.*used.*nonce|used or canceled/i;
  for (let mt = 1; mt <= 3; mt++) {
    bail();
    const price = _qBig(q._price); const serial = _qBytes(q.serialNumber);
    const margs = [q._nftAddress, ZERO_ADDR, price, q._to, _qBig(q._tokenId), _qBig(q._nonce), q._signature, serial, 1n];
    let nonceUsed = false;
    try { await handler.buyWithSignedPrice.staticCall(...margs, { value: price }); }
    catch (se) { if (NONCE_RE.test(String((se && (se.reason || se.shortMessage || se.message)) || ''))) nonceUsed = true; }
    if (nonceUsed) { if (mt >= 3) throw new Error('Emblem mint nonce kept colliding (rare). Your asset is safe in the vault; try again shortly.'); stg('Refreshing the mint authorization…'); const f = await quoteFor(); if (f.q) q = f.q; else await new Promise(r => setTimeout(r, 4000)); continue; }
    stg('Ready. Approve the wrap in your wallet…');
    let mGas = 300000n; try { const g = await handler.buyWithSignedPrice.estimateGas(...margs, { value: price }); mGas = (g * 13n) / 10n; } catch (e) {}
    const tx = await handler.buyWithSignedPrice(...margs, { value: price, gasLimit: mGas });
    stg('Waiting for confirmation…');
    let rc = null; try { rc = await tx.wait(); } catch (we) { rc = (we && we.receipt) || null; }
    if (rc && rc.status === 0 && mt < 3) { stg('Refreshing the mint authorization…'); const f = await quoteFor(); if (f.q) { q = f.q; continue; } }
    try { fetch(api('api/emblem-refresh?tokenId=' + encodeURIComponent(id))); } catch (e) {}   // reconcile Created → Minted on Emblem
    return { txHash: (tx && tx.hash) || '', tokenId: String(_qBig(q._tokenId)), nftContract: q._nftAddress, is1155: false };
  }
  throw new Error('The mint did not complete. Your asset is safe in the vault; try Wrap again.');
}

// ── The wrap lifecycle state machine: create -> send -> detect -> ensure gas -> mint (nonce-safe). ──
// `senders[srcChain]` moves the asset in; if absent, MANUAL deposit (onStage('await-deposit-manual', {depositAddr})).
// Pass `resumeVault` to skip create/send and resume a previously-created vault at the detect step (reload safety net).
// Returns { tokenId, depositAddr, sendTxid, mintTx, metadata }.
export async function wrapAsset(o){
  const { sdk, client, wallet, collection, asset } = o;
  const senders = o.senders || {};
  const chainId = o.chainId || 1;                 // the vault mints on Ethereum mainnet by default
  const onStage = o.onStage || (() => {});
  if (!sdk) throw new Error('wrapAsset needs an emblem-vault-sdk instance.');
  if (!client) throw new Error('wrapAsset needs a signer client (EmblemVaultClient) for minting.');
  const srcChain = (collection && (collection.chain || collection.srcChain)) || '';

  let vault, tokenId, depositAddr, sendTxid = '';
  if (o.resumeVault){
    vault = o.resumeVault; tokenId = vault.tokenId; depositAddr = pickDepositAddress(vault, collection);
    onStage('resumed', { tokenId, depositAddr });
  } else {
    // 1. Create the vault.
    onStage('create', { collection: collection && collection.name });
    const template = o.template || (o.buildTemplate ? await o.buildTemplate(collection, asset) : null);
    if (!template) throw new Error('wrapAsset needs a `template` (or a `buildTemplate` fn) to create the vault.');
    // STRICT owner enforcement: a vault is ALWAYS created under the connected EVM wrapping wallet, never a sending wallet
    // (Solana/BTC/Ordinals/Counterparty/Tezos/Stacks). Resolving the owner here, in the shared path, makes it impossible
    // for any app to strand a vault under an address the user does not recognize. Prefer the connector's wrappingOwner()
    // (throws if no EVM wallet); fall back to wallet.evmAddress for older connectors.
    if (wallet) {
      let _owner = '';
      try { _owner = (typeof wallet.wrappingOwner === 'function') ? await wallet.wrappingOwner() : (wallet.evmAddress || ''); }
      catch (e) { throw e; }
      if (!_owner || !/^0x[0-9a-fA-F]{40}$/.test(String(_owner))) throw new Error('Connect an Ethereum (EVM) wallet to wrap. Your Solana/Bitcoin wallet is only the sending wallet; the vault is always created under your EVM wallet.');
      template.fromAddress = _owner; template.toAddress = _owner;
    }
    vault = await sdk.createCuratedVault(template, o.onSdkProgress);
    tokenId = vault.tokenId;
    depositAddr = pickDepositAddress(vault, collection);
    onStage('created', { tokenId, depositAddr, vault });

    // 2. Move the asset into the vault: pluggable per-chain sender, or manual.
    const sender = senders[srcChain] || senders[collection && collection.src] || null;
    if (sender){
      onStage('send', { srcChain, depositAddr });
      sendTxid = (await sender({ vault, depositAddr, asset, wallet, collection, onStage })) || '';
      onStage('sent', { sendTxid, depositAddr });
    } else {
      onStage('await-deposit-manual', { depositAddr, hint: confWaitNote(srcChain) });
    }
  }

  // 3. Wait for the deposit to confirm.
  onStage('detect', { depositAddr, confirmations: confirmationsFor(srcChain) });
  const metadata = await awaitDeposit(sdk, tokenId, {
    intervalMs: o.pollIntervalMs, maxAttempts: o.pollMaxAttempts, signal: o.signal,
    onPoll: (p) => onStage('detect-poll', p),
  });

  // 4. Ensure the mint chain has gas (no-op when already covered), then mint (nonce-safe).
  if (wallet && o.mintGasWei){
    onStage('ensure-gas', { chainId, needWei: String(o.mintGasWei) });
    try { await wallet.ensureGas(chainId, o.mintGasWei, { onStage: (m) => onStage('gas', { message: m }) }); }
    catch (e) { onStage('gas-skip', { error: e && e.message }); }   // non-fatal
  }
  onStage('mint', { tokenId, chainId });
  const result = await mintWithRetry(sdk, client, tokenId, chainId, o.onSdkProgress, onStage);
  const mintTx = result && (result.txHash || result.hash || result.tx);
  onStage('done', { tokenId, mintTx });
  return { tokenId, depositAddr, sendTxid, mintTx, metadata };
}

// Choose the right deposit address from a freshly created vault for the collection's source coin.
export function pickDepositAddress(vault, collection){
  const addrs = (vault && vault.addresses) || [];
  if (!addrs.length) return (vault && (vault.depAddr || vault.depositAddr)) || '';
  const want = (collection && (collection.coin || collection.depositCoin)) || '';
  if (want){ const m = addrs.find(a => String(a.coin || '').toUpperCase() === String(want).toUpperCase()); if (m) return m.address; }
  return addrs[0].address;
}

// ── Unwrap lifecycle: claim (burn/unlock the NFT + reveal keys) then sweep the underlying asset out. ──
export async function unwrap(o){
  const { sdk, client, tokenId } = o;
  const chainId = o.chainId || 1;
  const onStage = o.onStage || (() => {});
  if (!sdk || !client) throw new Error('unwrap needs an sdk + signer client.');
  onStage('claim', { tokenId });
  const claimResult = await sdk.performClaimChainWithClient(client, tokenId, chainId, o.onSdkProgress);
  onStage('claimed', { tokenId });
  let sweepTxid = '';
  if (typeof o.sweep === 'function'){
    const metadata = await sdk.fetchMetadata(tokenId).catch(() => null);
    onStage('sweep', { tokenId, destAddress: o.destAddress });
    sweepTxid = (await o.sweep({ tokenId, keys: claimResult && claimResult.keys, destAddress: o.destAddress, metadata, collection: o.collection, onStage })) || '';
    onStage('swept', { sweepTxid });
  }
  return { tokenId, claimResult, sweepTxid };
}

// ── Holdings discovery: routes to a per-chain resolver the host registers. ──
export async function holdings(collection, address, resolvers){
  const chain = (collection && (collection.chain || collection.src)) || '';
  const resolve = (resolvers && (resolvers[chain] || resolvers[collection && collection.src])) || null;
  if (!resolve) throw new Error('No holdings resolver registered for chain ' + (chain || '?') + '.');
  return resolve({ collection, address });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVM adapter (FULLY IMPLEMENTED, no ethers): move an ERC-721 to the vault deposit address using only the connector.
// ─────────────────────────────────────────────────────────────────────────────
export const EVM_CHAIN_HEX = { 'Ethereum': '0x1', 'Base': '0x2105', 'Polygon': '0x89', 'Shape': '0x168', 'Robinhood': '0x1237' };
const _pad32Addr = (a) => String(a || '').replace(/^0x/i, '').toLowerCase().padStart(64, '0');
const _pad32Hex = (h) => String(h || '').replace(/^0x/i, '').toLowerCase().padStart(64, '0');
const _SAFE_TRANSFER_FROM = '0x42842e0e';   // safeTransferFrom(address,address,uint256)

// senders['Base'|'Polygon'|'Shape'|'Robinhood'|'Ethereum'] = makeEvmSender(). Reads srcContract + tokenId off the asset
// (or collection.srcContracts[0]), switches the wallet to the source chain, and sends safeTransferFrom to the deposit addr.
export function makeEvmSender(opts){
  opts = opts || {};
  return async function evmSend({ depositAddr, asset, wallet, collection, onStage }){
    if (!wallet || !wallet.evmEip1193) throw new Error('EVM send needs a connected EVM wallet (connector).');
    const srcContract = (asset && (asset.contract || asset.srcContract)) || (collection && collection.srcContracts && collection.srcContracts[0]) || opts.srcContract;
    const tokenId = asset && (asset.tokenId != null ? asset.tokenId : asset.token_id);
    const chainHex = EVM_CHAIN_HEX[(collection && collection.chain) || ''] || opts.chainHex;
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(srcContract || '')) || tokenId == null || !chainHex)
      throw new Error('EVM send needs srcContract (0x40) + tokenId + a known chain.');
    const from = wallet.evmAddress;
    if (!from) throw new Error('Connect an EVM wallet to send the asset.');
    onStage && onStage('send-switch', { chainHex });
    await wallet.ensureChain(chainHex);
    const data = _SAFE_TRANSFER_FROM + _pad32Addr(from) + _pad32Addr(depositAddr) + _pad32Hex(BigInt(tokenId).toString(16));
    // Set an explicit, sane gas limit. Without one the wallet estimates, and on a flaky RPC (e.g. Polygon) that estimate
    // can balloon to the block cap (seen: 56,000,000 vs Polygon's 33,554,432 per-tx cap → "gas limit too high" reject).
    // An ERC-721 safeTransferFrom to an EOA vault address is ~60-150k; estimate + 30%, clamped to [120k, 1.5M].
    let gas = '0x493e0';   // 300000 fallback if estimate fails
    try {
      const est = await wallet.evmEip1193.request({ method: 'eth_estimateGas', params: [{ from, to: srcContract, data }] });
      let g = (BigInt(est) * 13n) / 10n;
      if (g < 120000n) g = 120000n; if (g > 1500000n) g = 1500000n;
      gas = '0x' + g.toString(16);
    } catch (e) {}
    onStage && onStage('send-sign', { srcContract, tokenId });
    return await wallet.evmEip1193.request({ method: 'eth_sendTransaction', params: [{ from, to: srcContract, data, gas }] });
  };
}

// EVM sweep (reference): send the ERC-721 out of the vault using the REVEALED key. Needs an ethers instance + an RPC
// (the connector signs as the USER, not an arbitrary key, so unwrap-sweep is intentionally ethers-driven). Pass
// makeEvmSweep({ ethers, rpcFor: chain => rpcUrl }). Returns the sweep tx hash.
export function makeEvmSweep(cfg){
  cfg = cfg || {};
  return async function evmSweep({ keys, destAddress, metadata, collection, onStage }){
    const ethers = cfg.ethers; if (!ethers) throw new Error('makeEvmSweep needs an ethers instance.');
    const chain = (collection && collection.chain) || (metadata && metadata.chain) || '';
    const rpc = cfg.rpcFor ? cfg.rpcFor(chain) : cfg.rpcUrl;
    const pk = keys && (keys.evm || keys.eth || keys.privateKey || keys.private_key);
    const srcContract = (collection && collection.srcContracts && collection.srcContracts[0]) || cfg.srcContract || (metadata && metadata.contract);
    const tokenId = (metadata && (metadata.tokenId != null ? metadata.tokenId : (metadata.values && metadata.values[0] && metadata.values[0].tokenId))) ;
    if (!pk || !rpc || !srcContract || tokenId == null) throw new Error('EVM sweep needs the revealed key + RPC + srcContract + tokenId.');
    const provider = new ethers.JsonRpcProvider(rpc);
    const signer = new ethers.Wallet(pk, provider);
    const c = new ethers.Contract(srcContract, ['function safeTransferFrom(address,address,uint256)'], signer);
    onStage && onStage('sweep-send', { srcContract, tokenId, destAddress });
    const tx = await c.safeTransferFrom(await signer.getAddress(), destAddress, tokenId);
    await tx.wait();
    return tx.hash;
  };
}

// A senders map wired for all EVM chains at once (Base/Polygon/Shape/Robinhood/Ethereum), out of the box.
export function evmSenders(){
  const s = makeEvmSender();
  return { 'Base': s, 'Polygon': s, 'Shape': s, 'Robinhood': s, 'Ethereum': s };
}

// ─────────────────────────────────────────────────────────────────────────────
// EVM marketplace BUY (Seaport fulfillment): send a prepared purchase tx from the connected wallet, doing the ERC20
// approval first when the listing is priced in an ERC20 (USDC on Base/Polygon/Robinhood). `fulfill` is exactly what a
// server buy-fulfill route returns: { ready, to, value, data, erc20?:{token,amount,spender}, via }. This drives BOTH
// OpenSea's native fulfillment tx AND the self-built Seaport tx (via:'self') the server falls back to for chains OpenSea
// won't fulfill (Robinhood: it indexes the listings but returns "Order not valid" on fulfillment_data). Returns the
// purchase tx hash so the caller can hand (contract, tokenId) to the wrap tail. No em dashes in user-facing strings.
// ─────────────────────────────────────────────────────────────────────────────
const _ERC20_ALLOWANCE = '0xdd62ed3e';   // allowance(address owner, address spender)
const _ERC20_APPROVE   = '0x095ea7b3';   // approve(address spender, uint256 amount)
const _toHexWei = (v) => { try { return '0x' + BigInt(v == null ? 0 : v).toString(16); } catch (e) { return '0x0'; } };

export async function buyEvmListing(o){
  o = o || {};
  const fulfill = o.fulfill, wallet = o.wallet;
  const onStage = o.onStage || (() => {});
  if (!fulfill || fulfill.ready === false || !fulfill.to || !fulfill.data)
    throw new Error('That listing could not be prepared for purchase. It may have just been taken; refresh and try again.');
  if (!wallet || !wallet.evmEip1193) throw new Error('Connect an EVM wallet to buy.');
  const from = wallet.evmAddress; if (!from) throw new Error('Connect an EVM wallet to buy.');
  const req = (params) => wallet.evmEip1193.request(params);
  const chainHex = o.chainHex || (o.chain && EVM_CHAIN_HEX[o.chain]) || null;
  if (chainHex){ onStage('buy-switch', { chainHex }); await wallet.ensureChain(chainHex); }
  // Poll for a mined receipt. Returns the receipt (has .status) or null on timeout. Base/Polygon confirm in seconds.
  const waitReceipt = async (hash, timeoutMs) => {
    const deadline = Date.now() + (timeoutMs || 90000);
    while (Date.now() < deadline){
      let rc = null; try { rc = await req({ method:'eth_getTransactionReceipt', params:[hash] }); } catch (err) {}
      if (rc && rc.status != null) return rc;
      await new Promise(r => setTimeout(r, 2500));
    }
    return null;
  };
  // ERC20-priced listing (USDC): approve the spender for the exact amount first, only if the current allowance is short.
  // CRITICAL: WAIT for the approval to confirm before sending the fulfillment — otherwise the fill lands before the
  // allowance is set and REVERTS (this is what made buys "succeed" then fail to wrap).
  const e = fulfill.erc20;
  if (e && e.token && e.spender && e.amount){
    const need = BigInt(e.amount);
    let have = 0n;
    try { const res = await req({ method:'eth_call', params:[{ to: e.token, data: _ERC20_ALLOWANCE + _pad32Addr(from) + _pad32Addr(e.spender) }, 'latest'] }); if (res && res !== '0x') have = BigInt(res); } catch (err) {}
    if (have < need){
      onStage('buy-approve', { token: e.token, spender: e.spender, amount: e.amount });
      const data = _ERC20_APPROVE + _pad32Addr(e.spender) + _pad32Hex(need.toString(16));
      const ah = await req({ method:'eth_sendTransaction', params:[{ from, to: e.token, data }] });
      onStage('buy-approve-wait', { txHash: ah });
      const arc = await waitReceipt(ah, 90000);
      if (arc && String(arc.status) === '0x0') throw new Error('The token approval failed onchain. No funds were spent; try again.');
      // If the approval timed out (arc null) we still proceed — the fulfillment below is receipt-checked and will surface a
      // clear revert if the allowance is not yet effective, rather than a false success.
    }
  }
  // Send the fulfillment, then REQUIRE a successful receipt. A reverted fill (listing taken, price moved, allowance not
  // yet set) must NOT read as "bought" — that made the app try to wrap an asset the user never received.
  onStage('buy-send', { to: fulfill.to, via: fulfill.via || 'opensea', erc20: !!e });
  const txHash = await req({ method:'eth_sendTransaction', params:[{ from, to: fulfill.to, data: fulfill.data, value: e ? '0x0' : _toHexWei(fulfill.value) }] });
  onStage('buy-confirm', { txHash });
  const rc = await waitReceipt(txHash, 120000);
  if (!rc) throw new Error('The purchase did not confirm in time. Check your wallet before retrying so you do not buy twice.');
  if (String(rc.status) === '0x0') throw new Error('The purchase reverted onchain, no funds were spent. The listing was likely just taken; refresh and try another.');
  onStage('buy-sent', { txHash });
  return txHash;
}

// ── Convenience factory: bind SDK + connector wallet + adapters into one object with the lifecycle methods. ──
// EVM senders are wired by default; pass `senders`/`sweep`/`holdingsResolvers` to add the exotic chains + unwrap.
export function createWrappingCompanion(cfg){
  cfg = cfg || {};
  const wallet = cfg.wallet || (cfg.walletCtx ? createEmblemWallet(cfg.walletCtx) : null);
  const sdk = cfg.sdk;
  const client = cfg.client;
  const senders = Object.assign(evmSenders(), cfg.senders || {});   // EVM out of the box; host adds BTC/Sol/CP/Stacks/Tezos
  const sweep = cfg.sweep || (cfg.ethers ? makeEvmSweep({ ethers: cfg.ethers, rpcFor: cfg.rpcFor }) : null);
  const resolvers = cfg.holdingsResolvers || {};
  return {
    version: EMBLEM_WRAPPING_COMPANION_VERSION,
    connectorVersion: EMBLEM_WALLET_CONNECTOR_VERSION,
    metadataAssistantVersion: EMBLEM_METADATA_ASSISTANT_VERSION,
    relayTokensVersion: EMBLEM_RELAY_TOKENS_VERSION,
    wallet, sdk, senders,
    confirmationsFor, confWaitNote, addrExplorer, txExplorer,
    artOk, resolveAssetArt, proxyImg,
    ensureGas: (destChain, needWei, opts) => wallet.ensureGas(destChain, needWei, opts),
    awaitDeposit: (tokenId, opts) => awaitDeposit(sdk, tokenId, opts),
    holdings: (collection, address) => holdings(collection, address, resolvers),
    wrapAsset: (o) => wrapAsset({ sdk, client, wallet, senders, ...o }),
    unwrap: (o) => unwrap({ sdk, client, sweep, ...o }),
    buyEvmListing: (o) => buyEvmListing({ wallet, ...o }),
    // Relay token list helpers (bound for convenience)
    relayTokens: RELAY_TOKENS_FALLBACK,
    getRelayTokens: getRelayTokensBrowser,
    findRelayToken: (symbol, chain, list) => findRelayToken(symbol, chain, list || RELAY_TOKENS_FALLBACK),
    findRelayTokenByAddress: (address, list) => findRelayTokenByAddress(address, list || RELAY_TOKENS_FALLBACK),
  };
}

export default {
  createWrappingCompanion, wrapAsset, unwrap, awaitDeposit, mintWithRetry, holdings, pickDepositAddress,
  makeEvmSender, makeEvmSweep, evmSenders, EVM_CHAIN_HEX,
  addrExplorer, txExplorer, confWaitNote, confirmationsFor, artOk, resolveAssetArt, proxyImg, ensureGas,
  // Relay token list
  RELAY_TOKENS_FALLBACK, RELAY_CHAIN_IDS, findRelayToken, findRelayTokenByAddress,
  getRelayTokensBrowser, relayPriceIdFor, buildRelayTokenRoute,
  // Versions
  EMBLEM_WRAPPING_COMPANION_VERSION, EMBLEM_WALLET_CONNECTOR_VERSION, EMBLEM_METADATA_ASSISTANT_VERSION,
  EMBLEM_RELAY_TOKENS_VERSION,
};
