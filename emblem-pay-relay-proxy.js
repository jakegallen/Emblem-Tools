// Emblem Pay-With-Anything — server-side Relay proxy (mountable Express router).
// Non-custodial: proxies Relay quote/status + a read-only, method-whitelisted Solana RPC. Holds no keys.
// The DESTINATION (what your app receives) is PINNED here and can never be overridden by the client, so this
// can't be abused as an open swap oracle. Origin (what the user pays in) is the client's choice.
//
//   const { makeRelayRouter } = require('./emblem-pay-relay-proxy');
//   app.use('/api', makeRelayRouter({ destinationChainId, destinationCurrency, enabled, relayApiKey, solRpc, rateLimit, supportedOrigins }));
'use strict';
const express = require('express');

const RELAY_API = 'https://api.relay.link';
// Whitelisted READ methods only. getAddressLookupTable is REQUIRED so the browser can resolve the ALTs a Relay
// Solana leg references before assembling the v0 tx; sendTransaction is NEVER forwarded (the wallet submits).
const SOL_RPC_METHODS = new Set(['getLatestBlockhash', 'getMultipleAccounts', 'getAccountInfo',
  'getSignatureStatuses', 'getAddressLookupTable', 'getFeeForMessage', 'getSlot', 'getBalance', 'getTokenAccountsByOwner']);
const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOL_B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RELAY_SOLANA = 792703809;   // Relay Solana mainnet chainId

// CURRENT SUPPORTED ORIGINS (Jake 2026-10-18): exactly 5 pay origins. Solana (SOL + Solana-USDC), Ethereum (1),
// Base (8453), Robinhood (4663, same-chain native + direct destination token), BNB (56). NO Arbitrum/Optimism/
// Polygon, NO Bitcoin. This is the app-level pay scope; Polygon et al. may still appear in the wallet CONNECTOR's
// network add/switch list (wallet-network UX), which is a different concern. Pass your own `supportedOrigins`
// (array of chainIds) to widen/narrow — default is the canonical 5-chain mint set.
const DEFAULT_SUPPORTED_ORIGINS = [RELAY_SOLANA, 1, 8453, 4663, 56];

// default in-memory rate limiter (key,max,winMs)->bool; pass your own to share limits across the app.
function defaultLimiter() {
  const hits = {}; const MAX_KEYS = 50000;
  return (key, max, winMs) => {
    const now = Date.now();
    if (hits[key] === undefined && Object.keys(hits).length >= MAX_KEYS) return true;
    const a = (hits[key] || []).filter(t => now - t < winMs);
    if (a.length >= max) { hits[key] = a; return false; }
    a.push(now); hits[key] = a; return true;
  };
}

