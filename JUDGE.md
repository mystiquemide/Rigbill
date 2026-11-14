# Judging Rigbill

A 5 minute path through the product and the proof. Every step is "do X, see Y", and every claim links to something you can check yourself without trusting us.

## In one paragraph

Mining hosts bill their clients in dollars, but the miners earn Bitcoin. Rigbill gives each miner a Bitcoin payout address whose only key is a NEAR contract, through NEAR Chain Signatures. While a bill is open, the contract refuses to sign any transaction that doesn't pay the bill first. The bill's share goes through NEAR Intents 1Click and lands as USDC on Base for the host, and the rest goes to the miner's own wallet. It ran on mainnet with real money.

| | |
|---|---|
| Tracks | Real-World Money (`realworld`), Open Innovation (`open`) |
| Demo video | [youtu.be/uXWAdQzu4Tc](https://youtu.be/uXWAdQzu4Tc) (2 minutes) |
| Demo post | [on X](https://x.com/MystiqueMide/status/2121614001477926978) |
| Live app | [rigbill.midelabs.xyz](https://rigbill.midelabs.xyz) |
| Contract | [`v1.rigbill.near`](https://nearblocks.io/address/v1.rigbill.near) |
| Built | 2026-11-12 to 2026-11-14, all code in the hackathon window |

## The path

### 1. See every claim pass in your browser (1 minute)

Do: open [rigbill.midelabs.xyz/proof](https://rigbill.midelabs.xyz/proof).

See: "All checks passed", read live from NEAR mainnet, Bitcoin mainnet and 1Click. The checks cover the deployed code hash, the payout address coming from the MPC key, the Bitcoin split matching what the contract signed, 1Click reporting `SUCCESS`, and three on-chain refusals.

Proves: the product is live on mainnet and its claims are checked against the chains, not written in a README.

### 2. Run the same checks yourself (1 minute)

Do: from a clone, with Node 20+ and no keys:

```bash
npm run verify
```

See: a `PASS` line per check and `All checks passed.`

Proves: anyone can reproduce the proof from the public chains with nothing but this repository.

### 3. Watch the contract say no (30 seconds)

Do: open the [refused transaction](https://nearblocks.io/txns/2cTep6qoRqYoLKb6uoSaPFfi1jsRzUvUfuvyrsomn9Ch) on NEAR mainnet.

See: `Failed` with `Smart contract panicked: BILL_OPEN_HOST_OUTPUT_REQUIRED`. The miner tried to send the whole payout to their own wallet while bill #0 was open.

Proves: the rule is enforced on chain, before any signature exists. There is no app-side check to bypass. Two more refusals: [a third output](https://nearblocks.io/txns/2GJwdkLgVbccvwaWEUvArBy4H8jYu2wyxMyqmVoymRFt) (`OUTPUT_NOT_ALLOWED`) and [re-spending a signed payout](https://nearblocks.io/txns/8gLWfPQxHjQxTe4An9AN48mWgRMFv8Ubh8MsQwKY6QGK) (`OUTPOINT_ALREADY_SIGNED`).

### 4. Follow real money from Bitcoin to USDC (1 minute)

Do: open these in order.

1. [The NEAR transaction that asked the MPC network to sign](https://nearblocks.io/txns/5iouTCA3KtZL5Wkoe45wyd3bPEuZPKPLBFa7JynoreBU). See a receipt to `v1.signer`.
2. [The Bitcoin split](https://mempool.space/tx/fcdf483e77ceb067b3c120f42c0b2a91a20194d61ed63329ca3c28837b25a397). See 9,113 sats to the 1Click deposit and 1,657 sats to the miner's wallet, confirmed in block 975,706.
3. [The USDC on Base](https://basescan.org/tx/0x2c3e7251d5178d0b83006457e06694e1ecf80176e072dcbb80cd931f1950b1c6). See 6.20 USDC delivered to the host.
4. [The host confirming paid](https://nearblocks.io/txns/FnW37Rd4xu7rY4GG4ovtNmHt484Frep5hZ7dgZ6B6NqG). See `confirm_paid` on `v1.rigbill.near`.

Proves: the whole loop works across three chains with real funds: NEAR decides, the MPC network signs Bitcoin, 1Click settles in USDC.

### 5. Try the app (1 minute)

Do: open [rigbill.midelabs.xyz](https://rigbill.midelabs.xyz), choose Open the app, and sign in with any NEAR wallet (Meteor, Intear, Nightly and others through NEAR Connect).

See: your own Bitcoin payout address, derived for your NEAR account by the MPC network. Nobody, including us, holds its key. As a host, the Host tab lets you issue a bill in USD to any registered miner.

Proves: the product works for a new user, not just for our demo accounts. A full bill loop on testnet with fresh accounts is in `e2e/`.

### 6. Check the contract (30 seconds, or longer if you like Rust)

Do:

```bash
cd contract && cargo test
```

See: 85 tests pass, including the official BIP143 sighash vector, every refusal, the bill lifecycle and storage accounting.

Then read `sign_split` in [`contract/src/lib.rs`](contract/src/lib.rs). The contract builds the Bitcoin sighash itself, so the relayer can't get a signature over anything the contract didn't check.

## Where NEAR is load bearing

| NEAR piece | Its job in Rigbill | Without it |
|---|---|---|
| Chain Signatures (`v1.signer`) | The only key to every payout address | Someone holds a Bitcoin key and can skip the bill |
| Rust contract on NEAR | Builds and checks every Bitcoin transaction before signing | Nothing enforces the bill |
| NEAR Intents 1Click | BTC to USDC on Base at a locked quote | The host gets BTC and sells it by hand |
| NEAR accounts and NEAR Connect | Identity for miners and hosts, and the derivation path for each payout address | No one to bill, no address per miner |

## What to look for in the code

| File | What it shows |
|---|---|
| [`contract/src/lib.rs`](contract/src/lib.rs) | `sign_split`: who may ask, the output rules, outpoint reservations, the MPC calls |
| [`contract/src/bills.rs`](contract/src/bills.rs) | The bill state machine, quote ceiling, expiry, refunds |
| [`contract/src/tests.rs`](contract/src/tests.rs) | 85 tests, one per rule and refusal |
| [`relayer/src/split.ts`](relayer/src/split.ts) | Building the split, checking it matches the contract, verifying MPC signatures |
| [`relayer/src/agent.ts`](relayer/src/agent.ts) | The keeper agent that splits payouts on its own, with no power the contract doesn't grant |
| [`relayer/src/verify.ts`](relayer/src/verify.ts) | The keyless proof behind `npm run verify` and `/proof` |

## Honest limits

- Paid is the host's word. Confirming only gives up the host's own claim, so it can't harm the miner. Verifying the USDC transfer on chain is next.
- The miner could point their pool elsewhere off-chain. Hosts usually control the rigs and can see each rig's payout address.
- 1Click has a minimum swap of a little over $6, which is why bill #0's quote was 6.20 USDC.
- The demo payouts came from the builder's own wallet, standing in for a pool.

The full list is under Known limits in the [README](README.md#known-limits).

## What's next

Paid verified on chain through NEAR, more payout chains through 1Click, and a first hosting partner running real client rigs.

#NEARHackathon
