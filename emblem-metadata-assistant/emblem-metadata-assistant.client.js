// ─────────────────────────────────────────────────────────────────────────────
// Emblem Metadata Assistant — CLIENT half
// ─────────────────────────────────────────────────────────────────────────────
// The third pillar of the Emblem front-end stack:
//   1. Emblem Connector     — wallet: connect, sign, chain-switch, cross-chain funding
//   2. Wrapping Companion   — the wrap lifecycle UX
//   3. Metadata Assistant   — THIS: given a vault in ANY state, derive its display art + name, correctly, once
//
// Shared verbatim by EmblemWrapped (vault-mint) and EmblemScan (vault-explorer). Both
// render vault cards across many states (created, funded, wrapped, unwrapped, raffled, listed); this module is the ONE
// place that knows the right image source per collection, the dead areas to never render, how each state derives its
// art, and the cache/proxy plumbing. A display bug is then provably in derivation, not in an individual app.
// ─────────────────────────────────────────────────────────────────────────────

export const EMBLEM_METADATA_ASSISTANT_VERSION = '0.5.0';   // 0.5.0: cleanName(name,collection) — canonical display-name standardizer (strips a redundant collection prefix + collapses a doubled name) so item names never read "NodeMonkes NodeMonkes" / "Beezie Collectibles LUBU" across apps.