function makeRelayRouter(opts) {
  opts = opts || {};
  const DEST_CHAIN = opts.destinationChainId;
  const DEST_CCY = String(opts.destinationCurrency || '').trim();
  const enabled = typeof opts.enabled === 'function' ? opts.enabled : () => true;
  const SOL_RPC = opts.solRpc || process.env.SOL_RPC || 'https://solana-rpc.publicnode.com';
  const SUPPORTED = new Set(Array.isArray(opts.supportedOrigins) && opts.supportedOrigins.length ? opts.supportedOrigins.map(Number) : DEFAULT_SUPPORTED_ORIGINS);
  const rl = opts.rateLimit || defaultLimiter();
  const headers = () => ({ 'Content-Type': 'application/json', ...(opts.relayApiKey ? { 'x-api-key': opts.relayApiKey } : {}) });
  const ipKey = (req, tag) => tag + ':' + (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?');
  if (!DEST_CHAIN || !EVM.test(DEST_CCY)) throw new Error('makeRelayRouter: destinationChainId + 0x destinationCurrency required');

  const r = express.Router();

  r.get('/relay/chains', async (req, res) => {
    if (!rl(ipKey(req, 'relay'), 30, 60000)) return res.status(429).json({ error: 'slow down' });
    try { const x = await fetch(`${RELAY_API}/chains`, { headers: headers(), signal: AbortSignal.timeout(12000) }); res.status(x.status).json(await x.json()); }
    catch (e) { res.status(502).json({ error: 'relay chains unavailable' }); }
  });

  // Quote. Destination is forced to (DEST_CHAIN, DEST_CCY); the client only picks origin + amount + recipient.
  r.post('/relay/quote', express.json({ limit: '8kb' }), async (req, res) => {
    if (!rl(ipKey(req, 'relay'), 30, 60000)) return res.status(429).json({ error: 'slow down' });
    try {
      if (!enabled()) return res.status(409).json({ error: 'funnel disabled' });
      const b = req.body || {};
      const body = {
        user: String(b.user || ''),
        recipient: String(b.recipient || b.user || ''),
        originChainId: parseInt(b.originChainId, 10),
        originCurrency: String(b.originCurrency || '0x0000000000000000000000000000000000000000'),
        destinationChainId: DEST_CHAIN,                                   // PINNED
        destinationCurrency: DEST_CCY,                                    // PINNED
        amount: String(b.amount || '0'),
        tradeType: (b.tradeType === 'EXACT_INPUT' ? 'EXACT_INPUT' : 'EXACT_OUTPUT')
      };
      if (!body.originChainId) return res.status(400).json({ error: 'originChainId required' });
      if (!SUPPORTED.has(body.originChainId)) return res.status(400).json({ error: 'unsupported origin chain' });
      if (!/^\d+$/.test(body.amount) || body.amount === '0') return res.status(400).json({ error: 'amount required' });
      if (body.originChainId === RELAY_SOLANA) {
        if (!SOL_B58.test(body.user)) return res.status(400).json({ error: 'valid Solana user address required' });
        if (!SOL_B58.test(body.originCurrency)) return res.status(400).json({ error: 'originCurrency must be a base58 Solana mint/native' });
      } else {
        // EVM origin (Ethereum / Base / Robinhood / BNB): native sentinel 0x0…0, or a 0x ERC-20 (USDC/USDT/DAI/USDG).
        if (!EVM.test(body.user)) return res.status(400).json({ error: 'valid EVM user address required' });
        if (!EVM.test(body.originCurrency)) return res.status(400).json({ error: 'originCurrency must be a 0x token address or the native sentinel' });
      }
      if (!EVM.test(body.recipient)) return res.status(400).json({ error: 'valid EVM recipient required' });
      const x = await fetch(`${RELAY_API}/quote`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      res.status(x.status).json(await x.json());
    } catch (e) { res.status(502).json({ error: 'relay quote unavailable' }); }
  });

  r.get('/relay/status', async (req, res) => {
    if (!rl(ipKey(req, 'relay'), 60, 60000)) return res.status(429).json({ error: 'slow down' });
    try {
      const rid = String(req.query.requestId || '');
      if (!/^[a-zA-Z0-9_\-]{1,128}$/.test(rid)) return res.status(400).json({ error: 'bad requestId' });
      const x = await fetch(`${RELAY_API}/intents/status?requestId=${encodeURIComponent(rid)}`, { headers: headers(), signal: AbortSignal.timeout(12000) });
      res.status(x.status).json(await x.json());
    } catch (e) { res.status(502).json({ error: 'relay status unavailable' }); }
  });

  // Read-only Solana RPC proxy: a Relay Solana origin returns raw instructions, so the browser needs a blockhash
  // + ALT accounts to assemble the v0 tx. Only whitelisted READ methods are forwarded; sendTransaction is never
  // relayed (the wallet submits the signed tx itself).
  r.post('/sol-rpc', express.json({ limit: '64kb' }), async (req, res) => {
    if (!rl(ipKey(req, 'solrpc'), 120, 60000)) return res.status(429).json({ error: 'slow down' });
    try {
      if (!enabled()) return res.status(409).json({ error: 'funnel disabled' });
      const m = req.body && req.body.method;
      if (typeof m !== 'string' || !SOL_RPC_METHODS.has(m)) return res.status(400).json({ error: 'method not allowed' });
      const x = await fetch(SOL_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body), signal: AbortSignal.timeout(15000) });
      res.status(x.status).json(await x.json());
    } catch (e) { res.status(502).json({ error: 'sol rpc unavailable' }); }
  });

  return r;
}

module.exports = { makeRelayRouter, SOL_RPC_METHODS };
