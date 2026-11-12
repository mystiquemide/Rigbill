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
    let mut c = Rigbill::new(signer_id(), BtcNetwork::Mainnet);
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
    let mut c = Rigbill::new(signer_id(), BtcNetwork::Mainnet);
    let _ = c.register_miner(COLD.into(), None);
}

#[test]
#[should_panic(expected = "BAD_ADDRESS")]
fn register_rejects_testnet_address() {
    set_ctx(miner_id(), MINER_STORAGE_DEPOSIT, vec![]);
    let mut c = Rigbill::new(signer_id(), BtcNetwork::Mainnet);
    let _ = c.register_miner("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx".into(), None);
}

#[test]
#[should_panic(expected = "BAD_ADDRESS")]
fn register_rejects_garbage_address() {
    set_ctx(miner_id(), MINER_STORAGE_DEPOSIT, vec![]);
    let mut c = Rigbill::new(signer_id(), BtcNetwork::Mainnet);
    let _ = c.register_miner("1BoatSLRHtKNngkdXEeobR76b53LETtpyT".into(), None);
}

#[test]
fn address_scripts() {
    assert_eq!(
        hex_encode(&address_to_script(COLD, BtcNetwork::Mainnet)),
        "0014751e76e8199196d454941c45d1b3a323f1433bd6"
    );
    let tr = address_to_script(TAPROOT, BtcNetwork::Mainnet);
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
    let mut c = Rigbill::new(signer_id(), BtcNetwork::Mainnet);
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
    let mut c = Rigbill::new(signer_id(), BtcNetwork::Mainnet);
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
            script_pubkey: address_to_script(COLD, BtcNetwork::Mainnet),
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

#[test]
fn testnet_contract_accepts_tb1_and_rejects_bc1() {
    set_ctx(miner_id(), NearToken::from_near(0), vec![]);
    let mut c = Rigbill::new(signer_id(), BtcNetwork::Testnet);
    set_ctx(miner_id(), MINER_STORAGE_DEPOSIT, vec![]);
    let _ = c.register_miner("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx".into(), None);
    assert_eq!(
        hex_encode(&c.get_miner(miner_id()).unwrap().cold_script),
        "0014751e76e8199196d454941c45d1b3a323f1433bd6"
    );
    assert_eq!(c.get_btc_network(), BtcNetwork::Testnet);
}

#[test]
#[should_panic(expected = "BAD_ADDRESS")]
fn testnet_contract_rejects_mainnet_address() {
    set_ctx(miner_id(), MINER_STORAGE_DEPOSIT, vec![]);
    let mut c = Rigbill::new(signer_id(), BtcNetwork::Testnet);
    let _ = c.register_miner(COLD.into(), None);
}

// ---------------------------------------------------------------- bills

use crate::bills::{BillStatus, BILL_STORAGE_DEPOSIT, GRACE_PERIOD_NS};

const DAY: u64 = 24 * 60 * 60 * 1_000_000_000;
const T0: u64 = 1_800_000_000 * 1_000_000_000;
const HOST_ADDR: &str = "0x1111111111111111111111111111111111111111";
const DEPOSIT_ADDR: &str = TAPROOT;

fn host_id() -> AccountId {
    "host.near".parse().unwrap()
}

fn at(predecessor: AccountId, deposit: NearToken, ts: u64) {
    let ctx = VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(predecessor)
        .attached_deposit(deposit)
        .block_timestamp(ts)
        .build();
    testing_env!(ctx);
}

fn issue(c: &mut Rigbill, ts: u64) -> U64 {
    at(host_id(), BILL_STORAGE_DEPOSIT, ts);
    c.issue_bill(
        miner_id(),
        U64(15_000),
        "2026-11".into(),
        U64(ts + 30 * DAY),
        HOST_ADDR.into(),
    )
}

fn accepted(ts: u64) -> (Rigbill, U64) {
    let mut c = registered();
    let id = issue(&mut c, ts);
    at(miner_id(), NearToken::from_near(0), ts);
    c.accept_bill(id, U64(250_000));
    (c, id)
}

#[test]
fn bill_full_lifecycle_to_quote_approved() {
    let (mut c, id) = accepted(T0);
    assert_eq!(c.get_bill(id).unwrap().status, BillStatus::Accepted);
    assert_eq!(c.get_open_bill(miner_id()).unwrap().id, id);
    at(host_id(), NearToken::from_near(0), T0 + DAY);
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(200_000), U64(T0 + 2 * DAY));
    let b = c.get_bill(id).unwrap();
    assert_eq!(b.status, BillStatus::QuoteApproved);
    let q = b.quote.unwrap();
    assert_eq!(q.amount_in_sats, U64(200_000));
    assert_eq!(&q.deposit_script[..2], &[0x51, 0x20]);
    assert_eq!(c.get_bills_for_host(host_id(), None).len(), 1);
    assert_eq!(c.get_bills_for_miner(miner_id(), None)[0].id, id);
}

