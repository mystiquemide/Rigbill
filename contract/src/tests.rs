use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::PromiseResult;
use near_sdk::{testing_env, RuntimeFeesConfig};

const COLD: &str = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const OTHER: &str = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";
const TAPROOT: &str = "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297";
const TXID_A: &str = "aa00000000000000000000000000000000000000000000000000000000000001";
const TXID_B: &str = "bb00000000000000000000000000000000000000000000000000000000000002";

/// secp256k1 generator point G (private key 1), uncompressed x ++ y.
const G_XY: &str = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798\
                    483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";

fn contract_id() -> AccountId {
    "v1.rigbill.near".parse().unwrap()
}
fn miner_id() -> AccountId {
    "miner.near".parse().unwrap()
}
fn signer_id() -> AccountId {
    "v1.signer".parse().unwrap()
}

fn set_ctx(predecessor: AccountId, deposit: NearToken, results: Vec<PromiseResult>) {
    let ctx = VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(predecessor)
        .attached_deposit(deposit)
        .build();
    testing_env!(
        ctx,
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}

fn derived_key_json() -> Vec<u8> {
    let xy = hex_decode(G_XY).unwrap();
    format!("\"secp256k1:{}\"", bs58::encode(xy).into_string()).into_bytes()
}

fn registered() -> Rigbill {
    set_ctx(miner_id(), NearToken::from_near(0), vec![]);
    let mut c = Rigbill::new(signer_id());
    set_ctx(miner_id(), MINER_STORAGE_DEPOSIT, vec![]);
    let _ = c.register_miner(COLD.into(), None);
    set_ctx(
        contract_id(),
        NearToken::from_near(0),
        vec![PromiseResult::Successful(derived_key_json())],
    );
    c.on_derived_key(miner_id());
    c
}

fn input(txid: &str, vout: u32, value: u64) -> InputArg {
    InputArg {
        txid: txid.into(),
        vout,
        value: U64(value),
    }
}
fn output(address: &str, value: u64) -> OutputArg {
    OutputArg {
        address: address.into(),
        value: U64(value),
    }
}

fn relayer_ctx(inputs: usize) {
    set_ctx(
        "relayer.near".parse().unwrap(),
        SPLIT_STORAGE_DEPOSIT.saturating_add(NearToken::from_yoctonear(inputs as u128)),
        vec![],
    );
}

fn split(c: &mut Rigbill, inputs: Vec<InputArg>, outputs: Vec<OutputArg>) {
    relayer_ctx(inputs.len());
    let _ = c.sign_split(miner_id(), inputs, outputs);
}

#[test]
fn register_stores_derived_payout_key() {
    let c = registered();
    let m = c.get_miner(miner_id()).unwrap();
    assert_eq!(m.fee_cap_sats, U64(DEFAULT_FEE_CAP));
    assert_eq!(
        m.payout_pubkey.unwrap(),
        "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    );
    // HASH160 of G compressed, a well-known value.
    assert_eq!(
        hex_encode(&m.payout_pubkey_hash.unwrap()),
        "751e76e8199196d454941c45d1b3a323f1433bd6"
    );
    assert_eq!(c.get_payout_path(miner_id()), "miner/miner.near");
}

#[test]
#[should_panic(expected = "STORAGE_DEPOSIT_REQUIRED")]
fn register_requires_storage_deposit() {
    set_ctx(miner_id(), NearToken::from_near(0), vec![]);
    let mut c = Rigbill::new(signer_id());
    let _ = c.register_miner(COLD.into(), None);
}

#[test]
#[should_panic(expected = "BAD_ADDRESS")]
fn register_rejects_testnet_address() {
    set_ctx(miner_id(), MINER_STORAGE_DEPOSIT, vec![]);
    let mut c = Rigbill::new(signer_id());
    let _ = c.register_miner("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx".into(), None);
}

#[test]
#[should_panic(expected = "BAD_ADDRESS")]
fn register_rejects_garbage_address() {
    set_ctx(miner_id(), MINER_STORAGE_DEPOSIT, vec![]);
    let mut c = Rigbill::new(signer_id());
    let _ = c.register_miner("1BoatSLRHtKNngkdXEeobR76b53LETtpyT".into(), None);
}

#[test]
fn address_scripts() {
    assert_eq!(
        hex_encode(&address_to_script(COLD)),
        "0014751e76e8199196d454941c45d1b3a323f1433bd6"
    );
    let tr = address_to_script(TAPROOT);
    assert_eq!(&tr[..2], &[0x51, 0x20]);
    assert_eq!(tr.len(), 34);
}

#[test]
#[should_panic(expected = "OUTPUT_NOT_ALLOWED")]
fn rejects_output_to_other_address() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 15_000)],
        vec![output(OTHER, 13_000)],
    );
}

