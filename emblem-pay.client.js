/*! Emblem Pay-With-Anything — browser client (framework-agnostic, no build step).
 *  Pairs with emblem-pay-relay-proxy.js on your server. The user's wallet signs + submits; this never holds a key.
 *
 *    const pay = EmblemPay({ evmProvider: window.ethereum, solWallet: window.solana, apiBase: 'api' });
 *    await pay.relayDeliver({ originChainId, originCurrency, amountAtomic, recipient, tradeType, onStage });
 *
 *  Supported origins (the canonical Emblem mint/entry set): Solana (792703809), Ethereum (1), Base (8453),
 *  Robinhood (4663), BNB (56). EVM origins need only `evmProvider` (EIP-1193). Solana origins also need
 *  `solWallet` (Phantom-style) and @solana/web3.js exposed as `window.solanaWeb3` (or pass `solWeb3`).
 *  (No Arbitrum/Optimism/Polygon, no Bitcoin in this scope — Polygon et al. may still be in the wallet
 *  connector's network-switch list, which is separate. To widen, set the server's `supportedOrigins`.)
 */
(function (root) {
  'use strict';

  // The canonical 5 origins. Solana is a FIRST-CLASS origin (SOL + Solana-USDC), not a footnote.
  var SUPPORTED_ORIGINS = [792703809, 1, 8453, 4663, 56];
  var RELAY_SOLANA = 792703809;

  function EmblemPay(cfg) {
    cfg = cfg || {};
    var apiBase = (cfg.apiBase || 'api').replace(/\/$/, '');
    var evm = cfg.evmProvider || (typeof window !== 'undefined' ? window.ethereum : null);
    var solWallet = cfg.solWallet || (typeof window !== 'undefined' ? (window.solana || window.phantom && window.phantom.solana) : null);
    var solWeb3 = cfg.solWeb3 || (typeof window !== 'undefined' ? window.solanaWeb3 : null);
    var url = function (p) { return apiBase + p; };
    var noop = function () {};

    function jpost(p, body) { return fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    function jget(p) { return fetch(url(p)).then(function (r) { return r.json(); }); }

    // EIP-1559 fees so a low default estimate can't strand an L1-origin tx (base*2 + 1.5gwei tip, +25%).
    async function evmFeeParams() {
      try {
        var blk = await evm.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
        var base = BigInt(blk.baseFeePerGas || '0x0');
        var tip = 1500000000n; // 1.5 gwei
        var maxFee = (base * 2n + tip) * 125n / 100n;
        return { maxPriorityFeePerGas: '0x' + tip.toString(16), maxFeePerGas: '0x' + maxFee.toString(16) };
      } catch (e) { return {}; }
    }

    function hexU8(h) { h = h.replace(/^0x/, ''); var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
    function ixData(s) { return (typeof s === 'string' && /^(0x)?[0-9a-fA-F]+$/.test(s) && s.replace(/^0x/, '').length % 2 === 0) ? hexU8(s) : Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }

    // Assemble + sign a v0 tx from Relay's raw Solana instructions. Reads (blockhash, ALTs) go through the
    // server's whitelisted /sol-rpc proxy; the wallet submits the signed tx itself.
    async function signAndSendSolIx(d, userSolAddr) {
      if (!solWeb3) throw new Error('Solana support needs @solana/web3.js (window.solanaWeb3).');
      if (!solWallet) throw new Error('No Solana wallet connected.');
      try { if (!solWallet.publicKey && solWallet.connect) await solWallet.connect(); } catch (e) {}
      var rpc = (typeof document !== 'undefined') ? new URL(apiBase + '/sol-rpc', document.baseURI).href : null;
      if (!rpc) throw new Error('No Solana RPC proxy URL.');
      var payer = new solWeb3.PublicKey(userSolAddr || solWallet.publicKey.toString());
      var conn = new solWeb3.Connection(rpc, 'confirmed');
      var alts = [];
      for (var i = 0; i < (d.addressLookupTableAddresses || []).length; i++) {
        try { var r = await conn.getAddressLookupTable(new solWeb3.PublicKey(d.addressLookupTableAddresses[i])); if (r && r.value) alts.push(r.value); } catch (e) {}
      }
      var ixs = (d.instructions || []).map(function (i) {
        return new solWeb3.TransactionInstruction({ programId: new solWeb3.PublicKey(i.programId), keys: (i.keys || []).map(function (k) { return { pubkey: new solWeb3.PublicKey(k.pubkey), isSigner: !!k.isSigner, isWritable: !!k.isWritable }; }), data: ixData(i.data) });
      });
      if (!ixs.length) throw new Error('The payment route returned no instructions.');
      var bh = (await conn.getLatestBlockhash()).blockhash;
      var msg = new solWeb3.TransactionMessage({ payerKey: payer, recentBlockhash: bh, instructions: ixs }).compileToV0Message(alts);
      var tx = new solWeb3.VersionedTransaction(msg);
      if (solWallet.signAndSendTransaction) { var res = await solWallet.signAndSendTransaction(tx); return (res && res.signature) || res; }
      if (solWallet.signTransaction) { var signed = await solWallet.signTransaction(tx); return await conn.sendRawTransaction(signed.serialize(), { maxRetries: 3 }); }
      throw new Error('Your Solana wallet cannot sign transactions.');
    }

    async function signAndSendSolSerialized(b64) {
      if (!solWeb3 || !solWallet) throw new Error('Solana wallet / web3 not available.');
      var raw = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
      var tx; try { tx = solWeb3.VersionedTransaction.deserialize(raw); } catch (e) { tx = solWeb3.Transaction.from(raw); }
      if (solWallet.signAndSendTransaction) { var res = await solWallet.signAndSendTransaction(tx); return (res && res.signature) || res; }
      throw new Error('Your Solana wallet cannot broadcast this transaction.');
    }

    // Deliver the server-pinned destination token to `recipient`, paid from the user's chosen origin.
    // Resolves once Relay reports the swap filled. Throws on an un-routable pair or a failed swap.
    async function relayDeliver(o) {
      o = o || {}; var S = o.onStage || noop;
      var user = o.user;
      if (!user && evm) { try { user = (await evm.request({ method: 'eth_accounts' }))[0]; } catch (e) {} }
      if (!user && o.originChainId === RELAY_SOLANA && solWallet) { try { if (!solWallet.publicKey && solWallet.connect) await solWallet.connect(); user = solWallet.publicKey.toString(); } catch (e) {} }
      var body = {
        user: user, recipient: o.recipient || user,
        originChainId: o.originChainId, originCurrency: o.originCurrency || '0x0000000000000000000000000000000000000000',
        amount: String(o.amountAtomic), tradeType: (o.tradeType === 'EXACT_INPUT' ? 'EXACT_INPUT' : 'EXACT_OUTPUT')
      };
      S('Getting a quote…');
      var q = await jpost('/relay/quote', body).catch(function () { return null; });
      if (!q || !q.steps) throw new Error((q && q.error) || 'No route found for that token/chain.');
      var requestId = q.requestId || null;
      for (var si = 0; si < q.steps.length; si++) {
        var items = q.steps[si].items || [];
        for (var ii = 0; ii < items.length; ii++) {
          var it = items[ii];
          if (!requestId && it.check && it.check.endpoint) { try { requestId = new URLSearchParams(it.check.endpoint.split('?')[1] || '').get('requestId'); } catch (e) {} }
          var d = it.data || {};
          if (d.to) { // EVM step
            S('Approve the payment in your wallet…');
            var tp = { from: user, to: d.to, value: d.value ? ('0x' + BigInt(d.value).toString(16)) : '0x0', data: d.data || '0x' };
            try { Object.assign(tp, await evmFeeParams()); } catch (e) {}
            await evm.request({ method: 'eth_sendTransaction', params: [tp] });
          } else if (Array.isArray(d.instructions)) { // Solana raw instructions
            S('Approve in your Solana wallet…'); await signAndSendSolIx(d, user);
          } else { var b64 = d.transaction || d.tx || d.serializedTransaction || (typeof d === 'string' ? d : null); if (b64) { S('Approve in your Solana wallet…'); await signAndSendSolSerialized(b64); } }
        }
      }
      S('Confirming the swap…');
      for (var p = 0; p < 60 && requestId; p++) {
        await new Promise(function (r) { setTimeout(r, p < 4 ? 1200 : 3000); });
        try {
          var st = await jget('/relay/status?requestId=' + encodeURIComponent(requestId));
          var s = String((st && st.status) || '');
          if (/success|complete|filled|refund/i.test(s)) { S('Delivered.'); return { requestId: requestId, status: s }; }
          if (/failed|error/i.test(s)) throw new Error('The swap did not complete.');
        } catch (e) { if (/did not complete/.test(e && e.message || '')) throw e; }
      }
      return { requestId: requestId, status: 'pending' };
    }

    async function chains() { return jget('/relay/chains'); }

    // HIDE-ZERO / DUST / SUB-COST balance filter (mirrors the live mint's /api/balances). Given priced balance rows
    // ({ chainId, currency, symbol, label, balance, usd }) and the per-unit USD cost of ONE mint/entry, return only
    // the currencies the wallet can actually complete at least one purchase with:
    //   (a) drop anything unpriced (usd == null) or valued <= 0  — hides 1-wei dust that reads as "$0";
    //   (b) drop anything below the cost of one unit (perUnitUsd). When the cost read failed (perUnitUsd falsy),
    //       fall back to a $1 floor so a transient RPC blip never over-filters the list to empty.
    function filterPayable(assets, perUnitUsd) {
      var floor = (perUnitUsd && perUnitUsd > 0) ? perUnitUsd : 1;
      return (assets || []).filter(function (a) { return a && a.usd != null && a.usd > 0 && a.usd >= floor; });
    }

    return { relayDeliver: relayDeliver, chains: chains, filterPayable: filterPayable, SUPPORTED_ORIGINS: SUPPORTED_ORIGINS.slice(), _evmFeeParams: evmFeeParams };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { EmblemPay: EmblemPay };
  root.EmblemPay = EmblemPay;
})(typeof window !== 'undefined' ? window : this);
