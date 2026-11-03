'use strict';
// ============================================================================
// erc6551-tba-reader - bulk reads + claim-calldata for ERC-6551 token-bound accounts
// ----------------------------------------------------------------------------
// ERC-6551 gives every NFT a smart-contract wallet (a "token-bound account", TBA)
// that the NFT owner controls. This is a small, read-only helper for the common
// jobs around that:
//   - resolve the deterministic TBA address for a tokenId (or a whole collection)
//   - read an ERC-20 balance held inside each TBA ("what's in the NFT's wallet")
//   - map which wallet owns each tokenId
//   - build (but NEVER sign) the calldata to sweep an ERC-20 out of a TBA to the
//     NFT owner - the owner signs it with their own wallet
//
// The one non-obvious trick: public RPCs often choke on ethers' default JSON-RPC
// array batching, so bulk ownerOf/account/balanceOf fan-out would fail at scale.
// This creates providers with batchMaxCount:1 and does the fan-out through
// Multicall3 (one eth_call per chunk of up to 500) instead. That alone makes
// whole-collection reads work on a weak RPC.
//
// No keys, no secrets, no hardcoded project addresses - you pass your own config.
// Extracted from Emblem's Vault Robbers NFT utility. MIT licensed.
// ============================================================================
const { ethers } = require('ethers');

// Canonical, chain-agnostic singletons (same address on every chain they're deployed to).
const CANONICAL_6551_REGISTRY = '0x000000006551c19487814612e58FE06813775758'; // ERC-6551 Registry v0.3.1
const CANONICAL_MULTICALL3    = '0xcA11bde05977b3631167028862bE2a173976CA11'; // Multicall3
const ZERO_SALT = '0x' + '0'.repeat(64);

const REGISTRY_ABI = [
  'function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) view returns (address)',
  'function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) returns (address)',
];
const NFT_ABI   = ['function ownerOf(uint256) view returns (address)', 'function balanceOf(address) view returns (uint256)'];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)', 'function decimals() view returns (uint8)'];
const ACCT_ABI  = ['function owner() view returns (address)', 'function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)'];
const MC3_ABI   = ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)'];

const regIface   = new ethers.Interface(REGISTRY_ABI);
const nftIface   = new ethers.Interface(NFT_ABI);
const erc20Iface = new ethers.Interface(ERC20_ABI);
const acctIface  = new ethers.Interface(ACCT_ABI);
const lc = a => String(a || '').toLowerCase();
const ZERO = lc(ethers.ZeroAddress);

/**
 * Create a reader bound to one chain + NFT collection.
 * @param {object} cfg
 * @param {string} cfg.rpc           RPC URL for the chain the NFT/registry live on. (required)
 * @param {number} cfg.chainId       Chain id. (required)
 * @param {string} cfg.nft           NFT collection address. (required)
 * @param {string} cfg.accountImpl   ERC-6551 account implementation address. (required)
 * @param {string} [cfg.registry]    ERC-6551 registry (default: canonical v0.3.1).
 * @param {string} [cfg.multicall3]  Multicall3 (default: canonical).
 * @param {string} [cfg.salt]        bytes32 salt (default: zero).
 * @param {string} [cfg.token]       ERC-20 to read/sweep from the TBAs (optional; required for balances/claim).
 */