#[test]
fn unaccepted_bill_has_no_effect() {
    let mut c = registered();
    issue(&mut c, T0);
    assert!(c.get_open_bill(miner_id()).is_none());
}

#[test]
#[should_panic(expected = "STORAGE_DEPOSIT_REQUIRED")]
fn issue_requires_storage_deposit() {
    let mut c = registered();
    at(host_id(), NearToken::from_near(0), T0);
    c.issue_bill(
        miner_id(),
        U64(100),
        "p".into(),
        U64(T0 + DAY),
        HOST_ADDR.into(),
    );
}

#[test]
#[should_panic(expected = "MINER_NOT_REGISTERED")]
fn issue_requires_registered_miner() {
    let mut c = registered();
    at(host_id(), BILL_STORAGE_DEPOSIT, T0);
    c.issue_bill(
        "nobody.near".parse().unwrap(),
        U64(100),
        "p".into(),
        U64(T0 + DAY),
        HOST_ADDR.into(),
    );
}

#[test]
#[should_panic(expected = "BAD_ADDRESS")]
fn issue_rejects_bad_host_address() {
    let mut c = registered();
    at(host_id(), BILL_STORAGE_DEPOSIT, T0);
    c.issue_bill(
        miner_id(),
        U64(100),
        "p".into(),
        U64(T0 + DAY),
        "0x123".into(),
    );
}

#[test]
#[should_panic(expected = "BAD_DUE_DATE")]
fn issue_rejects_past_due_date() {
    let mut c = registered();
    at(host_id(), BILL_STORAGE_DEPOSIT, T0);
    c.issue_bill(miner_id(), U64(100), "p".into(), U64(T0), HOST_ADDR.into());
}

#[test]
#[should_panic(expected = "NOT_MINER")]
fn only_the_miner_accepts() {
    let mut c = registered();
    let id = issue(&mut c, T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.accept_bill(id, U64(1000));
}

#[test]
#[should_panic(expected = "BILL_ALREADY_OPEN")]
fn one_open_bill_per_miner() {
    let (mut c, _) = accepted(T0);
    let id2 = issue(&mut c, T0);
    at(miner_id(), NearToken::from_near(0), T0);
    c.accept_bill(id2, U64(1000));
}

#[test]
fn host_withdraws_issued_bill() {
    let mut c = registered();
    let id = issue(&mut c, T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.withdraw_bill(id);
    assert_eq!(c.get_bill(id).unwrap().status, BillStatus::Withdrawn);
}

#[test]
#[should_panic(expected = "BAD_BILL_STATE")]
fn accepted_bill_cannot_be_withdrawn() {
    let (mut c, id) = accepted(T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.withdraw_bill(id);
}

#[test]
#[should_panic(expected = "NOT_HOST")]
fn only_host_withdraws() {
    let mut c = registered();
    let id = issue(&mut c, T0);
    at(miner_id(), NearToken::from_near(0), T0);
    c.withdraw_bill(id);
}

#[test]
#[should_panic(expected = "QUOTE_OVER_CEILING")]
fn rejects_quote_over_ceiling() {
    let (mut c, id) = accepted(T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(250_001), U64(T0 + DAY));
}

#[test]
#[should_panic(expected = "QUOTE_EXPIRED")]
fn rejects_quote_with_past_deadline() {
    let (mut c, id) = accepted(T0);
    at(host_id(), NearToken::from_near(0), T0 + DAY);
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(1000), U64(T0 + DAY));
}

#[test]
#[should_panic(expected = "NOT_HOST")]
fn only_host_approves_quote() {
    let (mut c, id) = accepted(T0);
    at(miner_id(), NearToken::from_near(0), T0);
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(1000), U64(T0 + DAY));
}

#[test]
#[should_panic(expected = "BAD_BILL_STATE")]
fn quote_needs_acceptance_first() {
    let mut c = registered();
    let id = issue(&mut c, T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(1000), U64(T0 + DAY));
}

#[test]
#[should_panic(expected = "BAD_ADDRESS")]
fn quote_rejects_deposit_address_on_wrong_network() {
    let (mut c, id) = accepted(T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.approve_quote(
        id,
        "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx".into(),
        U64(1000),
        U64(T0 + DAY),
    );
}

#[test]
#[should_panic(expected = "BAD_BILL_STATE")]
fn live_quote_cannot_be_replaced() {
    let (mut c, id) = accepted(T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(1000), U64(T0 + DAY));
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(2000), U64(T0 + DAY));
}

#[test]
fn expired_quote_can_be_replaced() {
    let (mut c, id) = accepted(T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(1000), U64(T0 + DAY));
    at(host_id(), NearToken::from_near(0), T0 + 2 * DAY);
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(2000), U64(T0 + 3 * DAY));
    assert_eq!(
        c.get_bill(id).unwrap().quote.unwrap().amount_in_sats,
        U64(2000)
    );
}

