# Browser end-to-end test (testnet)

Drives the real web app in Chromium against the live testnet contract. The only test double is the wallet: an injected NEAR Connect wallet that signs real testnet transactions with keys from `~/.near-credentials/testnet` (as written by `near-cli-rs`).

`flow1.cjs`: miner signs in and registers, host issues a bill, miner accepts with the pre-filled ceiling, host approves a quote.
`flow2.cjs`: after the payout address holds a confirmed payout, the miner's sweep to cold is refused on chain, the relayer pays the bill, the host confirms paid.

```bash
cd web && npm run build && npx vite preview --port 4173
```

```bash
E2E_MINER=<miner.testnet> E2E_HOST=<host.testnet> E2E_COLD=<tb1 cold> E2E_STANDIN=<tb1 stand-in deposit> node e2e/flow1.cjs
```

Send testnet4 coins to the payout address that `flow1.cjs` prints, wait for one confirmation, then:

```bash
node e2e/flow2.cjs
```

Screenshots land in `e2e/out/`.