#[test]
#[should_panic(expected = "OUTPUT_NOT_ALLOWED")]
fn rejects_extra_output() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 6_000), output(OTHER, 7_000)],
    );
}

#[test]
#[should_panic(expected = "FEE_OVER_CAP")]
fn rejects_fee_over_cap() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 11_999)],
    );
}

#[test]
#[should_panic(expected = "BAD_AMOUNT")]
fn rejects_outputs_above_inputs() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 15_001)],
    );
}

#[test]
#[should_panic(expected = "DUST_OUTPUT")]
fn rejects_dust_output() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 2_000)],
        vec![output(COLD, 545)],
    );
}

#[test]
#[should_panic(expected = "TOO_MANY_INPUTS")]
fn rejects_five_inputs() {
    let mut c = registered();
    let ins = (0..5).map(|v| input(TXID_A, v, 10_000)).collect();
    split(&mut c, ins, vec![output(COLD, 49_000)]);
}

#[test]
#[should_panic(expected = "STORAGE_DEPOSIT_REQUIRED")]
fn split_requires_deposit() {
    let mut c = registered();
    set_ctx(
        "relayer.near".parse().unwrap(),
        NearToken::from_near(0),
        vec![],
    );
    let _ = c.sign_split(
        miner_id(),
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 13_000)],
    );
}

#[test]
#[should_panic(expected = "MINER_NOT_REGISTERED")]
fn rejects_unknown_miner() {
    set_ctx(miner_id(), NearToken::from_near(0), vec![]);
    let mut c = Rigbill::new(signer_id());
    relayer_ctx(1);
    let _ = c.sign_split(
        miner_id(),
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 13_000)],
    );
}

#[test]
#[should_panic(expected = "MINER_NOT_REGISTERED")]
fn rejects_miner_without_derived_key() {
    set_ctx(miner_id(), NearToken::from_near(0), vec![]);
    let mut c = Rigbill::new(signer_id());
    set_ctx(miner_id(), MINER_STORAGE_DEPOSIT, vec![]);
    let _ = c.register_miner(COLD.into(), None);
    relayer_ctx(1);
    let _ = c.sign_split(
        miner_id(),
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 13_000)],
    );
}

#[test]
#[should_panic(expected = "OUTPOINT_ALREADY_SIGNED")]
fn rejects_duplicate_outpoint_in_one_request() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 10_000), input(TXID_A, 0, 10_000)],
        vec![output(COLD, 18_000)],
    );
}

#[test]
fn valid_split_reserves_outpoints_and_records_sighash() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 10_000), input(TXID_B, 3, 5_000)],
        vec![output(COLD, 13_000)],
    );
    let s = c.get_split(U64(0)).unwrap();
    assert_eq!(s.status, SplitStatus::Requested);
    assert_eq!(s.sighashes.len(), 2);
    assert_eq!(s.txid.len(), 64);
    assert_eq!(c.get_outpoint(TXID_A.into(), 0), Some(U64(0)));
    assert_eq!(c.get_outpoint(TXID_B.into(), 3), Some(U64(0)));
    assert_eq!(c.get_outpoint(TXID_B.into(), 0), None);
    assert!(get_logs()[0].contains("split_requested"));

    // Sighash must equal an independent BIP143 computation over the
    // ADR-002 constants and the derived key hash.
    let tx = Tx {
        version: TX_VERSION,
        inputs: vec![
            TxIn {
                txid: parse_txid(TXID_A),
                vout: 0,
                value: 10_000,
                sequence: TX_SEQUENCE,
            },
            TxIn {
                txid: parse_txid(TXID_B),
                vout: 3,
                value: 5_000,
                sequence: TX_SEQUENCE,
            },
        ],
        outputs: vec![TxOut {
            value: 13_000,
            script_pubkey: address_to_script(COLD),
        }],
        lock_time: TX_LOCK_TIME,
    };
    let pkh: [u8; 20] = hex_decode("751e76e8199196d454941c45d1b3a323f1433bd6")
        .unwrap()
        .try_into()
        .unwrap();
    assert_eq!(
        s.sighashes[1],
        hex_encode(&bip143::p2wpkh_sighash(&tx, 1, &pkh))
    );
}

