// ─────────────────────────────────────────────────────────────────────────────
// Emblem Metadata Assistant — SERVER half (Node / Express)
// ─────────────────────────────────────────────────────────────────────────────
// The third pillar (Emblem Connector = wallet, Wrapping Companion = wrap UX, Metadata Assistant = derive display art/name).
// The ONE server-side derivation core, shared by EmblemWrapped, EmblemScan, and Bazaaro. A factory that each app's
// server.js calls with its own deps (DB access + fetch + the Emblem meta base + optional on-disk catalog), returning a
// `resolveVaultArt` + a persistent cache + a `/api/vault-art` route mounter. The blocklist mirrors the client's DEAD_ART
// exactly — keep them in sync (see emblem-metadata-assistant.client.js). This is where the xchain/github CDN-death fix lives.
//
// Resolution order (first real hit wins, dead URLs rejected at EVERY step):
//   vm_art persistent cache (by token_id) → shared corpus tables (by token_id / asset) → on-disk catalog →
//   Counterparty card CDN by asset name (hnft/bitcorns; xchain+github are DEAD and blocklisted) →
//   Emblem content metadata (PREFER values[].image, the real card, over m.image which is often a placeholder/dead link).
// ─────────────────────────────────────────────────────────────────────────────

const EMBLEM_METADATA_ASSISTANT_VERSION = '0.9.0';   // 0.9.0: resolveEmblemVaultId({nft,tokenId}) + emblemViewerUrl(…) — canonical (wrapper contract + on-chain tokenId) → the vault's real Emblem id via GET {EV2}/v3/meta/{contract}/{tokenId}.tokenId, so the EmblemWrapped viewer link never uses the raw on-chain id (which resolves to an UNRELATED vault for ERC-721 wrappers). Uniform across ERC-721 + ERC-1155. // 0.8.0: cleanName(name,collection) — canonical display-name standardizer (strips a redundant collection prefix + collapses a doubled name), shared across apps so item names never read "NodeMonkes NodeMonkes" / "Beezie Collectibles LUBU". // 0.7.0: sourceArtByOwner(collection,addresses,{evmHoldings,solHoldings}) — resolve wrapped-RWA (Courtyard/Beezie/Cope/Robinhood/Collector Crypt) REAL item art from the vault's own source-chain deposit-address holdings, so raffle/consign art never blanks to EVTESTCOMMON. // 0.6.0: SOURCE_COLLECTIONS registry + sourceArt(collection,srcTokenId) — wrapped-RWA collections whose real art lives on a SOURCE chain (OnChainHoodies/StonkBrokers→Robinhood, Beezie→Base, Courtyard→Polygon, Cope Salada→Shape) resolve the source on-chain art from the source contract, so apps holding only the ETH wrapper (e.g. EmblemScan activity rows) get the true item art. // 0.5.0: built-in EVM on-chain art reader (tokenURI incl. inline image_data SVG; Base/Polygon/Shape/Robinhood)