function createReader(cfg) {
  if (!cfg || !cfg.rpc || !cfg.chainId || !cfg.nft || !cfg.accountImpl) {
    throw new Error('createReader requires { rpc, chainId, nft, accountImpl }');
  }
  const RPC = cfg.rpc, CHAIN = Number(cfg.chainId);
  const NFT = ethers.getAddress(cfg.nft);
  const IMPL = ethers.getAddress(cfg.accountImpl);
  const REGISTRY = ethers.getAddress(cfg.registry || CANONICAL_6551_REGISTRY);
  const MC3 = ethers.getAddress(cfg.multicall3 || CANONICAL_MULTICALL3);
  const SALT = cfg.salt || ZERO_SALT;
  const TOKEN = cfg.token ? ethers.getAddress(cfg.token) : null;

  // batchMaxCount:1 - do NOT let ethers array-batch; weak public RPCs reject it. Fan-out via MC3 instead.
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN, { staticNetwork: true, batchMaxCount: 1 });
  const mc3 = new ethers.Contract(MC3, MC3_ABI, provider);
  const _tba = {};

  async function mcAll(calls) {
    const out = [];
    for (let i = 0; i < calls.length; i += 500) {
      const res = await mc3.aggregate3(calls.slice(i, i + 500));
      for (const r of res) out.push(r);
    }
    return out;
  }

  // Deterministic TBA addresses for a list of tokenIds (cached; resolved via the registry on-chain).
  async function tbaMany(ids) {
    const need = ids.filter(id => !_tba[String(id)]);
    if (need.length) {
      const calls = need.map(id => ({ target: REGISTRY, allowFailure: true, callData: regIface.encodeFunctionData('account', [IMPL, SALT, CHAIN, NFT, id]) }));
      const res = await mcAll(calls);
      res.forEach((r, j) => { if (r.success) { try { const [a] = regIface.decodeFunctionResult('account', r.returnData); _tba[String(need[j])] = a; } catch (_) {} } });
    }
    return ids.map(id => _tba[String(id)]);
  }
  async function tbaOf(tokenId) { const [a] = await tbaMany([Number(tokenId)]); return a; }

  // ERC-20 balances held inside a list of TBAs (requires cfg.token).
  async function tokenBalances(tbas) {
    if (!TOKEN) throw new Error('cfg.token is required for balance reads');
    const calls = tbas.map(t => ({ target: TOKEN, allowFailure: true, callData: erc20Iface.encodeFunctionData('balanceOf', [t]) }));
    const res = await mcAll(calls);
    return res.map(r => { if (r.success) { try { const [w] = erc20Iface.decodeFunctionResult('balanceOf', r.returnData); return BigInt(w); } catch (_) {} } return 0n; });
  }

  // tokenId -> owner wallet, for tokenIds 1..supply (cached by the caller if desired).
  async function ownerMap(supply) {
    const N = Math.max(1, Number(supply) || 0);
    const ids = Array.from({ length: N }, (_, i) => i + 1);
    const calls = ids.map(id => ({ target: NFT, allowFailure: true, callData: nftIface.encodeFunctionData('ownerOf', [id]) }));
    const res = await mcAll(calls);
    const map = {};
    res.forEach((r, j) => { if (r.success) { try { const [a] = nftIface.decodeFunctionResult('ownerOf', r.returnData); const o = lc(a); if (o && o !== ZERO) map[String(ids[j])] = o; } catch (_) {} } });
    return map;
  }

  // Tokens owned by `address` (1..supply), each with its TBA and (if cfg.token set) its stash.
  async function owned(address, supply) {
    const a = lc(address);
    if (!/^0x[0-9a-f]{40}$/.test(a)) return { address, tokens: [] };
    const map = await ownerMap(supply);
    const ids = Object.keys(map).filter(id => map[id] === a).map(Number).sort((x, y) => x - y);
    const tbas = await tbaMany(ids);
    const stashes = TOKEN ? await tokenBalances(tbas) : ids.map(() => 0n);
    return { address: a, tokens: ids.map((tokenId, i) => ({ tokenId, tba: tbas[i], balanceWei: stashes[i].toString() })) };
  }

  // Build (NEVER sign) the calldata for the NFT owner to sweep the whole ERC-20 balance out of a TBA to themselves.
  // Returns steps the owner submits from their own wallet. Verifies on-chain ownership first.
  async function claimCalldata(tokenId, ownerAddress) {
    if (!TOKEN) throw new Error('cfg.token is required to build claim calldata');
    const o = lc(ownerAddress);
    if (!/^0x[0-9a-f]{40}$/.test(o)) throw new Error('bad owner address');
    const tba = await tbaOf(tokenId);
    const token = new ethers.Contract(TOKEN, ERC20_ABI, provider);
    const nft = new ethers.Contract(NFT, NFT_ABI, provider);
    const [balRaw, code, chainOwner] = await Promise.all([
      token.balanceOf(tba).catch(() => 0n),
      provider.getCode(tba).catch(() => '0x'),
      nft.ownerOf(tokenId).catch(() => ethers.ZeroAddress),
    ]);
    if (lc(chainOwner) !== o) throw new Error('connected wallet does not own tokenId ' + tokenId);
    const bal = BigInt(balRaw);
    const transferData = erc20Iface.encodeFunctionData('transfer', [ownerAddress, bal]);
    const executeData  = acctIface.encodeFunctionData('execute', [TOKEN, 0, transferData, 0]);
    const createData   = regIface.encodeFunctionData('createAccount', [IMPL, SALT, CHAIN, NFT, tokenId]);
    const deployed = code && code !== '0x';
    return {
      tokenId: Number(tokenId), tba, deployed, balanceWei: bal.toString(), chainId: CHAIN,
      steps: [
        ...(deployed ? [] : [{ label: 'Activate token-bound account', to: REGISTRY, data: createData, value: '0x0' }]),
        ...(bal > 0n ? [{ label: 'Sweep token to owner', to: tba, data: executeData, value: '0x0' }] : []),
      ],
    };
  }

  return { config: () => ({ rpc: RPC, chainId: CHAIN, nft: NFT, accountImpl: IMPL, registry: REGISTRY, multicall3: MC3, salt: SALT, token: TOKEN }),
           tbaOf, tbaMany, tokenBalances, ownerMap, owned, claimCalldata, provider };
}

