import { test } from "node:test";
import assert from "node:assert/strict";
import * as btc from "@scure/btc-signer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hex } from "@scure/base";
import * as B from "../src/btc.js";

// Private key 1, public key G. Its P2WPKH address is the BIP173 example.
const PRIV = hex.decode("0000000000000000000000000000000000000000000000000000000000000001");
const PUB = secp256k1.getPublicKey(PRIV, true);
const COLD = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TXID_A = "aa00000000000000000000000000000000000000000000000000000000000001";
const TXID_B = "bb00000000000000000000000000000000000000000000000000000000000002";

function mpcSign(msg: Uint8Array, priv = PRIV): string {
  const sig = secp256k1.Signature.fromBytes(
    secp256k1.sign(msg, priv, { prehash: false, lowS: true, format: "recovered" }), "recovered");
  const s = sig.s.toString(16).padStart(64, "0");
  const big_r = (sig.recovery! & 1 ? "03" : "02") + sig.r.toString(16).padStart(64, "0");
  return JSON.stringify({ scheme: "Secp256k1", big_r: { affine_point: big_r }, s: { scalar: s }, recovery_id: sig.recovery });
}

test("payout address for G is the BIP173 example", () => {
  assert.equal(B.payoutAddress(PUB), COLD);
});

test("compressPubkey accepts the 64-byte x||y form v1.signer returns", () => {
  const xy = secp256k1.getPublicKey(PRIV, false).slice(1);
  assert.deepEqual(B.compressPubkey(xy), PUB);
});

test("sighash matches the official BIP143 native P2WPKH vector", () => {
  const pkh = hex.decode("1d0f172a0ecb48aee1be1f2687d2963ae33f71a1");
  const tx = new btc.Transaction({ version: 1, lockTime: 0x11, allowUnknownOutputs: true });
  tx.addInput({ txid: "9f96ade4b41d5433f4eda31e1738ec2b36f6e7d1420d94a6af99801a88f7f7ff", index: 0, sequence: 0xffffffee,
    // Input 0 is P2PK in the BIP. Its script and amount don't enter input 1's sighash.
    witnessUtxo: { script: Uint8Array.from([0x00, 0x14, ...pkh]), amount: 625000000n } });
  tx.addInput({ txid: "8ac60eb9575db5b2d987e29f301b5b819ea83a5c6579d282d189cc04b8e151ef", index: 1, sequence: 0xffffffff,
    witnessUtxo: { script: Uint8Array.from([0x00, 0x14, ...pkh]), amount: 600000000n } });
  tx.addOutput({ script: hex.decode("76a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac"), amount: 112340000n });
  tx.addOutput({ script: hex.decode("76a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac"), amount: 223450000n });
  const scriptCode = btc.OutScript.encode({ type: "pkh", hash: pkh });
  assert.equal(hex.encode(tx.preimageWitnessV0(1, scriptCode, B.SIGHASH_ALL, 600000000n)),
    "c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670");
});

// Same split as the Rust test `split_parity_with_relayer`. Both must produce these values.
const PARITY = {
  txid: "d09cbecc9f6ff47dc98dfd2fc38c5f0bdc8a5393c904307b82acae6b69e21427",
  sighash0: "7127fabe3a2786ae4d995ade58148d50c14f692a26ff1099720df0ab94af3ac6",
  sighash1: "a7717276de2e145ce61680f38172a046099c2d412e066470f7c91e1c38f4a213",
};

test("split tx parity values (shared with the contract tests)", () => {
  const ins = [{ txid: TXID_A, vout: 0, value: 10000n }, { txid: TXID_B, vout: 3, value: 5000n }];
  const tx = B.buildSplitTx(PUB, ins, [{ address: COLD, value: 13000n }]);
  const s0 = hex.encode(B.sighash(tx, 0, PUB, 10000n));
  const s1 = hex.encode(B.sighash(tx, 1, PUB, 5000n));
  assert.deepEqual({ txid: tx.id, sighash0: s0, sighash1: s1 }, PARITY);
});

test("verify + finalize produces a tx whose witness signatures check out", () => {
  const ins = [{ txid: TXID_A, vout: 0, value: 10000n }, { txid: TXID_B, vout: 3, value: 5000n }];
  const tx = B.buildSplitTx(PUB, ins, [{ address: COLD, value: 13000n }]);
  const hashes = ins.map((i, idx) => B.sighash(tx, idx, PUB, i.value));
  const sigs = hashes.map((h) => B.verifyMpcSignature(B.parseMpcSignature(mpcSign(h)), h, PUB));
  const { hex: raw, txid } = B.finalize(tx, PUB, sigs);

  const parsed = btc.Transaction.fromRaw(hex.decode(raw), { allowUnknownOutputs: true });
  assert.equal(parsed.id, txid);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.lockTime, 0);
  for (let i = 0; i < 2; i++) {
    const inp = parsed.getInput(i);
    assert.equal(inp.sequence, B.TX_SEQUENCE);
    const [derSig, pub] = inp.finalScriptWitness!;
    assert.equal(derSig[derSig.length - 1], B.SIGHASH_ALL);
    assert.deepEqual(pub, PUB);
    const compact = secp256k1.Signature.fromBytes(derSig.slice(0, -1), "der").toBytes("compact");
    assert.ok(secp256k1.verify(compact, hashes[i], PUB, { prehash: false }));
  }
});

test("rejects a signature from a different key", () => {
  const tx = B.buildSplitTx(PUB, [{ txid: TXID_A, vout: 0, value: 10000n }], [{ address: COLD, value: 8000n }]);
  const h = B.sighash(tx, 0, PUB, 10000n);
  const other = hex.decode("0000000000000000000000000000000000000000000000000000000000000002");
  assert.throws(() => B.verifyMpcSignature(B.parseMpcSignature(mpcSign(h, other)), h, PUB), /does not recover/);
});

test("rejects a signature over a different message", () => {
  const tx = B.buildSplitTx(PUB, [{ txid: TXID_A, vout: 0, value: 10000n }], [{ address: COLD, value: 8000n }]);
  const h = B.sighash(tx, 0, PUB, 10000n);
  const wrong = B.sighash(tx, 0, PUB, 9999n);
  assert.throws(() => B.verifyMpcSignature(B.parseMpcSignature(mpcSign(wrong)), h, PUB));
});

test("rejects malformed MPC responses", () => {
  assert.throws(() => B.parseMpcSignature("{}"), /Malformed/);
  assert.throws(() => B.parseMpcSignature(JSON.stringify({ big_r: { affine_point: "02" }, s: { scalar: "00" }, recovery_id: 0 })), /Malformed/);
});
