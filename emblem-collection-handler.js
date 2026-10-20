/*!
 * Emblem Collection Handler — the canonical Emblem collection registry for every app.
 * v1.0.0 · 2026-10-07
 *
 * ONE source of truth for "what are the Emblem collections and how do I wrap/value them." Instead of each app hardcoding
 * its own collection list (which drifts), import this and read from the EmblemScan Data API, which surfaces the Emblem
 * curated registry + per-collection valuation + deposit metadata.
 *
 * Works in the browser (window.EmblemCollections) and Node (require). No dependencies — uses global fetch (Node 18+).
 *
 *   const C = window.EmblemCollections;               // or: const C = require('./emblem-collection-handler')
 *   await C.load();                                    // warm the cache (optional; every getter lazy-loads)
 *   const cc = await C.byContract('0x8e1bb30a…');      // one collection, full registry row
 *   await C.standardOf(addr);                          // 'ERC721' | 'ERC1155'
 *   await C.depositInfo(addr);                         // { depositChain, nativeAssets, protocol } — what/where to deposit
 *   await C.isMintable(addr);                          // can you create/wrap into it right now
 *   await C.detail('collector-crypt-wrapped');         // adds the full per-chain contracts map
 *   await C.filter({ protocol:'counterparty', mintable:true });
 *
 * Every row: { name, contract, chain, standard, collectionType, protocol, depositChain, nativeAssets[], mintable,
 *              tvlUsd, floorUsd, owners, totalSupply, volumeUsd, vol30dUsd, slug }.  detail() adds { contracts }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmblemCollections = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEFAULT_BASE = 'https://api.emblemscan.com/api/v1';
  var TTL = 5 * 60 * 1000;
  var _rows = null, _byC = null, _byS = null, _at = 0, _inflight = null, _base = DEFAULT_BASE;
  var _lc = function (s) { return String(s == null ? '' : s).toLowerCase(); };

  function _index(rows) {
    _byC = {}; _byS = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var c = _lc(r.contract); if (c) _byC[c] = r;
      var s = _lc(r.slug); if (s) _byS[s] = r;
    }
  }

  // Load + cache the full registry. Safe to call concurrently (single in-flight request). opts.force bypasses the cache,
  // opts.base overrides the API base (e.g. the raw /pub/main/vault-explorer/api/v1 path if you are not on api.emblemscan.com).
  function load(opts) {
    opts = opts || {};
    if (opts.base) _base = opts.base;
    if (_rows && !opts.force && (Date.now() - _at) < TTL) return Promise.resolve(_rows);
    if (_inflight) return _inflight;
    var url = _base.replace(/\/$/, '') + '/collections?limit=500';
    _inflight = fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      _rows = (j && j.rows) || []; _at = Date.now(); _index(_rows); return _rows;
    }).catch(function (e) { if (_rows) return _rows; throw e; }).then(function (v) { _inflight = null; return v; }, function (e) { _inflight = null; throw e; });
    return _inflight;
  }

  function all(opts) { return load(opts); }
  function byContract(addr, opts) { return load(opts).then(function () { return _byC[_lc(addr)] || null; }); }
  function bySlug(slug, opts) { return load(opts).then(function () { return _byS[_lc(slug)] || null; }); }
  function standardOf(addr, opts) { return byContract(addr, opts).then(function (c) { return c ? c.standard : null; }); }
  function isMintable(addr, opts) { return byContract(addr, opts).then(function (c) { return !!(c && c.mintable); }); }
  function depositInfo(addr, opts) {
    return byContract(addr, opts).then(function (c) {
      return c ? { depositChain: c.depositChain || '', nativeAssets: c.nativeAssets || [], protocol: c.protocol || '' } : null;
    });
  }
  // Filter the registry by any of: protocol, standard ('ERC721'/'ERC1155'), chain, mintable (bool).
  function filter(q, opts) {
    q = q || {};
    return load(opts).then(function (rows) {
      return rows.filter(function (r) {
        if (q.protocol && _lc(r.protocol) !== _lc(q.protocol)) return false;
        if (q.standard && _lc(r.standard) !== _lc(q.standard)) return false;
        if (q.chain && _lc(r.chain) !== _lc(q.chain)) return false;
        if (q.mintable != null && !!r.mintable !== !!q.mintable) return false;
        return true;
      });
    });
  }
  // Single-collection detail (adds the full per-chain `contracts` map). Accepts a slug or any chain contract address.
  function detail(idOrContract, opts) {
    opts = opts || {}; if (opts.base) _base = opts.base;
    var url = _base.replace(/\/$/, '') + '/collections/' + encodeURIComponent(idOrContract);
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) { return (j && !j.error) ? j : null; }).catch(function () { return null; });
  }
  // Full per-chain contract map for a collection (via detail()).
  function contractsOf(idOrContract, opts) { return detail(idOrContract, opts).then(function (d) { return d ? (d.contracts || {}) : null; }); }
  function cached() { return _rows; }        // sync access to the last-loaded rows (null before first load)
  function setBase(b) { _base = b || DEFAULT_BASE; }

  return {
    version: '1.0.0',
    load: load, all: all, byContract: byContract, bySlug: bySlug, standardOf: standardOf,
    isMintable: isMintable, depositInfo: depositInfo, filter: filter, detail: detail,
    contractsOf: contractsOf, cached: cached, setBase: setBase, base: DEFAULT_BASE,
  };
});
