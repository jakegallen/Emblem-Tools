'use strict';
// ============================================================================
// emblem-provably-fair - commit-reveal randomness for provably-fair games
// ----------------------------------------------------------------------------
// A tiny, dependency-light primitive for games/raffles/lotteries that need a
// RANDOM outcome nobody (not even the operator) can bias after the fact:
//
//   1. COMMIT  - before the round, generate a 32-byte seed and publish only its
//                hash  h = keccak256(seed)  (e.g. store it on-chain).
//   2. PLAY    - derive every outcome from  prng(seed, roundId, label), a pure
//                keccak256 stream. No Math.random ever touches an outcome.
//   3. REVEAL  - after the round, publish the seed. Anyone recomputes
//                keccak256(seed) to confirm it matches the commit, then replays
//                prng() to reproduce every draw. The operator cannot have chosen
//                the seed to favor an outcome, because the hash was locked in
//                before play.
//
// The same derivation runs in Node and in the browser (see verify.html), so a
// published result is independently reproducible from the committed hash + the
// revealed seed. keccak256 matches an on-chain keccak256(abi.encodePacked(seed))
// commit, so the commit can live in a smart contract.
//
// Extracted from the Vault Standoff game. MIT licensed. No secrets here - the
// operator's seed is generated at runtime and only its HASH is public until reveal.
// ============================================================================
const crypto = require('crypto');
const { keccak256, toUtf8Bytes } = require('ethers');

// A fresh 32-byte seed and its commit hash. Publish `hash` before the round;
// reveal `seed` after. hash matches an on-chain keccak256(abi.encodePacked(seed)).
function newSeed() {
  const seed = '0x' + crypto.randomBytes(32).toString('hex');
  return { seed, hash: keccak256(seed) };
}

// The commit hash for a given seed.
function commitHash(seed) { return keccak256(seed); }

// Confirm a revealed seed matches its published commit.
function verifySeed(seed, committedHash) {
  try { return commitHash(seed).toLowerCase() === String(committedHash).toLowerCase(); }
  catch (_) { return false; }
}

// Deterministic PRNG: a PURE function of (seed, roundId, label). Returns a
// function that yields floats in [0,1). `label` namespaces a draw so two
// independent draws in the same round never share a stream. Identical output in
// Node and in the browser verifier.
function prng(seed, roundId, label) {
  let ctr = 0, pool = Buffer.alloc(0), off = 0;
  const base = String(seed) + ':' + String(roundId) + ':' + String(label);
  function refill() { pool = Buffer.from(keccak256(toUtf8Bytes(base + ':' + (ctr++))).slice(2), 'hex'); off = 0; }
  return function () {
    if (off + 6 > pool.length) refill();
    let v = 0; for (let i = 0; i < 6; i++) { v = v * 256 + pool[off + i]; }
    off += 6;
    return v / 281474976710656; // 48 bits -> [0,1)
  };
}

// Convenience helpers built on prng().
function randInt(rand, n) { return Math.floor(rand() * n); }                 // integer in [0, n)
function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }     // uniform element
// Ticket-weighted winner: entries = { key: ticketCount }. Pure function of the
// seed, so the draw is reproducible and verifiable.
function weightedWinner(rand, entries) {
  const keys = Object.keys(entries);
  const total = keys.reduce((a, k) => a + Number(entries[k] || 0), 0);
  if (total <= 0) return null;
  let x = rand() * total, acc = 0;
  for (const k of keys) { acc += Number(entries[k] || 0); if (x <= acc) return k; }
  return keys[keys.length - 1];
}

module.exports = { newSeed, commitHash, verifySeed, prng, randInt, pick, weightedWinner };

// ---- self-test: run `node index.js --self-test` ----------------------------
if (require.main === module && process.argv[2] === '--self-test') {
  const assert = require('assert');
  const { seed, hash } = newSeed();
  assert.ok(/^0x[0-9a-f]{64}$/.test(seed) && /^0x[0-9a-f]{64}$/.test(hash), 'seed+hash shape');
  assert.strictEqual(verifySeed(seed, hash), true, 'reveal matches commit');
  assert.strictEqual(verifySeed(seed, '0x' + '0'.repeat(64)), false, 'wrong commit rejected');
  const a = prng(seed, 7, 'draw'), b = prng(seed, 7, 'draw');
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepStrictEqual(sa, sb, 'prng deterministic');
  assert.ok(sa.every(x => x >= 0 && x < 1), 'prng in [0,1)');
  const c = prng(seed, 7, 'other');
  assert.notStrictEqual(c(), sa[0], 'label namespaces the stream');
  const entries = { a: 10, b: 30, c: 60 };
  const w1 = weightedWinner(prng(seed, 7, 'win'), entries);
  const w2 = weightedWinner(prng(seed, 7, 'win'), entries);
  assert.strictEqual(w1, w2, 'winner reproducible from seed');
  assert.ok(entries[w1] > 0, 'winner is a participant');
  console.log('self-test PASS  seed=' + seed.slice(0, 10) + '  commit=' + hash.slice(0, 10) + '  winner=' + w1);
}
