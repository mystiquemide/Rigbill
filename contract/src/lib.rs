pub mod bills;
pub mod bip143;

use bip143::{Tx, TxIn, TxOut};
use near_sdk::json_types::U64;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PublicKey,
};

/// Version 2, opt-in RBF sequence, zero locktime, SIGHASH_ALL (ADR-002).
pub const TX_VERSION: u32 = 2;
pub const TX_SEQUENCE: u32 = 0xffff_fffd;
pub const TX_LOCK_TIME: u32 = 0;
pub const DUST_LIMIT: u64 = 546;
pub const MAX_INPUTS: usize = 4;
pub const DEFAULT_FEE_CAP: u64 = 3_000;
/// What clients attach to sign_split: covers four inputs. The unused part is refunded.
pub const SPLIT_STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(30);
pub const MINER_STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(10);

const GAS_PER_SIGN: Gas = Gas::from_tgas(30);
const GAS_SIGN_CALLBACK: Gas = Gas::from_tgas(20);
const GAS_DERIVE: Gas = Gas::from_tgas(10);
const GAS_DERIVE_CALLBACK: Gas = Gas::from_tgas(10);

/// secp256k1 group order. ECDSA payloads must be strictly below it.
const SECP256K1_N: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Miners,
    Outpoints,
    Splits,
    Bills,
    BillsByMiner,
    BillsByHost,
    OpenBill,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Miner {
    pub cold_address: String,
    pub cold_script: Vec<u8>,
    pub fee_cap_sats: U64,
    /// Compressed derived public key (hex), set once `v1.signer` answers.
    pub payout_pubkey: Option<String>,
    pub payout_pubkey_hash: Option<Vec<u8>>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum SplitStatus {
    Requested,
    Signed,
    Failed,
    /// Signed, then released by the miner because it was never broadcast.
    Released,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Split {
    pub miner: AccountId,
    /// Unsigned txid in explorer (display) order.
    pub txid: String,
    pub inputs: Vec<InputArg>,
    pub outputs: Vec<OutputArg>,
    pub sighashes: Vec<String>,
    /// Raw `v1.signer` responses, one per input, in input order.
    pub signatures: Vec<String>,
    pub status: SplitStatus,
    /// The bill this split pays, if one was open.
    pub bill_id: Option<U64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
#[near(serializers = [borsh])]
pub struct InputArg {
    /// Previous txid as shown by explorers.
    pub txid: String,
    pub vout: u32,
    pub value: U64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
#[near(serializers = [borsh])]
pub struct OutputArg {
    pub address: String,
    pub value: U64,
}

/// Bitcoin network the payout addresses live on. Set once at init (AMD-001).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BtcNetwork {
    Mainnet,
    Testnet,
}

impl BtcNetwork {
    fn hrp(self) -> bech32::Hrp {
        match self {
            BtcNetwork::Mainnet => bech32::hrp::BC,
            BtcNetwork::Testnet => bech32::hrp::TB,
        }
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Rigbill {
    signer: AccountId,
    btc_network: BtcNetwork,
    pub(crate) miners: LookupMap<AccountId, Miner>,
    /// Outpoint key (internal txid ++ vout LE) -> split id holding it.
    outpoints: LookupMap<Vec<u8>, u64>,
    splits: LookupMap<u64, Split>,
    next_split_id: u64,
    pub(crate) bills: LookupMap<u64, bills::Bill>,
    pub(crate) bills_by_miner: LookupMap<AccountId, Vec<u64>>,
    pub(crate) bills_by_host: LookupMap<AccountId, Vec<u64>>,
    /// Miner -> the one Accepted/QuoteApproved/Paying bill, if any (BR-001).
    pub(crate) open_bill: LookupMap<AccountId, u64>,
    pub(crate) next_bill_id: u64,
}

pub(crate) fn fail(code: &str) -> ! {
    env::panic_str(code)
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

/// Display-order txid hex -> internal byte order.
fn parse_txid(s: &str) -> [u8; 32] {
    let mut b: [u8; 32] = hex_decode(s)
        .and_then(|v| v.try_into().ok())
        .unwrap_or_else(|| fail("BAD_TXID"));
    b.reverse();
    b
}

/// Segwit address on `network` -> output script. Any witness version is allowed
/// as a destination. bech32 vs bech32m is checked by the decoder.
pub fn address_to_script(addr: &str, network: BtcNetwork) -> Vec<u8> {
    let (hrp, version, program) =
        bech32::segwit::decode(addr).unwrap_or_else(|_| fail("BAD_ADDRESS"));
    if hrp != network.hrp() {
        fail("BAD_ADDRESS");
    }
    let v = version.to_u8();
    let mut script = Vec::with_capacity(program.len() + 2);
    script.push(if v == 0 { 0x00 } else { 0x50 + v });
    script.push(program.len() as u8);
    script.extend_from_slice(&program);
    script
}

/// Outpoints are reserved per miner. A coin can only be spent by the key of
/// the miner whose payout address holds it, so a reservation under another
/// miner's name can never block the real owner. Keys written before this
/// change (txid ++ vout, no prefix) are no longer read.
fn outpoint_key(miner: &AccountId, txid: &[u8; 32], vout: u32) -> Vec<u8> {
    let mut k = b"m:".to_vec();
    k.extend_from_slice(miner.as_bytes());
    k.push(b':');
    k.extend_from_slice(txid);
    k.extend_from_slice(&vout.to_le_bytes());
    k
}

/// Upper bound on the bytes one split writes: the split record, its outpoint
/// entries and the bill update. Checked against measured usage in the tests.
pub fn split_storage_bytes(inputs: usize) -> u64 {
    900 + 480 * inputs as u64
}

/// Legacy (non-witness) serialization, used only for the txid.
fn unsigned_txid(tx: &Tx) -> String {
    let mut b = Vec::new();
    b.extend_from_slice(&tx.version.to_le_bytes());
    b.push(tx.inputs.len() as u8);
    for i in &tx.inputs {
        b.extend_from_slice(&i.txid);
        b.extend_from_slice(&i.vout.to_le_bytes());
        b.push(0);
        b.extend_from_slice(&i.sequence.to_le_bytes());
    }
    b.push(tx.outputs.len() as u8);
    for o in &tx.outputs {
        b.extend_from_slice(&o.value.to_le_bytes());
        b.push(o.script_pubkey.len() as u8);
        b.extend_from_slice(&o.script_pubkey);
    }
    b.extend_from_slice(&tx.lock_time.to_le_bytes());
    let mut h = env::sha256_array(env::sha256_array(&b));
    h.reverse();
    hex_encode(&h)
}

/// Uncompressed 64-byte secp256k1 key (x ++ y) -> 33-byte compressed key.
fn compress(xy: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(33);
    out.push(if xy[63] & 1 == 0 { 0x02 } else { 0x03 });
    out.extend_from_slice(&xy[..32]);
    out
}

const MAX_RELAYERS: usize = 3;

fn relayers_key(miner: &AccountId) -> Vec<u8> {
    let mut k = b"relayers:".to_vec();
    k.extend_from_slice(miner.as_bytes());
    k
}

impl Rigbill {
    fn relayers_of(&self, miner: &AccountId) -> Vec<AccountId> {
        env::storage_read(&relayers_key(miner))
            .and_then(|v| near_sdk::borsh::from_slice(&v).ok())
            .unwrap_or_default()
    }
}

pub fn payout_path(miner: &AccountId) -> String {
    format!("miner/{miner}")
}

#[near]
impl Rigbill {
    #[init]
    pub fn new(signer: AccountId, btc_network: BtcNetwork) -> Self {
        Self {
            signer,
            btc_network,
            miners: LookupMap::new(Key::Miners),
            outpoints: LookupMap::new(Key::Outpoints),
            splits: LookupMap::new(Key::Splits),
            next_split_id: 0,
            bills: LookupMap::new(Key::Bills),
            bills_by_miner: LookupMap::new(Key::BillsByMiner),
            bills_by_host: LookupMap::new(Key::BillsByHost),
            open_bill: LookupMap::new(Key::OpenBill),
            next_bill_id: 0,
        }
    }

    /// FR-001. Registers or updates the caller's cold address and fee cap,
    /// and fetches the payout key from `v1.signer` on first registration.
    #[payable]
    pub fn register_miner(&mut self, cold_address: String, fee_cap_sats: Option<U64>) -> Promise {
        let miner_id = env::predecessor_account_id();
        let cold_script = address_to_script(&cold_address, self.btc_network);
        let fee_cap_sats = fee_cap_sats.unwrap_or(U64(DEFAULT_FEE_CAP));
        let existing = self.miners.get(&miner_id).cloned();
        if existing.is_none() && env::attached_deposit() < MINER_STORAGE_DEPOSIT {
            fail("STORAGE_DEPOSIT_REQUIRED");
        }
        let (payout_pubkey, payout_pubkey_hash) = existing
            .map(|m| (m.payout_pubkey, m.payout_pubkey_hash))
            .unwrap_or((None, None));
        self.miners.insert(
            miner_id.clone(),
            Miner {
                cold_address,
                cold_script,
                fee_cap_sats,
                payout_pubkey,
                payout_pubkey_hash,
            },
        );
        Promise::new(self.signer.clone())
            .function_call(
                "derived_public_key".to_string(),
                json!({
                    "path": payout_path(&miner_id),
                    "predecessor": env::current_account_id(),
                    "domain_id": 0,
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_DERIVE,
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_derived_key".to_string(),
                json!({ "miner": miner_id }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_DERIVE_CALLBACK,
            ))
    }

    #[private]
    pub fn on_derived_key(&mut self, miner: AccountId) -> String {
        let raw = env::promise_result_checked(0, 256).unwrap_or_else(|_| fail("DERIVE_FAILED"));
        let pk: PublicKey = serde_json::from_slice(&raw).unwrap_or_else(|_| fail("DERIVE_FAILED"));
        let bytes = pk.as_bytes();
        // Curve byte 1 = secp256k1, followed by 64 bytes x ++ y.
        if bytes.len() != 65 || bytes[0] != 1 {
            fail("DERIVE_FAILED");
        }
        let compressed = compress(&bytes[1..]);
        let pkh = env::ripemd160_array(env::sha256_array(&compressed)).to_vec();
        let m = self
            .miners
            .get_mut(&miner)
            .unwrap_or_else(|| fail("MINER_NOT_REGISTERED"));
        let hex = hex_encode(&compressed);
        m.payout_pubkey = Some(hex.clone());
        m.payout_pubkey_hash = Some(pkh);
        hex
    }

    /// FR-006 to FR-009, no-bill branch. Builds the transaction and its
    /// BIP143 sighashes from structured data and requests one MPC signature
    /// per input. There is no method that signs a caller-supplied hash.
    #[payable]
    pub fn sign_split(
        &mut self,
        miner: AccountId,
        inputs: Vec<InputArg>,
        outputs: Vec<OutputArg>,
    ) -> Promise {
        let m = self
            .miners
            .get(&miner)
            .cloned()
            .unwrap_or_else(|| fail("MINER_NOT_REGISTERED"));
        let pkh: [u8; 20] = m
            .payout_pubkey_hash
            .as_ref()
            .and_then(|v| v.as_slice().try_into().ok())
            .unwrap_or_else(|| fail("MINER_NOT_REGISTERED"));

        // Only the miner, the open bill's host, or a relayer the miner approved
        // may request signatures. Anyone else could reserve a payout's outpoint
        // with a wrong input value and freeze it.
        let caller = env::predecessor_account_id();
        let open_host = self
            .current_open_bill(&miner)
            .and_then(|id| self.bills.get(&id).map(|b| b.host.clone()));
        if caller != miner
            && open_host.as_ref() != Some(&caller)
            && !self.relayers_of(&miner).contains(&caller)
        {
            fail("NOT_AUTHORIZED");
        }

        if inputs.is_empty() || inputs.len() > MAX_INPUTS {
            fail("TOO_MANY_INPUTS");
        }
        // Storage for what this split writes, plus 1 yocto per MPC sign call.
        let storage = env::storage_byte_cost().saturating_mul(split_storage_bytes(inputs.len()) as u128);
        let needed = storage.saturating_add(NearToken::from_yoctonear(inputs.len() as u128));
        let attached = env::attached_deposit();
        if attached < needed {
            fail("STORAGE_DEPOSIT_REQUIRED");
        }
        let refund = attached.saturating_sub(needed);

        // FR-007 / BR-001. With an open bill the outputs must be exactly the
        // approved 1Click deposit (quoted amount) followed by the cold address.
        // Without one, the only output is the cold address.
        let bill_id = self.current_open_bill(&miner);
        let expected: Vec<(Vec<u8>, Option<u64>)> = match bill_id {
            Some(id) => {
                let b = self
                    .bills
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| fail("BILL_NOT_FOUND"));
                let q = match (b.status, b.quote) {
                    (bills::BillStatus::QuoteApproved, Some(q)) => q,
                    // Accepted without a quote, or a split for this bill is already in flight.
                    _ => fail("BILL_OPEN_HOST_OUTPUT_REQUIRED"),
                };
                if q.deadline_ns.0 <= env::block_timestamp() {
                    fail("QUOTE_EXPIRED");
                }
                vec![
                    (q.deposit_script, Some(q.amount_in_sats.0)),
                    (m.cold_script.clone(), None),
                ]
            }
            None => vec![(m.cold_script.clone(), None)],
        };
        let scripts: Vec<Vec<u8>> = outputs
            .iter()
            .map(|o| address_to_script(&o.address, self.btc_network))
            .collect();
        if bill_id.is_some() && !scripts.iter().any(|s| *s == expected[0].0) {
            fail("BILL_OPEN_HOST_OUTPUT_REQUIRED");
        }
        if scripts.len() != expected.len() || scripts.iter().zip(&expected).any(|(s, e)| *s != e.0)
        {
            fail("OUTPUT_NOT_ALLOWED");
        }
        let tx_outputs: Vec<TxOut> = outputs
            .iter()
            .zip(scripts)
            .zip(&expected)
            .map(|((o, script), (_, amount))| {
                if let Some(a) = amount {
                    if o.value.0 != *a {
                        fail("OUTPUT_AMOUNT_MISMATCH");
                    }
                }
                if o.value.0 < DUST_LIMIT {
                    fail("DUST_OUTPUT");
                }
                TxOut {
                    value: o.value.0,
                    script_pubkey: script,
                }
            })
            .collect();

        let total_in = inputs
            .iter()
            .try_fold(0u64, |a, i| a.checked_add(i.value.0))
            .unwrap_or_else(|| fail("BAD_AMOUNT"));
        let total_out = tx_outputs
            .iter()
            .try_fold(0u64, |a, o| a.checked_add(o.value))
            .unwrap_or_else(|| fail("BAD_AMOUNT"));
        let fee = total_in
            .checked_sub(total_out)
            .unwrap_or_else(|| fail("BAD_AMOUNT"));
        if fee > m.fee_cap_sats.0 {
            fail("FEE_OVER_CAP");
        }

        let tx_inputs: Vec<TxIn> = inputs
            .iter()
            .map(|i| TxIn {
                txid: parse_txid(&i.txid),
                vout: i.vout,
                value: i.value.0,
                sequence: TX_SEQUENCE,
            })
            .collect();

        // Reserve every outpoint, rejecting duplicates within the request too.
        let split_id = self.next_split_id;
        self.next_split_id += 1;
        for i in &tx_inputs {
            let k = outpoint_key(&miner, &i.txid, i.vout);
            if self.outpoints.contains_key(&k) {
                fail("OUTPOINT_ALREADY_SIGNED");
            }
            self.outpoints.insert(k, split_id);
        }

        let tx = Tx {
            version: TX_VERSION,
            inputs: tx_inputs,
            outputs: tx_outputs,
            lock_time: TX_LOCK_TIME,
        };
        let sighashes: Vec<[u8; 32]> = (0..tx.inputs.len())
            .map(|idx| bip143::p2wpkh_sighash(&tx, idx, &pkh))
            .collect();
        if sighashes.iter().any(|h| *h >= SECP256K1_N) {
            fail("SIGHASH_OUT_OF_RANGE");
        }
        let txid = unsigned_txid(&tx);

        self.splits.insert(
            split_id,
            Split {
                miner: miner.clone(),
                txid: txid.clone(),
                inputs,
                outputs,
                sighashes: sighashes.iter().map(|h| hex_encode(h)).collect(),
                signatures: vec![],
                status: SplitStatus::Requested,
                bill_id: bill_id.map(U64),
            },
        );
        // Mark the bill Paying now, not in the callback, so a second split for
        // the same bill can't be requested while signatures are pending.
        if let Some(id) = bill_id {
            let b = self.bill_mut(id);
            b.status = bills::BillStatus::Paying;
            b.split_id = Some(U64(split_id));
        }
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard":"rigbill","version":"1.0.0","event":"split_requested",
                   "data":[{"split_id": split_id, "miner": miner, "txid": txid}]})
        ));

        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(refund).detach();
        }

        let path = payout_path(&miner);
        let mut calls: Option<Promise> = None;
        for h in &sighashes {
            let p = Promise::new(self.signer.clone()).function_call(
                "sign".to_string(),
                json!({"request": {"path": path, "payload_v2": {"Ecdsa": hex_encode(h)}, "domain_id": 0}})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_PER_SIGN,
            );
            calls = Some(match calls {
                None => p,
                Some(c) => c.and(p),
            });
        }
        calls.unwrap().then(
            Promise::new(env::current_account_id()).function_call(
                "on_signed".to_string(),
                json!({ "split_id": U64(split_id) })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_SIGN_CALLBACK,
            ),
        )
    }

    /// Stores signatures on success. On any failure, releases every outpoint
    /// so the UTXOs can be split again.
    #[private]
    pub fn on_signed(&mut self, split_id: U64) -> SplitStatus {
        let mut split = self
            .splits
            .get(&split_id.0)
            .cloned()
            .unwrap_or_else(|| fail("SPLIT_NOT_FOUND"));
        let n = env::promise_results_count();
        let mut sigs = Vec::with_capacity(n as usize);
        let mut ok = n as usize == split.inputs.len();
        for i in 0..n {
            match env::promise_result_checked(i, 1024) {
                Ok(v) => sigs.push(String::from_utf8(v).unwrap_or_default()),
                Err(_) => ok = false,
            }
        }
        if ok {
            split.signatures = sigs;
            split.status = SplitStatus::Signed;
        } else {
            for i in &split.inputs {
                self.outpoints
                    .remove(&outpoint_key(&split.miner, &parse_txid(&i.txid), i.vout));
            }
            split.status = SplitStatus::Failed;
            // Nothing was signed, so the bill goes back to its approved quote.
            if let Some(id) = split.bill_id {
                let b = self.bill_mut(id.0);
                if b.status == bills::BillStatus::Paying && b.split_id == Some(split_id) {
                    b.status = bills::BillStatus::QuoteApproved;
                    b.split_id = None;
                }
            }
        }
        let status = split.status.clone();
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard":"rigbill","version":"1.0.0","event":"split_result",
                   "data":[{"split_id": split_id, "txid": split.txid, "status": status}]})
        ));
        self.splits.insert(split_id.0, split);
        status
    }

    /// The miner approves up to three relayers that may call `sign_split`
    /// for them. Kept outside the root struct so existing state still loads.
    pub fn set_relayers(&mut self, relayers: Vec<AccountId>) {
        let miner = env::predecessor_account_id();
        if !self.miners.contains_key(&miner) {
            fail("MINER_NOT_REGISTERED");
        }
        if relayers.len() > MAX_RELAYERS {
            fail("TOO_MANY_RELAYERS");
        }
        let key = relayers_key(&miner);
        if relayers.is_empty() {
            env::storage_remove(&key);
        } else {
            env::storage_write(&key, &near_sdk::borsh::to_vec(&relayers).unwrap());
        }
    }

    pub fn get_relayers(&self, miner: AccountId) -> Vec<AccountId> {
        self.relayers_of(&miner)
    }

    /// The miner frees the outpoints of a signed split that was never
    /// broadcast, for example one requested with a wrong input value, so
    /// the payout can be split again. An unpaid bill goes back to its quote.
    pub fn release_split(&mut self, split_id: U64) {
        let mut split = self
            .splits
            .get(&split_id.0)
            .cloned()
            .unwrap_or_else(|| fail("SPLIT_NOT_FOUND"));
        if split.miner != env::predecessor_account_id() {
            fail("NOT_MINER");
        }
        if split.status != SplitStatus::Signed {
            fail("BAD_SPLIT_STATE");
        }
        if let Some(id) = split.bill_id {
            let b = self.bill_mut(id.0);
            if b.status == bills::BillStatus::Paid {
                fail("BILL_ALREADY_PAID");
            }
            // While the quote is live the split may already be on its way to
            // 1Click. Releasing then would undo a payment the host may receive.
            let quote_live = b.quote.as_ref().is_some_and(|q| q.deadline_ns.0 > env::block_timestamp());
            if b.status == bills::BillStatus::Paying && b.split_id == Some(split_id) && quote_live {
                fail("QUOTE_STILL_LIVE");
            }
            if b.status == bills::BillStatus::Paying && b.split_id == Some(split_id) {
                b.status = bills::BillStatus::QuoteApproved;
                b.split_id = None;
            }
        }
        for i in &split.inputs {
            let k = outpoint_key(&split.miner, &parse_txid(&i.txid), i.vout);
            if self.outpoints.get(&k) == Some(&split_id.0) {
                self.outpoints.remove(&k);
            }
        }
        split.status = SplitStatus::Released;
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard":"rigbill","version":"1.0.0","event":"split_released",
                   "data":[{"split_id": split_id, "txid": split.txid}]})
        ));
        self.splits.insert(split_id.0, split);
    }

    pub fn get_miner(&self, miner: AccountId) -> Option<Miner> {
        self.miners.get(&miner).cloned()
    }

    pub fn get_split(&self, split_id: U64) -> Option<Split> {
        self.splits.get(&split_id.0).cloned()
    }

    /// Split id holding this outpoint for this miner, if any.
    pub fn get_outpoint(&self, miner: AccountId, txid: String, vout: u32) -> Option<U64> {
        self.outpoints
            .get(&outpoint_key(&miner, &parse_txid(&txid), vout))
            .map(|id| U64(*id))
    }

    pub fn get_btc_network(&self) -> BtcNetwork {
        self.btc_network
    }

    pub fn get_signer(&self) -> AccountId {
        self.signer.clone()
    }

    pub fn get_payout_path(&self, miner: AccountId) -> String {
        payout_path(&miner)
    }
}

#[cfg(test)]
mod tests;
