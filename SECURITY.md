# Security

Rigbill's contract decides what a Bitcoin payout address may sign, so a bug in it can move real money. Reports are taken seriously.

## Reporting a vulnerability

Please don't open a public issue for a vulnerability.

1. Use GitHub's private reporting: the Security tab of this repository, then Report a vulnerability.
2. If that option isn't available, open an issue titled "Security contact request" with no details, and we'll reply with a private channel.

Include what you found, the affected file or contract method, the steps or transaction that show it, and the impact you expect. A failing test in `contract/src/tests.rs` is the most useful proof.

You'll get a first reply within 72 hours. Please give us a reasonable time to fix and redeploy before you publish anything.

## Scope

| In scope | Where |
|---|---|
| The NEAR contract | `contract/`, deployed as `v1.rigbill.near` (mainnet) and `v1.rigbill.testnet` |
| The relayer and keeper agent | `relayer/` |
| The web app | `web/`, served at rigbill.midelabs.xyz |

Especially interesting: any way to get a signature for a Bitcoin transaction that skips an open bill, pays an address other than the approved quote or the miner's cold wallet, spends a payout twice, or lets someone other than the miner, the open bill's host or an approved relayer request a split.

Out of scope: NEAR Chain Signatures (`v1.signer`), NEAR Intents 1Click and other third-party services (report those to their teams), the limits already listed under Known limits in the [README](README.md#known-limits), and denial of service against public RPC or explorer endpoints.

## How the contract limits damage

- The payout address has no private key. Only the contract can request a signature from `v1.signer`, and it builds and checks the BIP143 sighash of every transaction itself before asking.
- While a bill is open, the first output must be the host's locked 1Click quote and the rest must go to the miner's cold wallet. Anything else fails on chain before a signature is requested.
- Each payout (outpoint) can be signed once per miner, so a signed payout can't be spent again in a second split.
- The relayer refuses to broadcast unless every MPC signature verifies against the payout key and the contract's sighashes match its own build.

## Deployment

The deployed code hash is published in the [README](README.md#run-it) and checked by `npm run verify`. You can rebuild the wasm with `contract/build.sh` and the pinned toolchain and compare the hashes. The contract account still has a full-access key, so the code can be upgraded. That's disclosed in the README.

Never commit keys. Relayer keys go in environment variables (see `.env.example`).