#[test]
#[should_panic(expected = "OUTPOINT_ALREADY_SIGNED")]
fn rejects_replayed_outpoint() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 13_000)],
    );
    split(
        &mut c,
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 14_000)],
    );
}

#[test]
fn signed_callback_stores_signatures() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 13_000)],
    );
    let sig = br#"{"scheme":"Secp256k1","big_r":{"affine_point":"02AA"},"s":{"scalar":"BB"},"recovery_id":0}"#;
    set_ctx(
        contract_id(),
        NearToken::from_near(0),
        vec![PromiseResult::Successful(sig.to_vec())],
    );
    assert_eq!(c.on_signed(U64(0)), SplitStatus::Signed);
    let s = c.get_split(U64(0)).unwrap();
    assert_eq!(s.signatures, vec![String::from_utf8(sig.to_vec()).unwrap()]);
    assert_eq!(c.get_outpoint(TXID_A.into(), 0), Some(U64(0)));
}

#[test]
fn failed_sign_releases_outpoints() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 10_000), input(TXID_B, 1, 5_000)],
        vec![output(COLD, 13_000)],
    );
    set_ctx(
        contract_id(),
        NearToken::from_near(0),
        vec![
            PromiseResult::Successful(b"{}".to_vec()),
            PromiseResult::Failed,
        ],
    );
    assert_eq!(c.on_signed(U64(0)), SplitStatus::Failed);
    assert_eq!(c.get_outpoint(TXID_A.into(), 0), None);
    assert_eq!(c.get_outpoint(TXID_B.into(), 1), None);
    // The UTXOs can be split again.
    split(
        &mut c,
        vec![input(TXID_A, 0, 10_000)],
        vec![output(COLD, 8_000)],
    );
    assert_eq!(c.get_outpoint(TXID_A.into(), 0), Some(U64(1)));
}

#[test]
fn txid_is_display_order() {
    // Same tx as a 1-in/1-out split. Round trip display -> internal -> display.
    let mut b = parse_txid(TXID_A);
    b.reverse();
    assert_eq!(hex_encode(&b), TXID_A);
}

#[test]
fn sighash_range_constant_is_curve_order() {
    assert_eq!(
        hex_encode(&SECP256K1_N),
        "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"
    );
}

/// Same split as `relayer/test/btc.test.ts` ("split tx parity values"). The
/// contract and the relayer are independent implementations, so equal txid
/// and sighashes prove the relayer can assemble what the contract signed.
#[test]
fn split_parity_with_relayer() {
    let mut c = registered();
    split(
        &mut c,
        vec![input(TXID_A, 0, 10_000), input(TXID_B, 3, 5_000)],
        vec![output(COLD, 13_000)],
    );
    let s = c.get_split(U64(0)).unwrap();
    assert_eq!(
        s.txid,
        "d09cbecc9f6ff47dc98dfd2fc38c5f0bdc8a5393c904307b82acae6b69e21427"
    );
    assert_eq!(
        s.sighashes,
        vec![
            "7127fabe3a2786ae4d995ade58148d50c14f692a26ff1099720df0ab94af3ac6".to_string(),
            "a7717276de2e145ce61680f38172a046099c2d412e066470f7c91e1c38f4a213".to_string(),
        ]
    );
}
