// emblem-relay-tokens.js  (part of the Emblem Wrapping Companion pillar)
// ─────────────────────────────────────────────────────────────────────────────
// Canonical Relay-swappable token list used across Emblem front-ends (OneShot,
// EmblemWrapped) so every app recognises and prices the same set of
// balances that Relay can route to USDC or native gas.
//
// ARCHITECTURE:
//   Browser code: import { RELAY_TOKENS_FALLBACK, findRelayToken } from this file.
//     Never calls Relay directly -- the server exposes /api/relay/tokens.
//   Server code:  import { buildRelayTokenRoute } from this file (CommonJS wrapper
//     in the server entry already does that, or use the named export directly).
//     The route fetches https://api.relay.link/currencies/v1 server-side, caches
//     for TTL_MS (10 minutes), and falls back to RELAY_TOKENS_FALLBACK if the
//     upstream is unreachable.
//
// TOKEN SHAPE (every entry):
//   {
//     symbol:   string   // e.g. "USDC"
//     chain:    string   // human label matching Emblem chain names:
//                        //   "Ethereum" | "Base" | "Arbitrum" | "Optimism" | "Polygon" | "Solana"
//     address:  string   // contract address OR "native" for chain-native coins
//     decimals: number
//     priceId:  string   // CoinGecko id (best effort; "" when unknown)
//     logo:     string   // logoURI from Relay metadata or a stable fallback
//     chainId:  number   // numeric chain id (for Relay quote calls)
//   }
//
// USAGE (browser, ES module):
//   import { RELAY_TOKENS_FALLBACK, findRelayToken, getRelayTokensBrowser } from './emblem-relay-tokens.js';
//   // Use the hardcoded fallback immediately:
//   const tok = findRelayToken('USDC', 'Base', RELAY_TOKENS_FALLBACK);
//   // Or fetch the live list from your server route (relative URL, never external):
//   const tokens = await getRelayTokensBrowser();   // calls fetch('api/relay/tokens')
//
// USAGE (server, CommonJS / ES module):
//   const { buildRelayTokenRoute } = require('./emblem-relay-tokens.js');
//   buildRelayTokenRoute(app);    // mounts GET /api/relay/tokens
// ─────────────────────────────────────────────────────────────────────────────

export const EMBLEM_RELAY_TOKENS_VERSION = '1.0.0';

// ── Chain metadata (Emblem label -> Relay chainId) ───────────────────────────
export const RELAY_CHAIN_IDS = {
  Ethereum:  1,
  Base:      8453,
  Arbitrum:  42161,
  Optimism:  10,
  Polygon:   137,
  Solana:    792703809,
};

// Inverse map (chainId -> Emblem label) -- used when normalising Relay API results.
const _CHAIN_LABEL = Object.fromEntries(Object.entries(RELAY_CHAIN_IDS).map(([k, v]) => [v, k]));