// Canonical display-name standardizer, shared by every app. Given a raw item name + its collection, return just the token
// name: strip an EXACT collection-name prefix (with an optional separator), and collapse an exact doubled name. Safe:
// only an exact prefix is removed, so "Bitcoin Puppet #9326" (collection "Bitcoin Puppets") is left untouched.
export function cleanName(name, collection){
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

// Unwrap Helius/Cloudflare `/cdn-cgi/image/<opts>/<REAL_URL>` wrappers down to the clean underlying source.
export function unwrapImg(u){ const s = String(u || ''); const m = s.match(/\/cdn-cgi\/image\/[^/]*\/((?:https?|ipfs|ar):\/\/.+)$/i); return m ? m[1] : s; }

// ── THE DEAD AREAS ──────────────────────────────────────────────────────────
// The SINGLE source of truth for "this URL is a placeholder / dead / junk, never render it". Add a newly-dead host HERE
// and every app (both halves share this list) stops trusting it at once. Blank always beats a wrong/broken image.
// STRING array = the single shared source (the server's DEAD_ART_SOURCES is copy-paste IDENTICAL, so a mismatch is a
// trivial diff). Add a newly-dead host to this ONE list, in both files, and every app stops trusting it.
export const DEAD_ART_SOURCES = [
  'EVTESTCOMMON',                                             // Emblem's generic placeholder (HARD RULE: never emit it)
  's:evmetadata', 'api\\.emblemvault\\.io/s:',                // dead Emblem metadata endpoints
  'emblem\\.finance/[a-z0-9_-]+\\.(png|gif|jpe?g|webp|svg)',  // non-specific per-collection covers (xcp.png, btcdegods.jpg…)
  'nft2?-cdn\\.alchemy', 'res\\.cloudinary\\.com/alchemyapi', 'convert-png', // broken CDN derivatives
  'playtoearngames\\.com',                                    // dead proxy some old rows emit as a "no image" marker
  'bellscdn\\.ordinalswallet',                                // dead EmBells CDN (renders broken); even when wrapped by image-scaler.vercel.app
  'xchain\\.io/img/cards',                                    // DIED 2026-08-21: 301 → tokenscan.io which 404s for every card
  'githubusercontent\\.com/EmblemCompany/vaultImages/master', // DIED 2026-08-21: folder removed upstream (404)
];
export const DEAD_ART = DEAD_ART_SOURCES.map(s => new RegExp(s, 'i'));
export function isDeadArt(u){ const s = unwrapImg(String(u || '')); return DEAD_ART.some(re => re.test(s)); }

// Return the real, renderable art URL, or '' if it's a placeholder/dead/junk. Accepts data:image (on-chain SVGs).
export function artOk(u){
  const s = unwrapImg(String(u || ''));
  if (/^data:image\//i.test(s)) return s;
  return (/^(https?|ipfs|ar):/i.test(s) && !isDeadArt(s)) ? s : '';
}

// Route an external image through the app's own same-origin proxy so hotlink/CORS/slow-gateway URLs still render.
// RELATIVE path on purpose (proxied under /pub/{group}/{name}/). data: URIs pass through untouched.
export function proxyImg(u, route){ const s = String(u || ''); if (!s || /^data:/i.test(s)) return s; return (route || 'api/img') + '?u=' + encodeURIComponent(s); }

// ── THE RIGHT IMAGES FOR THE RIGHT COLLECTIONS ──────────────────────────────
// Per-collection art strategy: how THIS collection's real art is found. The resolver uses `strategy` to pick the source;
// `family` groups Counterparty-style card collections that resolve by ASSET NAME via the SDK map / hnft.
//   cp-asset-name  → Counterparty/Bitcoin card art by asset name (SDK map, hnft, Emblem values e.g. img.spellsofgenesis.com)
//   onchain-content→ the underlying inscription/token content is the art (Ordinals, Stacks, Tezos objkt)
//   evm-tokenuri   → EVM source-contract tokenURI image (Courtyard/Beezie = RWA on Polygon/Base; Cope Salada = Shape digital)
//   evm-onchain    → Robinhood Chain digital collections (ERC-6551 token-bound accounts; on-chain SVG art), NOT RWA
//   sol-content    → Solana MPL-Core / pNFT content (Collector Crypt = RWA on Solana)
//   emblem-values  → default: trust the vault's Emblem content metadata (values[].image)
export const COLLECTION_REGISTRY = {
  // Counterparty / Bitcoin-asset card families (art by ASSET NAME): SDK map → hnft → Emblem values (img.spellsofgenesis…)
  'Spells of Genesis': { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Rare Pepe':         { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'RAREPEPE':          { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'PEPECASH':          { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Fake Rares':        { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Fake Commons':      { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Dank Rares':        { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Fomojis':           { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Fomojis 2.0':       { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Bitcorn':           { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Bitcorn Crops':     { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Dogeparty':         { chain:'Dogeparty',    family:'cp', strategy:'cp-asset-name' },
  'Bitcoin Stamps':    { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' },
  'Counterparty':      { chain:'Counterparty', family:'cp', strategy:'cp-asset-name' }, // wildcard "(all)" picker
  // ── RWA: REAL-WORLD ASSETS (tokenized PHYSICAL items, e.g. graded Pokemon cards). EXACTLY THREE collections, on three
  //    different chains: Solana, Polygon, Base. This is the ONLY RWA set. Do not add Robinhood or anything else here.
  'Collector Crypt':   { chain:'Solana',       family:'sol', strategy:'sol-content',  category:'rwa' },   // graded slabs, Solana MPL-Core/pNFT
  'Courtyard':         { chain:'Polygon',      family:'evm', strategy:'evm-tokenuri', category:'rwa' },   // graded trading cards, Polygon
  'Beezie':            { chain:'Base',         family:'evm', strategy:'evm-tokenuri', category:'rwa' },   // tokenized collectibles, Base
  'Beezie Collectibles':{ chain:'Base',        family:'evm', strategy:'evm-tokenuri', category:'rwa' },
  // ── ROBINHOOD CHAIN: its OWN blockchain, DIGITAL-native assets (NOT RWA). Many use ERC-6551 token-bound accounts and
  //    on-chain art (tokenURI often returns an on-chain SVG). A distinct category + strategy; never conflate with RWA.
  'Stonk Brokers':     { chain:'Robinhood',    family:'evm', strategy:'evm-onchain', category:'digital' },
  'StonkBrokers':      { chain:'Robinhood',    family:'evm', strategy:'evm-onchain', category:'digital' },
  'Hoodies':           { chain:'Robinhood',    family:'evm', strategy:'evm-onchain', category:'digital' },
  'OnChainHoodies':    { chain:'Robinhood',    family:'evm', strategy:'evm-onchain', category:'digital' },
  'CASHCAT':           { chain:'Robinhood',    family:'evm', strategy:'evm-onchain', category:'digital' },
  'Spritehood Wisp':   { chain:'Robinhood',    family:'evm', strategy:'evm-onchain', category:'digital' },
  'Chain Mancers':     { chain:'Robinhood',    family:'evm', strategy:'evm-onchain', category:'digital' },
  'pyopyopyopyo':      { chain:'Robinhood',    family:'evm', strategy:'evm-onchain', category:'digital' },
  // ── Other EVM digital collections (not RWA, not Robinhood)
  'Cope Salada':       { chain:'Shape',        family:'evm', strategy:'evm-tokenuri', category:'digital' },
  'COPE SALADA':       { chain:'Shape',        family:'evm', strategy:'evm-tokenuri', category:'digital' },
};
// "Supports every collection": explicit registry above for the known ones, else INFER from the chain, else the universal
// emblem-values fallback (reads the vault's own content metadata, which works for ANY vault). So an unregistered or brand
// new collection (a fresh Ordinals set, a new RWA drop) still resolves correctly without a code change.
export function inferByChain(chain){
  const c = String(chain || '').trim();
  // NOTE: RWA (category:'rwa') is NOT chain-inferable, only the 3 explicit registry entries are RWA. Inference defaults
  // everything to category:'digital'; Robinhood gets its own on-chain (ERC-6551) strategy, distinct from RWA tokenURI.
  if (/counterparty|dogeparty|stamp/i.test(c)) return { chain:c, family:'cp',  strategy:'cp-asset-name',  category:'digital' };
  if (/^solana$/i.test(c))                      return { chain:c, family:'sol', strategy:'sol-content',     category:'digital' };
  if (/ordinal|^bitcoin|litecoin|doginals/i.test(c)) return { chain:c, family:'btc', strategy:'onchain-content', category:'digital' };
  if (/^stacks$/i.test(c))                      return { chain:c, family:'stacks', strategy:'onchain-content', category:'digital' };
  if (/^tezos$/i.test(c))                        return { chain:c, family:'tezos', strategy:'onchain-content', category:'digital' };
  if (/^robinhood$/i.test(c))                    return { chain:c, family:'evm', strategy:'evm-onchain',    category:'digital' };   // its own chain, ERC-6551 digital, NOT RWA
  if (/^(base|polygon|shape|ethereum)$/i.test(c)) return { chain:c, family:'evm', strategy:'evm-tokenuri',  category:'digital' };
  return { chain:c, family:'', strategy:'emblem-values', category:'digital' };
}
export function collectionInfo(collection, chain){ return COLLECTION_REGISTRY[String(collection || '').trim()] || inferByChain(chain); }
export function isCpFamily(collection, chain){ return collectionInfo(collection, chain).family === 'cp'; }

// ── THE UNIQUE WAYS IMAGES ARE DERIVED, one place, sorted and organized. ──
// Each collection's `strategy` maps to a derivation method here: the ordered source chain to try, and which collections
// use it. This is the canonical answer to "where does THIS collection's real art come from".
export const STRATEGIES = {
  'cp-asset-name': {
    label: 'Counterparty / Bitcoin-asset card art, by ASSET NAME',
    order: ['SDK getAllAssetMetadata map (by asset name)', 'api.explorer.hnft.wtf/images/{ASSET}.{jpg,png,gif}', 'bitcorns.com (Bitcorn only)', 'Emblem meta values[].image (e.g. img.spellsofgenesis.com)'],
    collections: ['Spells of Genesis', 'Rare Pepe', 'Fake Rares', 'Fake Commons', 'Dank Rares', 'Fomojis', 'Bitcorn Crops', 'Dogeparty', 'Bitcoin Stamps', 'Counterparty (all)'],
    note: 'xchain.io/img/cards and EmblemCompany/vaultImages/master are DEAD, blocklisted in DEAD_ART.',
  },
  'evm-tokenuri': {
    label: 'EVM source-contract tokenURI image (hosted). Used by the EVM RWA pair + other EVM-digital collections.',
    order: ['api/onchain-art (source ERC-721 tokenURI / Alchemy on the source chain, scoped by srcContracts + tokenId)', 'Emblem meta values[].image', 'collection cover logo'],
    collections: ['Courtyard (Polygon, RWA)', 'Beezie Collectibles (Base, RWA)', 'COPE SALADA (Shape, digital)'],
    note: 'RWA = tokenized PHYSICAL items. The RWA set is EXACTLY 3: Collector Crypt (Solana, see sol-content), Courtyard (Polygon), Beezie (Base). Cope Salada is EVM-digital, NOT RWA.',
  },
  'evm-onchain': {
    label: 'Robinhood Chain digital collections (ERC-6551 token-bound accounts), on-chain art',
    order: ['api/onchain-art (source ERC-721 tokenURI on Robinhood Chain, scoped by srcContract + tokenId)', 'on-chain SVG data URI, rendered directly (NEVER convert-png it: that yields a broken 386-byte PNG)', 'Emblem meta values[].image'],
    collections: ['StonkBrokers', 'Hoodies', 'OnChainHoodies', 'CASHCAT', 'Spritehood Wisp', 'Chain Mancers', 'pyopyopyopyo'],
    note: 'Robinhood is its OWN blockchain with DIGITAL-native assets, NOT RWA. Copycat-heavy, so scope holdings + art to the exact srcContract.',
  },
  'sol-content': {
    label: 'Solana MPL-Core / pNFT content',
    order: ['api/nft-image (Solana content by mint / Helius DAS)', 'Emblem meta values[].image'],
    collections: ['Collector Crypt (graded slabs, the RWA-on-Solana collection)'],
    note: 'Collector Crypt is one of the 3 RWA collections (tokenized physical); its cards span many mints, identified by update-authority / verified-collection markers.',
  },
  'onchain-content': {
    label: 'On-chain inscription / token content IS the art',
    order: ['inscription content (Ordinals: ord.net / turbo.ordinalswallet)', 'Stacks (gamma/objkt), Tezos (objkt / IPFS)', 'Emblem meta values[].image'],
    collections: ['Bitcoin Ordinals (NodeMonkes etc.)', 'Stacks', 'Tezos'],
    note: 'The wrapped vault renders its underlying inscription/token content directly.',
  },
  'emblem-values': {
    label: 'Emblem content metadata, the universal fallback',
    order: ['Emblem meta values[].image (the vault CONTENT, not the create-time placeholder)', 'Emblem meta image (only if not a placeholder / dead host)'],
    collections: ['any collection not otherwise mapped'],
    note: 'Always available, it reads the vault\'s own metadata, so a brand new collection still resolves.',
  },
};

// ── SDK global asset-image map (Counterparty card art by ASSET NAME). ──
// Built once from the SDK's getAllAssetMetadata() (~63k {assetName,image,projectName}). The live, authoritative source
// for CP card art that SURVIVED the xchain/github deaths. All three apps build it identically.
export function buildCpAssetImgMap(sdk){
  const m = new Map();
  try{ const all = (sdk && sdk.getAllAssetMetadata && sdk.getAllAssetMetadata()) || [];
    for (const x of all){ const k = String(x.assetName || x.asset || x.name || '').toUpperCase(); const im = artOk(x.image || x.img);
      if (k && im && !m.has(k)) m.set(k, im); }
  }catch(e){}
  return m;
}
export function cpAssetImg(cpMap, asset, longname){
  if (!cpMap) return '';
  return cpMap.get(String(asset || '').toUpperCase()) || (longname && cpMap.get(String(longname).toUpperCase())) || '';
}

// ── localStorage art cache (per-tokenId), namespaced so apps don't collide. ──
export function makeImgCache(key){
  key = key || 'evm_tokenimg_v1';
  const all = () => { try{ return JSON.parse(localStorage.getItem(key) || '{}') || {}; }catch(e){ return {}; } };
  return {
    get(id){ if (id == null) return ''; return artOk(all()[String(id)]); },
    set(id, url){ if (id == null) return; const ok = artOk(url); if (!ok) return; try{ const m = all(); if (m[String(id)] === ok) return; m[String(id)] = ok; localStorage.setItem(key, JSON.stringify(m)); }catch(e){} },
  };
}

// ── VAULT STATES ────────────────────────────────────────────────────────────
// A vault shows the SAME underlying asset art in every state; what changes is WHICH tokenId key holds it. Before mint the
// art is known client-side against the SOURCE (holdings) tokenId; after mint it's keyed by the VAULT tokenId. So the
// resolver checks BOTH keys and mirrors a hit across them, which is why a card stays imaged from "created" through
// "wrapped", "unwrapped", "raffled" and "listed".
export const VAULT_STATES = ['created', 'funded', 'wrapped', 'unwrapped', 'raffled', 'listed'];

// ── The unified CLIENT-side resolve, state-aware. Returns the best art derivable WITHOUT a network call:
//   dual-key cache (source + vault tokenId) → current image (if real) → SDK CP-map by asset name.
// Pass sourceTokenId (holdings id, pre-mint) and/or tokenId (vault id, post-mint); a hit is mirrored to both cache keys.
// Returns '' when the app should ask the server (bulkResolveServer) or heal from a live chain source. `cache` optional.
export function resolveDisplayArt(o){
  o = o || {};
  const cache = o.cache;
  const keys = [o.sourceTokenId, o.tokenId].filter(v => v != null);
  if (cache){ for (const k of keys){ const c = cache.get(k); if (c){ for (const k2 of keys) cache.set(k2, c); return c; } } }
  const cur = artOk(o.current);
  if (cur){ if (cache) for (const k of keys) cache.set(k, cur); return cur; }
  if (o.cpMap && isCpFamily(o.collection, o.chain) && (o.asset || o.longname)){
    const c = artOk(cpAssetImg(o.cpMap, o.asset, o.longname));
    if (c){ if (cache) for (const k of keys) cache.set(k, c); return c; }
  }
  return '';
}

// Ask the shared server resolver for a batch the client couldn't derive locally. `items`: [{tokenId,asset,collection,
// chain,contract}]. Returns { tokenId: image }. Dead/placeholder URLs are stripped from the result too.
export async function bulkResolveServer(items, opts){
  opts = opts || {};
  const route = opts.route || 'api/vault-art/bulk';
  const miss = (items || []).filter(Boolean);
  if (!miss.length) return {};
  try{
    const r = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: miss }) });
    const j = await r.json().catch(() => ({}));
    const map = (j && j.map) || {};
    for (const k of Object.keys(map)){ if (!artOk(map[k])) delete map[k]; }
    return map;
  }catch(e){ return {}; }
}

export default {
  EMBLEM_METADATA_ASSISTANT_VERSION, unwrapImg, DEAD_ART, isDeadArt, artOk, proxyImg,
  COLLECTION_REGISTRY, collectionInfo, inferByChain, isCpFamily, buildCpAssetImgMap, cpAssetImg,
  makeImgCache, VAULT_STATES, STRATEGIES, resolveDisplayArt, bulkResolveServer,
};
