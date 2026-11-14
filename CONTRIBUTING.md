# Contributing

Issues and pull requests are welcome. For a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Setup

You need Node 20+ and Rust. The Rust toolchain is pinned in `rust-toolchain.toml`.

```bash
git clone https://github.com/mystiquemide/Rigbill && cd Rigbill
```

```bash
npm test
```

That runs the contract tests (`cargo test`) and the relayer tests. To check the live deployment against the chains, with no keys:

```bash
npm run verify
```

Run the web app against testnet:

```bash
cd web && npm install && VITE_NETWORK=testnet npm run dev
```

## Where things live

| Path | What |
|---|---|
| `contract/` | NEAR contract in Rust: bills, quotes, split rules, BIP143 sighash, MPC calls |
| `relayer/` | CLI, keeper agent and `verify` in TypeScript |
| `web/` | React app |
| `e2e/` | Browser end-to-end test on testnet |
| `proof/` | Transactions `npm run verify` checks |

## Pull requests

- Keep each pull request to one change, and say what it changes and why.
- A change to the contract's rules needs a test in `contract/src/tests.rs` for the new behaviour and for the refusal it adds or changes.
- A change to how the relayer builds transactions must keep its output identical to the contract's sighash. The parity tests in `relayer/test/btc.test.ts` cover this.
- Before you open it, run `npm test`, `cargo clippy` in `contract/` and `npm run build` in `web/`. CI runs the same checks plus `npm run verify`.
- Don't commit keys, `.env` files or build output.

## Testing on testnet

Use NEAR testnet and Bitcoin testnet4 (`NETWORK=testnet`, `VITE_NETWORK=testnet`). NEAR Intents has no testnet, so mainnet 1Click calls stay dry quotes unless you mean to spend real funds.

## License

By contributing, you agree your contribution is licensed under the [MIT License](LICENSE).