#[test]
fn bill_expires_releases_lock() {
    let (mut c, id) = accepted(T0);
    let due = T0 + 30 * DAY;
    let after = due + GRACE_PERIOD_NS + 1;
    at(host_id(), NearToken::from_near(0), after);
    assert_eq!(c.get_bill(id).unwrap().status, BillStatus::Expired);
    assert!(c.get_open_bill(miner_id()).is_none());
    // A new bill can be accepted once the old one has lapsed.
    let id2 = issue(&mut c, after);
    at(miner_id(), NearToken::from_near(0), after);
    c.accept_bill(id2, U64(1000));
    assert_eq!(c.get_open_bill(miner_id()).unwrap().id, id2);
    assert_eq!(c.expire_bill(id), BillStatus::Expired);
}

#[test]
fn bill_not_expired_within_grace() {
    let (mut c, id) = accepted(T0);
    at(
        host_id(),
        NearToken::from_near(0),
        T0 + 30 * DAY + GRACE_PERIOD_NS,
    );
    assert_eq!(c.expire_bill(id), BillStatus::Accepted);
}

#[test]
#[should_panic(expected = "BILL_OPEN_HOST_OUTPUT_REQUIRED")]
fn rejects_cold_only_with_open_bill() {
    let (mut c, _) = accepted(T0);
    at(
        "relayer.near".parse().unwrap(),
        SPLIT_STORAGE_DEPOSIT.saturating_add(NearToken::from_yoctonear(1)),
        T0,
    );
    let _ = c.sign_split(
        miner_id(),
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 13_000)],
    );
}

#[test]
fn cold_only_allowed_again_after_bill_expires() {
    let (mut c, _) = accepted(T0);
    let after = T0 + 30 * DAY + GRACE_PERIOD_NS + 1;
    at(
        "relayer.near".parse().unwrap(),
        SPLIT_STORAGE_DEPOSIT.saturating_add(NearToken::from_yoctonear(1)),
        after,
    );
    let _ = c.sign_split(
        miner_id(),
        vec![input(TXID_A, 0, 15_000)],
        vec![output(COLD, 13_000)],
    );
    assert_eq!(c.get_outpoint(TXID_A.into(), 0), Some(U64(0)));
}

// ---------------------------------------------------------------- phase 4: paying the bill

fn quoted(ts: u64) -> (Rigbill, U64) {
    let (mut c, id) = accepted(ts);
    at(host_id(), NearToken::from_near(0), ts);
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(200_000), U64(ts + 3 * DAY));
    (c, id)
}

fn split_at(c: &mut Rigbill, ts: u64, inputs: Vec<InputArg>, outputs: Vec<OutputArg>) {
    let n = inputs.len() as u128;
    at(
        "relayer.near".parse().unwrap(),
        SPLIT_STORAGE_DEPOSIT.saturating_add(NearToken::from_yoctonear(n)),
        ts,
    );
    let _ = c.sign_split(miner_id(), inputs, outputs);
}

fn pay_split(c: &mut Rigbill, ts: u64) {
    split_at(
        c,
        ts,
        vec![input(TXID_A, 0, 300_000)],
        vec![output(DEPOSIT_ADDR, 200_000), output(COLD, 98_000)],
    );
}

#[test]
fn split_pays_bill_and_marks_paying() {
    let (mut c, id) = quoted(T0);
    pay_split(&mut c, T0);
    let b = c.get_bill(id).unwrap();
    assert_eq!(b.status, BillStatus::Paying);
    assert_eq!(b.split_id, Some(U64(0)));
    assert_eq!(c.get_split(U64(0)).unwrap().bill_id, Some(id));
}

#[test]
#[should_panic(expected = "BILL_OPEN_HOST_OUTPUT_REQUIRED")]
fn rejects_cold_only_with_approved_quote() {
    let (mut c, _) = quoted(T0);
    split_at(
        &mut c,
        T0,
        vec![input(TXID_A, 0, 300_000)],
        vec![output(COLD, 298_000)],
    );
}

#[test]
#[should_panic(expected = "OUTPUT_NOT_ALLOWED")]
fn rejects_third_output_with_open_bill() {
    let (mut c, _) = quoted(T0);
    split_at(
        &mut c,
        T0,
        vec![input(TXID_A, 0, 300_000)],
        vec![
            output(DEPOSIT_ADDR, 200_000),
            output(COLD, 50_000),
            output(OTHER, 48_000),
        ],
    );
}