// Dead-area patterns as a STRING array = the single shared source. The client's DEAD_ART_SOURCES is copy-paste IDENTICAL,
// so a mismatch between the two halves is a trivial diff. Client builds RegExp[]; server builds one combined RegExp.
const DEAD_ART_SOURCES = [
  'EVTESTCOMMON', 's:evmetadata', 'api\\.emblemvault\\.io/s:',
  'emblem\\.finance/[a-z0-9_-]+\\.(png|gif|jpe?g|webp|svg)',
  'nft2?-cdn\\.alchemy', 'res\\.cloudinary\\.com/alchemyapi', 'convert-png',
  'playtoearngames\\.com', 'bellscdn\\.ordinalswallet', 'xchain\\.io/img/cards', 'githubusercontent\\.com/EmblemCompany/vaultImages/master',
];
const DEAD_ART = new RegExp(DEAD_ART_SOURCES.join('|'), 'i');
const _unwrapImg = u => { const s = String(u || ''); const m = s.match(/\/cdn-cgi\/image\/[^/]*\/((?:https?|ipfs|ar):\/\/.+)$/i); return m ? m[1] : s; };
const artOkSrv = u => { const s = _unwrapImg(String(u || '')); if (/^data:image\//i.test(s)) return s; return (/^(https?|ipfs|ar):/i.test(s) && !DEAD_ART.test(s)) ? s : ''; };

// Counterparty CARD art by ASSET NAME (hnft + bitcorns; the xchain + github sources are dead and intentionally omitted).
// Bounded, validated (only a real image content-type counts), cached in-memory. Returns '' if nothing real exists.
const _cpArtFamily = new Set(['Spells of Genesis','Rare Pepe','Fake Rares','Fake Commons','Dank Rares','Counterparty','Fomojis','Fomojis 2.0','Bitcorn','Bitcorn Crops','Dogeparty','Bitcoin Stamps']);
// Canonical display-name standardizer (mirror of the client half). Given a raw item name + its collection, return just
// the token name: strip an EXACT collection-name prefix (with an optional separator), collapse an exact doubled name.
// Safe: only an exact prefix is removed, so "Bitcoin Puppet #9326" (collection "Bitcoin Puppets") is left untouched.
function cleanName(name, collection){
  let n = String(name == null ? '' : name).trim();
  const c = String(collection == null ? '' : collection).trim();
  if (!n) return n;
  if (c){
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stripped = n.replace(new RegExp('^' + esc + '\\s*[·:\\-]?\\s+', 'i'), '').trim();
    if (stripped) n = stripped;
  }
  const parts = n.split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) n = parts[0];
  return n.trim() || String(name == null ? '' : name).trim();
}

function makeCpCardArt(){
  const cache = new Map();          // asset -> {url} (positive, kept) | {url:'', until} (clean miss, short TTL)
  const NEG_TTL = 10 * 60 * 1000;   // a MISS is remembered only 10 min, so a transient CDN outage can NEVER permanently blank a real card
  return async function cpCardArt(asset, collection, chain){
    // Run for the known CP families OR any Counterparty-family CHAIN, so an unregistered CP collection still resolves.
    if (!_cpArtFamily.has(collection) && !/counterparty|dogeparty|stamp/i.test(String(chain || ''))) return '';
    const a = String(asset || '').trim().split(/[\s|#]/)[0].toUpperCase();
    if (!/^[A-Z0-9.]{3,}$/.test(a) || /^(PLACEHOLDER|LOADING|UNTITLED)$/.test(a)) return '';
    const c = cache.get(a);
    if (c && (c.url || (c.until && Date.now() < c.until))) return c.url;   // positive kept; negative honored only until TTL
    const cand = [
      `https://api.explorer.hnft.wtf/images/${a}.jpg`, `https://api.explorer.hnft.wtf/images/${a}.png`, `https://api.explorer.hnft.wtf/images/${a}.gif`,
    ];
    if (collection === 'Bitcorn Crops' || collection === 'Bitcorn') cand.push(`https://bitcorns.com/storage/tokens/hd/${a}.png`, `https://bitcorns.com/storage/tokens/${a}.png`);
    let out = '', sawNetErr = false;
    for (const u of cand){
      for (let attempt = 0; attempt < 2 && !out; attempt++){
        try{ const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 7000);
          const r = await fetch(u, { redirect: 'follow', signal: ctl.signal }).catch(() => null); clearTimeout(to);
          if (!r){ sawNetErr = true; continue; }                                    // network/timeout, NOT a definitive absence, retry-able
          if (r.status === 404) break;                                              // definitively absent at this source, next source
          if (r.ok && /^image\//i.test(r.headers.get('content-type') || '')){ out = u; break; }
        }catch(e){ sawNetErr = true; }
      }
      if (out) break;
    }
    if (cache.size > 5000) cache.clear();
    if (out) cache.set(a, { url: out });                                            // real art, remember it
    else if (!sawNetErr) cache.set(a, { url: '', until: Date.now() + NEG_TTL });     // clean 404 miss: short TTL. A network error is NOT cached, so it retries next call.
    return out;
  };
}

// Built-in EVM on-chain art reader (no ethers dep — raw eth_call). Reads the token's tokenURI (or ERC-1155 uri), parses
// data:application/json or an http/ipfs metadata doc, and returns image / image_url / image_data. `image_data` is the
// INLINE SVG field used by fully-on-chain collections (Robinhood OnChainHoodies etc.) where `image` is empty — the case
// that made those show a collection logo. Returns a validated URL (artOkSrv passes data:image/* through, blocks dead art).
const EVM_ART_RPC = {
  ethereum: 'https://ethereum-rpc.publicnode.com', eth: 'https://ethereum-rpc.publicnode.com',
  base: 'https://base-rpc.publicnode.com', polygon: 'https://polygon-bor-rpc.publicnode.com', matic: 'https://polygon-bor-rpc.publicnode.com',
  shape: 'https://mainnet.shape.network', robinhood: 'https://rpc.mainnet.chain.robinhood.com',
};
function _decodeAbiString(ret){ try{ const h = String(ret || '').replace(/^0x/, ''); if (h.length < 128) return ''; const len = parseInt(h.slice(64, 128), 16); if (!(len > 0)) return ''; return Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8'); }catch(e){ return ''; } }
async function _ethCall(rpc, to, data){ try{ const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }), signal: AbortSignal.timeout(9000) }).then(x => x.json()).catch(() => null); return (r && r.result) || ''; }catch(e){ return ''; } }
// SSRF guard: a token's on-chain tokenURI is attacker-influenceable; never let it point the server at a private/loopback/link-local host.
function _ssrfSafeUrl(u){ try{ const url = new URL(u); if (url.protocol !== 'https:' && url.protocol !== 'http:') return false; const h = url.hostname.toLowerCase(); if (h === 'localhost' || h.endsWith('.internal') || h.endsWith('.local')) return false; if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false; return true; }catch(e){ return false; } }
async function evmOnchainArt(chain, contract, tokenId){
  const rpc = EVM_ART_RPC[String(chain || '').toLowerCase()];
  if (!rpc || !/^0x[0-9a-fA-F]{40}$/.test(String(contract || '')) || tokenId == null || String(tokenId) === '') return '';
  let idHex; try{ idHex = BigInt(tokenId).toString(16).padStart(64, '0'); }catch(e){ return ''; }
  let uri = _decodeAbiString(await _ethCall(rpc, contract, '0xc87b56dd' + idHex));   // tokenURI(uint256)
  if (!uri) uri = _decodeAbiString(await _ethCall(rpc, contract, '0x0e89341c' + idHex));   // uri(uint256) (ERC-1155)
  if (!uri) return '';
  let md = null;
  if (/^data:application\/json/i.test(uri)){ try{ const b = uri.split(',')[1] || ''; md = JSON.parse(/;base64/i.test(uri) ? Buffer.from(b, 'base64').toString('utf8') : decodeURIComponent(b)); }catch(e){ return ''; } }
  else if (/^(https?|ipfs):/i.test(uri)){ try{ const safe = uri.replace(/^ipfs:\/\//i, 'https://ipfs.io/ipfs/'); if (_ssrfSafeUrl(safe)) md = await fetch(safe, { signal: AbortSignal.timeout(9000) }).then(r => r.json()).catch(() => null); }catch(e){} }
  return artOkSrv(md && (md.image || md.image_url || md.imageUrl || md.image_data));
}

// Wrapped-RWA collections whose REAL item art lives on a SOURCE chain, keyed by the collection display name normalized to
// lowercase-alphanumeric. An Emblem vault for one of these is an ETH (or Polygon) wrapper NFT — its own tokenURI is only
// the collection/wrapper image, so an app that holds only the wrapper (e.g. EmblemScan's activity rows, indexed off the
// ETH wrapper contract) must read the SOURCE contract on the SOURCE chain with the SOURCE token id to get the true art.
// Contracts/chains ported from the vault-mint / bazaar SRC_CONTRACT+SRC_CHAINCODE registries (single source of truth).
const SOURCE_COLLECTIONS = {
  onchainhoodies:      { chain: 'robinhood', contract: '0x9ec6c5b9f572a9b02138e553bc5f5882da735f45' },
  stonkbrokers:        { chain: 'robinhood', contract: '0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0' },
  beezie:              { chain: 'base',      contract: '0xbb5ec6fd4b61723bd45c399840f1d868840ca16f' },
  beeziecollectibles:  { chain: 'base',      contract: '0xbb5ec6fd4b61723bd45c399840f1d868840ca16f' },
  courtyard:           { chain: 'polygon',   contract: '0x251be3a17af4892035c37ebf5890f4a4d889dcad' },
  copesalada:          { chain: 'shape',     contract: '0xe1c7dc5cd4becf0c5fcdda29ed914764d4884bbf' },
};
const _normColl = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sourceCollection = collection => SOURCE_COLLECTIONS[_normColl(collection)] || null;
// Resolve a wrapped-RWA collection's REAL item art from its source chain, given the SOURCE token id (e.g. the "#1312" in
// "OnChainHoodies #1312"). Returns '' for non-source collections or if the source token has no on-chain art.
async function sourceArt(collection, sourceTokenId){
  const s = sourceCollection(collection);
  if (!s || sourceTokenId == null || String(sourceTokenId) === '') return '';
  try{ return await evmOnchainArt(s.chain, s.contract, sourceTokenId); }catch(e){ return ''; }
}

// Wrapped-RWA collections (Courtyard/Beezie/Cope Salada/Robinhood/Collector Crypt) return the EVTESTCOMMON placeholder in
// Emblem's vault image — the TRUE item art lives on the SOURCE chain, held at the vault's own deposit address. Resolve it
// by reading that address's holdings on the source chain. The holdings fetchers are INJECTED (each app supplies its own
// proxy, e.g. vault-mint's /api/evm-holdings + /api/sol-holdings) so this stays dependency-free + reusable everywhere.
//   collection : the vault's collection name (Courtyard, Beezie Collectibles, Collector Crypt, …)
//   addresses  : the vault's deposit addresses [{address, coin}] (from Emblem myvaults)
//   deps.evmHoldings(chain, address) -> [{image|img|image_url,…}]   (Polygon/Base/Shape/Robinhood)
//   deps.solHoldings(owner)          -> [{image|img,…}]             (Solana, for Collector Crypt)
// Returns a real art URL or '' (never EVTESTCOMMON). Single source of truth so RWA raffle art never blanks again.
async function sourceArtByOwner(collection, addresses, deps){
  deps = deps || {};
  const src = sourceCollection(collection);                    // EVM RWA → {chain, contract}
  const isCC = /collector\s*crypt/i.test(String(collection || ''));
  const evm = (addresses || []).find(a => /^0x[0-9a-fA-F]{40}$/.test(String(a.address || '')));
  const sol = (addresses || []).find(a => String(a.coin || '').toUpperCase() === 'SOL' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(a.address || '')));
  const first = arr => { for (const x of (arr || [])){ const i = x && (x.image || x.img || x.image_url); if (i && !/EVTESTCOMMON/i.test(String(i))) return i; } return ''; };
  try{
    if (src && evm && typeof deps.evmHoldings === 'function') return first(await deps.evmHoldings(src.chain, evm.address));
    if (isCC && sol && typeof deps.solHoldings === 'function') return first(await deps.solHoldings(sol.address));
  }catch(e){}
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Emblem VAULT-ID resolution (contract + on-chain tokenId → the vault's Emblem id)
// ─────────────────────────────────────────────────────────────────────────────
// WHY this exists: an app that holds only the wrapper NFT knows its (contract, on-chain tokenId) — NOT the Emblem vault id
// the EmblemWrapped viewer keys on. The two are NOT the same number, and using the on-chain id is actively WRONG:
//
//  • ERC-721 per-collection wrappers (NodeMonkes 0x9040…/8, OnChainHoodies 0xA97e…/14, Fomoji 0x3FEE…/2): the small on-chain
//    tokenId is the wrapper's own counter. The Emblem vault id is a big number stored off-chain. e.g. OnChainHoodies #14 →
//    32555674685366191, NodeMonkes #8 → 9346750765219741. Passing the on-chain "8"/"14" to the viewer resolves to a totally
//    UNRELATED vault (8 → a "FINNEYPEPE" Counterparty vault; 14 → a "Twitter Eggs" vault) — the classic bug.
//  • ERC-1155 Emblem Vaults (0x7E60…, ~76-digit token_id): that huge number is the BACKING token that owns every 1155 vault
//    of a unique card. The individual vault has its own Emblem id — but from ON-CHAIN data alone you cannot pick an instance,
//    so the resolvable canonical viewer target is the vault the platform maps that (contract, tokenId) pair to.
//
// THE RESOLVER (single canonical endpoint, verified against all the examples above): Emblem's
//    GET {EV2}/v3/meta/{contract}/{onChainTokenId}
// returns the vault record; its `.tokenId` field IS the Emblem vault id the viewer keys on (i.e. GET {EV2}/meta/{that id}
// resolves to the same named vault). This is uniform across ERC-721 and ERC-1155, so we don't branch on standard.
// It matches how vault-mint (emblemwrapped.com) resolves + links vaults via the Emblem API / SDK.
//
// This is a pure network read with NO app deps, so it is exported standalone (module-level), not through the factory. It is
// MEANT to run SERVER-SIDE only (never from a browser — that would be a cross-origin call to emblemvault.io, which is
// CORS-locked + Cloudflare-challenged). Apps expose it to their own client via a same-origin proxy route.
const EMBLEM_V2_BASE = 'https://v2.emblemvault.io';
// A browser-ish UA dodges Emblem's Cloudflare bot challenge from a datacenter IP (same trick the vault-mint proxy uses).
const _EV_HEADERS = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' };

// Resolve the Emblem vault id from a wrapper NFT. Returns '' (never throws) when it can't resolve, so callers can fall
// back to whatever they were showing. `chain` is accepted for signature-completeness/future multi-chain but the wrappers
// all live on Ethereum mainnet today, so it is not sent to the endpoint. `base` overrides the Emblem base (tests/proxying).
async function resolveEmblemVaultId({ nft, tokenId, chain, base } = {}) {
  const contract = String(nft || '').trim();
  const onchainId = String(tokenId == null ? '' : tokenId).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract) || !/^\d+$/.test(onchainId)) return '';
  const EV2 = String(base || EMBLEM_V2_BASE).replace(/\/$/, '');
  try {
    const r = await fetch(`${EV2}/v3/meta/${contract}/${onchainId}`, { headers: _EV_HEADERS, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return '';
    const j = await r.json().catch(() => null);
    const id = j && (j.tokenId != null ? j.tokenId : (j.internalTokenId != null ? j.internalTokenId : null));
    return (id != null && /^\d+$/.test(String(id))) ? String(id) : '';
  } catch (e) { return ''; }
}

// Build the EmblemWrapped viewer URL for a wrapper NFT. Resolves the real Emblem vault id first; if resolution fails it
// returns '' (the caller decides whether to link at all — NEVER link the raw on-chain id, it points at the wrong vault).
async function emblemViewerUrl({ nft, tokenId, chain, base, viewerOrigin } = {}) {
  const id = await resolveEmblemVaultId({ nft, tokenId, chain, base });
  if (!id) return '';
  const origin = String(viewerOrigin || 'https://emblemwrapped.com').replace(/\/$/, '');
  return `${origin}/?vault=${encodeURIComponent(id)}`;
}

// Server mirror of the client registry's strategy pick (RWA is by collection NAME, everything else by chain). Kept small
// and explicit; the 3 RWA collections + Robinhood are the only cases that don't fall out of the chain alone.
function strategyFor(collection, chain){
  const c = String(collection || '').trim(), ch = String(chain || '').trim();
  if (c === 'Collector Crypt') return 'sol-content';                                  // RWA on Solana
  if (/^(Courtyard|Beezie|Beezie Collectibles|Cope Salada|COPE SALADA)$/.test(c)) return 'evm-tokenuri';
  if (_cpArtFamily.has(c) || /counterparty|dogeparty|stamp/i.test(ch)) return 'cp-asset-name';
  if (/^solana$/i.test(ch)) return 'sol-content';
  if (/ordinal|^bitcoin|litecoin|doginals|stacks|tezos/i.test(ch)) return 'onchain-content';
  if (/^robinhood$/i.test(ch)) return 'evm-onchain';                                  // Robinhood Chain, ERC-6551 digital, NOT RWA
  if (/^(base|polygon|shape|ethereum)$/i.test(ch)) return 'evm-tokenuri';
  return 'emblem-values';
}

// Factory. deps:
//   strategyResolvers: { '<strategy>': async({tokenId,asset,collection,chain,contract,strategy}) -> url } OPTIONAL per-chain
//     backup sources (e.g. onchain tokenURI for evm-tokenuri/evm-onchain, Solana DAS for sol-content, inscription content
//     for onchain-content). Tried AFTER the corpus/catalog/CP-CDN and BEFORE the generic Emblem-meta step.
//   dbQuery(sql, params) -> rows[]           REQUIRED (read)
//   dbExec(sql, params)                        optional (write; enables the persistent vm_art cache)
//   emblemMeta(tokenId) -> metaObj|null        REQUIRED (fetch Emblem v2 meta; app supplies its retrying fetch + base)
//   catalogLookup(collection, asset) -> url    optional (on-disk asset catalog)
//   corpus: [{sql, byAsset?}]                   optional extra corpus queries (ve_coll_items / ve_activity / …)
//   cacheTable                                 optional vm_art-style table name (default 'vm_art')
function createVaultMeta(deps){
  deps = deps || {};
  const dbQuery = deps.dbQuery || (async () => []);
  const dbExec = deps.dbExec || null;
  const emblemMeta = deps.emblemMeta || (async () => null);
  const catalogLookup = deps.catalogLookup || (() => '');
  const cacheTable = deps.cacheTable || 'vm_art';
  const cpCardArt = makeCpCardArt();
  const deadGh = u => /raw\.githubusercontent\.com\/EmblemCompany\/vaultImages\/master\//i.test(String(u || ''));

  async function saveArt(tokenId, image, asset, chain, src){
    if (!dbExec || !tokenId || !artOkSrv(image)) return;
    try{ await dbExec(`INSERT INTO ${cacheTable} (token_id,image,asset,chain,src) VALUES (?,?,?,?,?) ON CONFLICT(token_id) DO UPDATE SET image=excluded.image, asset=COALESCE(NULLIF(excluded.asset,''),${cacheTable}.asset), chain=COALESCE(NULLIF(excluded.chain,''),${cacheTable}.chain), updated_at=datetime('now')`, [String(tokenId), String(image), asset || '', chain || '', src || 'resolve']); }catch(e){}
  }

  // The unified resolver. Contract-scoped (RWA) lookups skip the token_id-only cache to avoid cross-contract id collisions.
  async function resolveVaultArt(tokenId, asset, collection, chain, contract){
    tokenId = String(tokenId || '').trim(); asset = String(asset || '').trim();
    collection = String(collection || '').trim(); chain = String(chain || '').trim();
    contract = String(contract || '').trim().toLowerCase();
    if (!tokenId && !asset) return '';
    if (tokenId && !contract){ try{ const c = await dbQuery(`SELECT image FROM ${cacheTable} WHERE token_id=? LIMIT 1`, [tokenId]); const ok = c[0] && artOkSrv(c[0].image); if (ok) return ok; }catch(e){} }
    let img = '';
    // Shared corpus (EmblemScan tables), by token_id then by asset — each app passes the queries it has.
    for (const q of (deps.corpus || [])){
      if (img) break;
      try{ const params = q.byAsset ? [asset, ''] : (contract ? [tokenId, '', contract] : [tokenId, '']);
        const r = await dbQuery(q.sql, params); const ok = r[0] && artOkSrv(r[0].image); if (ok) img = ok; }catch(e){}
    }
    if (!img) img = catalogLookup(collection, asset) || '';
    const strat = strategyFor(collection, chain);
    if (!img && asset && strat === 'cp-asset-name'){ const ca = artOkSrv(await cpCardArt(asset, collection, chain)); if (ca) img = ca; }
    // Per-strategy backup source (the "right backup method per chain"): injected by the app, tried before the generic
    // Emblem-meta step. Missing/erroring resolvers are skipped, so this can only ADD coverage, never break the chain.
    if (!img){ const sr = (deps.strategyResolvers || {})[strat]; if (sr){ try{ const u = artOkSrv(await sr({ tokenId, asset, collection, chain, contract, strategy: strat })); if (u) img = u; }catch(e){} } }
    // Built-in EVM on-chain reader (evm-onchain like Robinhood, or evm-tokenuri) — reads tokenURI incl. inline image_data
    // SVG. Runs when the app injected no resolver for this strategy (or it missed), so every app gets Robinhood/on-chain art.
    if (!img && (strat === 'evm-onchain' || strat === 'evm-tokenuri') && contract && chain){ try{ const u = await evmOnchainArt(chain, contract, tokenId); if (u) img = u; }catch(e){} }
    if (!img && tokenId){ try{ const m = await emblemMeta(tokenId);
      // PREFER the vault's CONTENT image (values[].image, the real card e.g. img.spellsofgenesis.com) over the display
      // image (m.image), which for CP cards is often a placeholder or the now-dead github link.
      let cand = '';
      if (m && Array.isArray(m.values)) for (const v of m.values){ const c = artOkSrv(v && (v.image || v.img)); if (c && !deadGh(c)){ cand = c; break; } }
      if (!cand){ const c = artOkSrv(m && m.image); if (c && !deadGh(c)) cand = c; }
      if (cand) img = cand;
    }catch(e){} }
    if (img && !contract) await saveArt(tokenId, img, asset, chain, 'resolve');
    return img || '';
  }

  // Mount GET /api/vault-art (?tokenId&asset&collection&chain&contract) + POST /api/vault-art/bulk ({items:[…]}).
  function mountRoutes(app, opts){
    opts = opts || {};
    const rl = opts.rateLimit || ((_a, _b) => (req, res, next) => next());
    const json = opts.json || (opts.express && opts.express.json ? opts.express.json() : (req, _res, next) => next());
    app.get('/api/vault-art', rl(600, 60000), async (req, res) => {
      try{ const img = await resolveVaultArt(req.query.tokenId, req.query.asset, req.query.collection, req.query.chain, req.query.contract); res.json({ image: img, source: img ? 'ok' : 'none' }); }
      catch(e){ res.json({ image: '', source: 'err' }); }
    });
    app.post('/api/vault-art/bulk', rl(120, 60000), json, async (req, res) => {
      const items = (req.body && req.body.items) || []; const map = {};
      let i = 0; const worker = async () => { while (i < items.length){ const it = items[i++]; try{ const img = await resolveVaultArt(it.tokenId, it.asset || '', it.collection || '', it.chain || '', it.contract || ''); if (img) map[String(it.tokenId)] = img; }catch(e){} } };
      await Promise.all(Array.from({ length: Math.min(8, items.length || 1) }, worker));
      res.json({ map });
    });
  }

  return { EMBLEM_METADATA_ASSISTANT_VERSION, artOkSrv, isDeadArt: u => DEAD_ART.test(_unwrapImg(String(u || ''))), cpCardArt, strategyFor, saveArt, resolveVaultArt, sourceArt, sourceCollection, evmOnchainArt, mountRoutes };
}

module.exports = { createVaultMeta, cleanName, artOkSrv, DEAD_ART, SOURCE_COLLECTIONS, sourceArt, sourceArtByOwner, sourceCollection, evmOnchainArt, resolveEmblemVaultId, emblemViewerUrl, EMBLEM_METADATA_ASSISTANT_VERSION };
