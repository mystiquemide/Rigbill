//! BIP143 signature hash for P2WPKH inputs, SIGHASH_ALL only.
//!
//! The contract builds every sighash itself from structured inputs and
//! outputs, so there is no code path that signs a caller-supplied hash.

use near_sdk::env;

pub const SIGHASH_ALL: u32 = 1;

pub struct TxIn {
    /// Previous txid in internal byte order (reverse of the explorer hex).
    pub txid: [u8; 32],
    pub vout: u32,
    pub value: u64,
    pub sequence: u32,
}

pub struct TxOut {
    pub value: u64,
    pub script_pubkey: Vec<u8>,
}

pub struct Tx {
    pub version: u32,
    pub inputs: Vec<TxIn>,
    pub outputs: Vec<TxOut>,
    pub lock_time: u32,
}

fn sha256d(data: &[u8]) -> [u8; 32] {
    let first = env::sha256_array(data);
    env::sha256_array(first)
}

fn push_var_int(buf: &mut Vec<u8>, n: u64) {
    match n {
        0..=0xfc => buf.push(n as u8),
        0xfd..=0xffff => {
            buf.push(0xfd);
            buf.extend_from_slice(&(n as u16).to_le_bytes());
        }
        0x1_0000..=0xffff_ffff => {
            buf.push(0xfe);
            buf.extend_from_slice(&(n as u32).to_le_bytes());
        }
        _ => {
            buf.push(0xff);
            buf.extend_from_slice(&n.to_le_bytes());
        }
    }
}

pub fn hash_prevouts(tx: &Tx) -> [u8; 32] {
    let mut buf = Vec::with_capacity(36 * tx.inputs.len());
    for i in &tx.inputs {
        buf.extend_from_slice(&i.txid);
        buf.extend_from_slice(&i.vout.to_le_bytes());
    }
    sha256d(&buf)
}

pub fn hash_sequence(tx: &Tx) -> [u8; 32] {
    let mut buf = Vec::with_capacity(4 * tx.inputs.len());
    for i in &tx.inputs {
        buf.extend_from_slice(&i.sequence.to_le_bytes());
    }
    sha256d(&buf)
}

pub fn hash_outputs(tx: &Tx) -> [u8; 32] {
    let mut buf = Vec::new();
    for o in &tx.outputs {
        buf.extend_from_slice(&o.value.to_le_bytes());
        push_var_int(&mut buf, o.script_pubkey.len() as u64);
        buf.extend_from_slice(&o.script_pubkey);
    }
    sha256d(&buf)
}

/// BIP143 sighash for input `index`, spent from a P2WPKH output paying to
/// `pubkey_hash` (HASH160 of the compressed public key).
pub fn p2wpkh_sighash(tx: &Tx, index: usize, pubkey_hash: &[u8; 20]) -> [u8; 32] {
    let input = &tx.inputs[index];
    let mut pre = Vec::with_capacity(182);
    pre.extend_from_slice(&tx.version.to_le_bytes());
    pre.extend_from_slice(&hash_prevouts(tx));
    pre.extend_from_slice(&hash_sequence(tx));
    pre.extend_from_slice(&input.txid);
    pre.extend_from_slice(&input.vout.to_le_bytes());
    // scriptCode for P2WPKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
    pre.extend_from_slice(&[0x19, 0x76, 0xa9, 0x14]);
    pre.extend_from_slice(pubkey_hash);
    pre.extend_from_slice(&[0x88, 0xac]);
    pre.extend_from_slice(&input.value.to_le_bytes());
    pre.extend_from_slice(&input.sequence.to_le_bytes());
    pre.extend_from_slice(&hash_outputs(tx));
    pre.extend_from_slice(&tx.lock_time.to_le_bytes());
    pre.extend_from_slice(&SIGHASH_ALL.to_le_bytes());
    sha256d(&pre)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    fn arr<const N: usize>(s: &str) -> [u8; N] {
        hex(s).try_into().unwrap()
    }

    /// Official BIP143 "Native P2WPKH" example, second input.
    fn bip143_vector() -> Tx {
        Tx {
            version: 1,
            inputs: vec![
                TxIn {
                    txid: arr("fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f"),
                    vout: 0,
                    value: 625_000_000,
                    sequence: 0xffff_ffee,
                },
                TxIn {
                    txid: arr("ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a"),
                    vout: 1,
                    value: 600_000_000,
                    sequence: 0xffff_ffff,
                },
            ],
            outputs: vec![
                TxOut {
                    value: 112_340_000,
                    script_pubkey: hex("76a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac"),
                },
                TxOut {
                    value: 223_450_000,
                    script_pubkey: hex("76a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac"),
                },
            ],
            lock_time: 0x11,
        }
    }

    #[test]
    fn bip143_intermediate_hashes() {
        let tx = bip143_vector();
        assert_eq!(
            hash_prevouts(&tx),
            arr::<32>("96b827c8483d4e9b96712b6713a7b68d6e8003a781feba36c31143470b4efd37")
        );
        assert_eq!(
            hash_sequence(&tx),
            arr::<32>("52b0a642eea2fb7ae638c36f6252b6750293dbe574a806984b8e4d8548339a3b")
        );
        assert_eq!(
            hash_outputs(&tx),
            arr::<32>("863ef3e1a92afbfdb97f31ad0fc7683ee943e9abcf2501590ff8f6551f47e5e5")
        );
    }

    #[test]
    fn bip143_p2wpkh_sighash_vector() {
        let tx = bip143_vector();
        let pkh = arr::<20>("1d0f172a0ecb48aee1be1f2687d2963ae33f71a1");
        assert_eq!(
            p2wpkh_sighash(&tx, 1, &pkh),
            arr::<32>("c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670")
        );
    }

    #[test]
    fn sighash_commits_amount() {
        let mut tx = bip143_vector();
        let pkh = arr::<20>("1d0f172a0ecb48aee1be1f2687d2963ae33f71a1");
        let honest = p2wpkh_sighash(&tx, 1, &pkh);
        tx.inputs[1].value -= 1;
        assert_ne!(p2wpkh_sighash(&tx, 1, &pkh), honest);
    }

    #[test]
    fn var_int_boundaries() {
        let mut b = Vec::new();
        push_var_int(&mut b, 0xfc);
        push_var_int(&mut b, 0xfd);
        push_var_int(&mut b, 0x1_0000);
        assert_eq!(b, hex("fcfdfd00fe00000100"));
    }
}