#[test]
#[should_panic(expected = "OUTPUT_NOT_ALLOWED")]
fn rejects_swapped_output_order() {
    let (mut c, _) = quoted(T0);
    split_at(
        &mut c,
        T0,
        vec![input(TXID_A, 0, 300_000)],
        vec![output(COLD, 98_000), output(DEPOSIT_ADDR, 200_000)],
    );
}

#[test]
#[should_panic(expected = "OUTPUT_NOT_ALLOWED")]
fn rejects_deposit_without_cold_output() {
    let (mut c, _) = quoted(T0);
    split_at(
        &mut c,
        T0,
        vec![input(TXID_A, 0, 202_000)],
        vec![output(DEPOSIT_ADDR, 200_000)],
    );
}

#[test]
#[should_panic(expected = "OUTPUT_AMOUNT_MISMATCH")]
fn rejects_host_amount_mismatch() {
    let (mut c, _) = quoted(T0);
    split_at(
        &mut c,
        T0,
        vec![input(TXID_A, 0, 300_000)],
        vec![output(DEPOSIT_ADDR, 199_999), output(COLD, 98_001)],
    );
}

#[test]
#[should_panic(expected = "QUOTE_EXPIRED")]
fn rejects_split_after_quote_deadline() {
    let (mut c, _) = quoted(T0);
    pay_split(&mut c, T0 + 3 * DAY);
}

#[test]
#[should_panic(expected = "BILL_OPEN_HOST_OUTPUT_REQUIRED")]
fn rejects_second_split_while_paying() {
    let (mut c, _) = quoted(T0);
    pay_split(&mut c, T0);
    split_at(
        &mut c,
        T0,
        vec![input(TXID_B, 0, 300_000)],
        vec![output(DEPOSIT_ADDR, 200_000), output(COLD, 98_000)],
    );
}

#[test]
fn failed_sign_returns_bill_to_quote_approved() {
    let (mut c, id) = quoted(T0);
    pay_split(&mut c, T0);
    set_ctx(
        contract_id(),
        NearToken::from_near(0),
        vec![PromiseResult::Failed],
    );
    assert_eq!(c.on_signed(U64(0)), SplitStatus::Failed);
    let b = c.get_bill(id).unwrap();
    assert_eq!(b.status, BillStatus::QuoteApproved);
    assert_eq!(b.split_id, None);
    assert_eq!(c.get_outpoint(TXID_A.into(), 0), None);
}

#[test]
fn confirm_paid_releases_lock() {
    let (mut c, id) = quoted(T0);
    pay_split(&mut c, T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.confirm_paid(id);
    assert_eq!(c.get_bill(id).unwrap().status, BillStatus::Paid);
    assert!(c.get_open_bill(miner_id()).is_none());
    // Later payouts with no open bill go to cold storage.
    split_at(
        &mut c,
        T0,
        vec![input(TXID_B, 0, 50_000)],
        vec![output(COLD, 48_000)],
    );
    assert_eq!(c.get_split(U64(1)).unwrap().bill_id, None);
}

#[test]
#[should_panic(expected = "NOT_HOST")]
fn only_host_confirms_paid() {
    let (mut c, id) = quoted(T0);
    pay_split(&mut c, T0);
    at(miner_id(), NearToken::from_near(0), T0);
    c.confirm_paid(id);
}

#[test]
#[should_panic(expected = "BAD_BILL_STATE")]
fn confirm_paid_needs_paying() {
    let (mut c, id) = quoted(T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.confirm_paid(id);
}

#[test]
fn refund_returns_bill_to_accepted() {
    let (mut c, id) = quoted(T0);
    pay_split(&mut c, T0);
    at(host_id(), NearToken::from_near(0), T0);
    c.report_refund(id);
    let b = c.get_bill(id).unwrap();
    assert_eq!(b.status, BillStatus::Accepted);
    assert!(b.quote.is_none());
    assert_eq!(c.get_open_bill(miner_id()).unwrap().id, id);
    // The host can lock a fresh quote straight away.
    c.approve_quote(id, DEPOSIT_ADDR.into(), U64(210_000), U64(T0 + DAY));
}

#[test]
fn paying_bill_expires_after_grace() {
    let (mut c, id) = quoted(T0);
    pay_split(&mut c, T0);
    let after = T0 + 30 * DAY + GRACE_PERIOD_NS + 1;
    at(host_id(), NearToken::from_near(0), after);
    assert_eq!(c.expire_bill(id), BillStatus::Expired);
    assert!(c.get_open_bill(miner_id()).is_none());
}