module.exports = { createReader, CANONICAL_6551_REGISTRY, CANONICAL_MULTICALL3 };

// ---- self-test (pure, no RPC): run `node index.js --self-test` -------------
if (require.main === module && process.argv[2] === '--self-test') {
  const assert = require('assert');
  // config validation
  assert.throws(() => createReader({}), /requires/, 'missing config throws');
  const r = createReader({ rpc: 'https://example.invalid', chainId: 4663,
    nft: '0xABC6c4F5d1F31326b419c2645C981743a845313a', accountImpl: '0x41C8f39463A868d3A88af00cd0fe7102F30E44eC',
    token: '0x77061B45C5E4D440bd681B5F72BD0F4231a6fC04' });
  const c = r.config();
  assert.strictEqual(c.registry, ethers.getAddress(CANONICAL_6551_REGISTRY), 'defaults to canonical registry');
  assert.strictEqual(c.multicall3, ethers.getAddress(CANONICAL_MULTICALL3), 'defaults to canonical MC3');
  assert.strictEqual(c.chainId, 4663, 'chainId set');
  // claim calldata encoding is pure (encode an execute->transfer and sanity-check the selector)
  const transfer = erc20Iface.encodeFunctionData('transfer', ['0x1111111111111111111111111111111111111111', 123n]);
  const execute  = acctIface.encodeFunctionData('execute', [c.token, 0, transfer, 0]);
  assert.ok(execute.startsWith('0x'), 'execute calldata encodes');
  assert.strictEqual(execute.slice(0, 10), acctIface.getFunction('execute').selector, 'execute selector correct');
  // token required for balance reads
  const r2 = createReader({ rpc: 'https://x.invalid', chainId: 1, nft: c.nft, accountImpl: c.accountImpl });
  assert.rejects(() => r2.tokenBalances(['0x0000000000000000000000000000000000000001']), /token is required/, 'balances need token');
  console.log('self-test PASS  registry=' + c.registry.slice(0, 10) + '  mc3=' + c.multicall3.slice(0, 10) + '  chain=' + c.chainId);
}
