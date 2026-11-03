# emblem-provably-fair

Two small, independent pieces for building and auditing **provably-fair** games, raffles, and lotteries, extracted from Emblem's Vault Standoff game. MIT licensed.

1. **`index.js`** - a commit-reveal randomness primitive. Outcomes are a pure `keccak256` stream of a seed that is *hash-committed before play and revealed after*, so no one (not even the operator) can bias a result after the fact, and anyone can reproduce every draw.
2. **`fairness-watch.js`** - a dependency-free monitor that detects a rigged outcome distribution from **public data only** (tickets per round + who won), with no access to the seed or server internals.

No secrets are in this package. The operator's seed is generated at runtime and only its hash is public until reveal.

## The commit-reveal scheme

```
COMMIT   before the round:  generate seed (32 random bytes), publish  h = keccak256(seed)   (e.g. on-chain)
PLAY     during the round:  every outcome = prng(seed, roundId, label)  - a pure keccak256 stream, no Math.random
REVEAL   after the round:   publish seed. Anyone checks keccak256(seed) === h, then replays prng() to reproduce draws.
```

Because the hash is locked in **before** play, the operator can't have chosen a seed to favor an outcome; because the seed is revealed **after**, anyone can recompute the result. `keccak256(seed)` matches an on-chain `keccak256(abi.encodePacked(seed))` commit, so the commitment can live in a smart contract, and the identical derivation runs in Node and in the browser (`verify.html`).

### Usage

```js
const { newSeed, commitHash, verifySeed, prng, weightedWinner } = require('emblem-provably-fair');

// 1. before the round
const { seed, hash } = newSeed();   // publish `hash` (store on-chain); keep `seed` secret for now

// 2. during the round - all outcomes derive from the seed
const rand   = prng(seed, roundId, 'winner');   // a function -> floats in [0,1)
const winner = weightedWinner(rand, { '0xabc': 10, '0xdef': 30 });   // ticket-weighted, reproducible

// 3. after the round - reveal the seed; anyone verifies
verifySeed(seed, hash);             // true  -> the revealed seed matches the commit
// replaying prng(seed, roundId, 'winner') reproduces the same winner
```

`prng(seed, roundId, label)` returns a generator of floats in `[0,1)`. The `label` namespaces a draw so two independent draws in the same round never share a stream. Helpers: `randInt(rand, n)`, `pick(rand, arr)`, `weightedWinner(rand, entries)`.

Run the self-test: `node index.js --self-test`

### Browser verifier

`verify.html` is a standalone page (loads `ethers` from a CDN) that recomputes `keccak256(seed)` against the published commit and replays the draws - hand it to players so they can verify a result themselves. Open it in any browser; no build step.

## The fairness watcher

A fair, ticket-weighted game gives each wallet a win probability equal to its share of that round's tickets. Over many rounds, a wallet's **actual** wins must track its **expected** wins (the sum of its per-round ticket shares) within normal statistical noise. Winning far more than ticket-share predicts - beyond a binomial confidence band, with a minimum sample - is the signature of a rigged draw or an EV-grinding exploit.

The watcher needs **only public data** (who bought how many tickets, who won, the pot/rake). It can't be fed false inputs by a compromised server, shares no code with the game, and changes nothing about gameplay. It runs a per-wallet Poisson-binomial z-test, an aggregate chi-square tripwire, and the structural invariants (winner was a participant; rake matches the configured bps).

```
node fairness-watch.js --self-test                        # synthetic fair + rigged proof
node fairness-watch.js --rounds rounds.json               # analyze real rounds
node fairness-watch.js --rounds rounds.json --rake 250    # expected rake 2.5%
RAKE_BPS=0 node fairness-watch.js --rounds rounds.json    # no rake (skip that invariant)
```

Round shape (one per settled round):

```json
{ "roundId": 1, "participants": { "0xabc": 2, "0xdef": 1 }, "winner": "0xabc",
  "potWei": "30000000000000000000000", "rakeWei": "1500000000000000000000" }
```

`participants` maps a key (lowercased wallet address) to its ticket count. `winner` is the winning key or `null`. `potWei`/`rakeWei` are optional (used only for the rake invariant). See `example-rounds.json`. The output gives a `verdict` of `FAIR (no anomaly)` or `ANOMALY - investigate`, with per-wallet over-win flags and the aggregate chi-square.

## License

MIT. Use it, fork it, build on it.