// ── Hardcoded fallback token list (top tokens Relay reliably routes) ──────────
// Updated manually; the live-fetch path supersedes this at runtime.
// Addresses are checksummed (EVM) or canonical base58 (Solana).
export const RELAY_TOKENS_FALLBACK = [

  // ── Ethereum (chainId 1) ──────────────────────────────────────────────────
  { symbol: 'ETH',   chain: 'Ethereum', chainId: 1,      address: 'native',                                     decimals: 18, priceId: 'ethereum',          logo: 'https://assets.relay.link/icons/currencies/eth.png' },
  { symbol: 'USDC',  chain: 'Ethereum', chainId: 1,      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,  priceId: 'usd-coin',          logo: 'https://assets.relay.link/icons/currencies/usdc.png' },
  { symbol: 'USDT',  chain: 'Ethereum', chainId: 1,      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,  priceId: 'tether',            logo: 'https://assets.relay.link/icons/currencies/usdt.png' },
  { symbol: 'DAI',   chain: 'Ethereum', chainId: 1,      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, priceId: 'dai',               logo: 'https://assets.relay.link/icons/currencies/dai.png' },
  { symbol: 'WETH',  chain: 'Ethereum', chainId: 1,      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, priceId: 'weth',              logo: 'https://assets.relay.link/icons/currencies/weth.png' },
  { symbol: 'WBTC',  chain: 'Ethereum', chainId: 1,      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8,  priceId: 'wrapped-bitcoin',   logo: 'https://assets.relay.link/icons/currencies/wbtc.png' },
  { symbol: 'cbBTC', chain: 'Ethereum', chainId: 1,      address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8,  priceId: 'coinbase-wrapped-btc', logo: 'https://assets.relay.link/icons/currencies/cbbtc.png' },
  { symbol: 'USDS',  chain: 'Ethereum', chainId: 1,      address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F', decimals: 18, priceId: 'usds',              logo: 'https://assets.relay.link/icons/currencies/usds.png' },

  // ── Base (chainId 8453) ───────────────────────────────────────────────────
  { symbol: 'ETH',   chain: 'Base',     chainId: 8453,   address: 'native',                                     decimals: 18, priceId: 'ethereum',          logo: 'https://assets.relay.link/icons/currencies/eth.png' },
  { symbol: 'USDC',  chain: 'Base',     chainId: 8453,   address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6,  priceId: 'usd-coin',          logo: 'https://assets.relay.link/icons/currencies/usdc.png' },
  { symbol: 'WETH',  chain: 'Base',     chainId: 8453,   address: '0x4200000000000000000000000000000000000006', decimals: 18, priceId: 'weth',              logo: 'https://assets.relay.link/icons/currencies/weth.png' },
  { symbol: 'cbBTC', chain: 'Base',     chainId: 8453,   address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8,  priceId: 'coinbase-wrapped-btc', logo: 'https://assets.relay.link/icons/currencies/cbbtc.png' },
  { symbol: 'USDS',  chain: 'Base',     chainId: 8453,   address: '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc', decimals: 18, priceId: 'usds',              logo: 'https://assets.relay.link/icons/currencies/usds.png' },
  { symbol: 'DAI',   chain: 'Base',     chainId: 8453,   address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18, priceId: 'dai',               logo: 'https://assets.relay.link/icons/currencies/dai.png' },

  // ── Arbitrum (chainId 42161) ───────────────────────────────────────────────
  { symbol: 'ETH',   chain: 'Arbitrum', chainId: 42161,  address: 'native',                                     decimals: 18, priceId: 'ethereum',          logo: 'https://assets.relay.link/icons/currencies/eth.png' },
  { symbol: 'USDC',  chain: 'Arbitrum', chainId: 42161,  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6,  priceId: 'usd-coin',          logo: 'https://assets.relay.link/icons/currencies/usdc.png' },
  { symbol: 'USDT',  chain: 'Arbitrum', chainId: 42161,  address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6,  priceId: 'tether',            logo: 'https://assets.relay.link/icons/currencies/usdt.png' },
  { symbol: 'WETH',  chain: 'Arbitrum', chainId: 42161,  address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, priceId: 'weth',              logo: 'https://assets.relay.link/icons/currencies/weth.png' },
  { symbol: 'WBTC',  chain: 'Arbitrum', chainId: 42161,  address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8,  priceId: 'wrapped-bitcoin',   logo: 'https://assets.relay.link/icons/currencies/wbtc.png' },
  { symbol: 'DAI',   chain: 'Arbitrum', chainId: 42161,  address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18, priceId: 'dai',               logo: 'https://assets.relay.link/icons/currencies/dai.png' },

  // ── Optimism (chainId 10) ─────────────────────────────────────────────────
  { symbol: 'ETH',   chain: 'Optimism', chainId: 10,     address: 'native',                                     decimals: 18, priceId: 'ethereum',          logo: 'https://assets.relay.link/icons/currencies/eth.png' },
  { symbol: 'USDC',  chain: 'Optimism', chainId: 10,     address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6,  priceId: 'usd-coin',          logo: 'https://assets.relay.link/icons/currencies/usdc.png' },
  { symbol: 'USDT',  chain: 'Optimism', chainId: 10,     address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6,  priceId: 'tether',            logo: 'https://assets.relay.link/icons/currencies/usdt.png' },
  { symbol: 'WETH',  chain: 'Optimism', chainId: 10,     address: '0x4200000000000000000000000000000000000006', decimals: 18, priceId: 'weth',              logo: 'https://assets.relay.link/icons/currencies/weth.png' },
  { symbol: 'DAI',   chain: 'Optimism', chainId: 10,     address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18, priceId: 'dai',               logo: 'https://assets.relay.link/icons/currencies/dai.png' },

  // ── Polygon (chainId 137) ─────────────────────────────────────────────────
  { symbol: 'POL',   chain: 'Polygon',  chainId: 137,    address: 'native',                                     decimals: 18, priceId: 'matic-network',     logo: 'https://assets.relay.link/icons/currencies/pol.png' },
  { symbol: 'USDC',  chain: 'Polygon',  chainId: 137,    address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6,  priceId: 'usd-coin',          logo: 'https://assets.relay.link/icons/currencies/usdc.png' },
  { symbol: 'USDT',  chain: 'Polygon',  chainId: 137,    address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6,  priceId: 'tether',            logo: 'https://assets.relay.link/icons/currencies/usdt.png' },
  { symbol: 'WETH',  chain: 'Polygon',  chainId: 137,    address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18, priceId: 'weth',              logo: 'https://assets.relay.link/icons/currencies/weth.png' },
  { symbol: 'WBTC',  chain: 'Polygon',  chainId: 137,    address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals: 8,  priceId: 'wrapped-bitcoin',   logo: 'https://assets.relay.link/icons/currencies/wbtc.png' },
  { symbol: 'DAI',   chain: 'Polygon',  chainId: 137,    address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18, priceId: 'dai',               logo: 'https://assets.relay.link/icons/currencies/dai.png' },

  // ── Solana (chainId 792703809) ────────────────────────────────────────────
  { symbol: 'SOL',   chain: 'Solana',   chainId: 792703809, address: 'native',                                  decimals: 9,  priceId: 'solana',            logo: 'https://assets.relay.link/icons/currencies/sol.png' },
  { symbol: 'USDC',  chain: 'Solana',   chainId: 792703809, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, priceId: 'usd-coin', logo: 'https://assets.relay.link/icons/currencies/usdc.png' },
  { symbol: 'USDT',  chain: 'Solana',   chainId: 792703809, address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, priceId: 'tether',   logo: 'https://assets.relay.link/icons/currencies/usdt.png' },
  { symbol: 'WBTC',  chain: 'Solana',   chainId: 792703809, address: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', decimals: 8, priceId: 'wrapped-bitcoin', logo: 'https://assets.relay.link/icons/currencies/wbtc.png' },
  { symbol: 'WETH',  chain: 'Solana',   chainId: 792703809, address: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', decimals: 8, priceId: 'weth',     logo: 'https://assets.relay.link/icons/currencies/weth.png' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Find the best match from a token list by symbol + optional chain (case-insensitive).
// Returns the first match, or null.
export function findRelayToken(symbol, chain, list) {
  if (!symbol || !list) return null;
  const sym = String(symbol).toUpperCase();
  const ch  = chain ? String(chain).toLowerCase() : '';
  if (ch) {
    const exact = list.find(t => t.symbol.toUpperCase() === sym && t.chain.toLowerCase() === ch);
    if (exact) return exact;
  }
  return list.find(t => t.symbol.toUpperCase() === sym) || null;
}

// Find a token by its contract address (case-insensitive for EVM; exact for Solana).
// Returns the first match or null.
export function findRelayTokenByAddress(address, list) {
  if (!address || !list) return null;
  const a = String(address);
  const al = a.toLowerCase();
  return list.find(t => {
    const ta = String(t.address);
    return ta === a || ta.toLowerCase() === al;
  }) || null;
}

// ── Browser fetch helper (server-cached list via relative route) ───────────────
// Calls GET api/relay/tokens (RELATIVE, no leading slash) -- the server caches
// upstream Relay API results so the browser never touches api.relay.link directly.
// Falls back to RELAY_TOKENS_FALLBACK if the route is unavailable or errors.
let _browserCache = null, _browserCacheTs = 0;
const BROWSER_CACHE_MS = 10 * 60 * 1000;   // 10 minutes, matches server TTL

export async function getRelayTokensBrowser() {
  if (_browserCache && Date.now() - _browserCacheTs < BROWSER_CACHE_MS) return _browserCache;
  try {
    const r = await fetch('api/relay/tokens', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('relay tokens route returned ' + r.status);
    const j = await r.json();
    if (Array.isArray(j) && j.length > 0) {
      _browserCache = j;
      _browserCacheTs = Date.now();
      return j;
    }
  } catch (e) {}
  return RELAY_TOKENS_FALLBACK;
}

// ── CoinGecko priceId lookup (best-effort, hardcoded for top tokens) ──────────
const _PRICE_IDS = {
  ETH: 'ethereum', WETH: 'weth', USDC: 'usd-coin', USDT: 'tether', DAI: 'dai',
  WBTC: 'wrapped-bitcoin', cbBTC: 'coinbase-wrapped-btc', SOL: 'solana',
  POL: 'matic-network', MATIC: 'matic-network', USDS: 'usds', BTC: 'bitcoin',
};
export function priceIdFor(symbol) { return _PRICE_IDS[String(symbol || '')] || ''; }

// ── Server-side route builder ─────────────────────────────────────────────────
// Call buildRelayTokenRoute(app, opts?) in your Express server (CommonJS or ESM).
// Mounts GET /api/relay/tokens.
//
// opts.ttlMs    - cache TTL in milliseconds (default 600000 = 10 min)
// opts.apiKey   - optional Relay API key (from process.env.RELAY_API_KEY)
// opts.chainIds - array of Relay chainIds to request (default: all Emblem chains)
//
// The route returns the same shape as RELAY_TOKENS_FALLBACK: { tokens: [...] }
// BUT also supports a flat array response format for forward compatibility.
// Consumers should accept both: Array.isArray(r) ? r : (r.tokens || []).

export function buildRelayTokenRoute(app, opts) {
  opts = opts || {};
  const TTL_MS       = opts.ttlMs || 10 * 60 * 1000;
  const RELAY_API    = 'https://api.relay.link';
  const CHAIN_IDS    = opts.chainIds || Object.values(RELAY_CHAIN_IDS);
  const API_KEY      = opts.apiKey || (typeof process !== 'undefined' && process.env && process.env.RELAY_API_KEY) || '';

  // Per-chain native-coin address placeholders used by Relay:
  // EVM native = 0x0000000000000000000000000000000000000000
  // Solana native = 11111111111111111111111111111111
  const EVM_NATIVE = '0x0000000000000000000000000000000000000000';
  const SOL_NATIVE = '11111111111111111111111111111111';

  let _cache = null, _cacheTs = 0;

  async function fetchRelayTokens() {
    if (_cache && Date.now() - _cacheTs < TTL_MS) return _cache;

    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['x-api-key'] = API_KEY;

    // POST /currencies/v1 with defaultList:true scoped to the chains we care about.
    const body = { defaultList: true, chainIds: CHAIN_IDS, verified: true };
    let raw = null;
    try {
      const r = await fetch(`${RELAY_API}/currencies/v1`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) raw = await r.json();
    } catch (e) {}

    // Relay returns a nested array: [[...tokens for group1], [...tokens for group2], ...]
    // Flatten and normalise to our shape.
    let tokens = [];
    if (Array.isArray(raw)) {
      const flat = raw.flat ? raw.flat(2) : [].concat(...raw.map(g => Array.isArray(g) ? g : [g]));
      for (const t of flat) {
        if (!t || !t.symbol || !t.chainId || !t.address) continue;
        const chainLabel = _CHAIN_LABEL[Number(t.chainId)];
        if (!chainLabel) continue;   // skip chains outside our scope

        // Relay uses the zero address or the SOL system program for native coins.
        let addr = String(t.address);
        const isNative = (t.metadata && t.metadata.isNative) ||
                          addr === EVM_NATIVE || addr === SOL_NATIVE;
        if (isNative) addr = 'native';

        tokens.push({
          symbol:   String(t.symbol),
          chain:    chainLabel,
          chainId:  Number(t.chainId),
          address:  addr,
          decimals: Number(t.decimals) || 18,
          priceId:  priceIdFor(t.symbol),
          logo:     (t.metadata && String(t.metadata.logoURI || '')) || '',
        });
      }
    }

    // If Relay returned nothing useful, fall back to the hardcoded list.
    if (!tokens.length) tokens = RELAY_TOKENS_FALLBACK.slice();

    // De-duplicate: keep first occurrence of (symbol, chain, address) triplet.
    const seen = new Set();
    tokens = tokens.filter(t => {
      const k = `${t.symbol}:${t.chainId}:${t.address.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    _cache = tokens;
    _cacheTs = Date.now();
    return tokens;
  }

  // Mount the route (tolerates being called before the server is fully initialised).
  app.get('/api/relay/tokens', async (req, res) => {
    try {
      const tokens = await fetchRelayTokens();
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(tokens);
    } catch (e) {
      res.status(500).json({ error: String(e && e.message || e) });
    }
  });

  // Expose the fetcher for callers that want to call it directly (e.g. to warm
  // the cache at startup or hydrate a wallet-cash handler with richer token data).
  app.relayTokensFetch = fetchRelayTokens;

  return { fetchRelayTokens };
}

export default {
  EMBLEM_RELAY_TOKENS_VERSION,
  RELAY_CHAIN_IDS,
  RELAY_TOKENS_FALLBACK,
  findRelayToken,
  findRelayTokenByAddress,
  getRelayTokensBrowser,
  priceIdFor,
  buildRelayTokenRoute,
};
