import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/split.js";
import type { Bill } from "../src/near.js";

const COLD = "bc1q9ljm5ccjnxlra49evsqrfxdw054w96hljsd4vv";
const DEPOSIT = "bc1q6q0w7qhag4y42949wxrs09rep6n6eege0sv4xu";
const coin = (value: number, vout = 0) => ({ txid: "f4c540c8c91af4529df810214ceedb034bff6c0b2272eec5d0f8fc29b309cff2", vout, value: BigInt(value) });
const NOW = 1_800_000_000_000;
const bill = (status: Bill["status"], deadlineMs = NOW + 86_400_000): Bill => ({
  id: "0", host: "host.near", miner: "miner.near", usd_cents: "600", period: "November 2026", status,
  quote: status === "QuoteApproved" ? { deposit_address: DEPOSIT, amount_in_sats: "9113", deadline_ns: String(BigInt(deadlineMs) * 1_000_000n) } : null,
} as unknown as Bill);
const base = { coldAddress: COLD, feeCap: 3000n, rate: 5n, nowMs: NOW };

test("idles with nothing confirmed at the payout address", () => {
  assert.equal(decide({ ...base, inputs: [], bill: null }).action, "idle");
});

test("with no open bill, sends everything to cold minus the fee", () => {
  const d = decide({ ...base, inputs: [coin(11_595)], bill: null });
  assert.equal(d.action, "split");
  if (d.action !== "split") return;
  assert.equal(d.outputs.length, 1);
  assert.equal(d.outputs[0].address, COLD);
  assert.equal(d.outputs[0].value, 11_595n - d.fee);
});

test("with an approved quote, pays the 1Click deposit first, then cold", () => {
  const d = decide({ ...base, inputs: [coin(11_595)], bill: bill("QuoteApproved") });
  assert.equal(d.action, "split");
  if (d.action !== "split") return;
  assert.deepEqual(d.outputs.map((o) => o.address), [DEPOSIT, COLD]);
  assert.equal(d.outputs[0].value, 9113n);
  assert.equal(d.outputs[1].value, 11_595n - 9113n - d.fee);
});

test("waits while the bill has no quote, never sweeping around it", () => {
  for (const s of ["Issued", "Accepted", "Paying"] as const) {
    assert.equal(decide({ ...base, inputs: [coin(50_000)], bill: bill(s) }).action, "wait", s);
  }
});

test("waits when the quote has expired", () => {
  assert.equal(decide({ ...base, inputs: [coin(50_000)], bill: bill("QuoteApproved", NOW - 1) }).action, "wait");
});

test("waits when the fee would be over the miner's cap", () => {
  assert.equal(decide({ ...base, inputs: [coin(50_000)], bill: null, rate: 100n }).action, "wait");
});

test("waits instead of making a dust cold output", () => {
  assert.equal(decide({ ...base, inputs: [coin(9500)], bill: bill("QuoteApproved") }).action, "wait");
});
