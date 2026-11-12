//! Bill lifecycle (FR-003, FR-004, FR-005, FR-014). See the state model in
//! the project plan: Issued -> Accepted -> QuoteApproved -> Paying -> Paid,
//! with Withdrawn (host, before acceptance) and Expired (due + grace).

use crate::{address_to_script, fail, Rigbill, RigbillExt};
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, NearToken};

pub const BILL_STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(10);
/// FR-014: an unpaid accepted bill expires this long after its due date.
pub const GRACE_PERIOD_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
pub const MAX_PERIOD_LEN: usize = 64;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BillStatus {
    Issued,
    Accepted,
    QuoteApproved,
    Paying,
    Paid,
    Expired,
    Withdrawn,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Quote {
    /// 1Click BTC deposit address the host approved.
    pub deposit_address: String,
    pub deposit_script: Vec<u8>,
    pub amount_in_sats: U64,
    pub deadline_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Bill {
    pub id: U64,
    pub host: AccountId,
    pub miner: AccountId,
    pub usd_cents: U64,
    pub period: String,
    pub due_ns: U64,
    /// Where the host receives USDC on Base (0x + 40 hex).
    pub host_address: String,
    pub status: BillStatus,
    pub ceiling_sats: Option<U64>,
    pub quote: Option<Quote>,
    pub split_id: Option<U64>,
    pub created_ns: U64,
}

impl Bill {
    fn expired_at(&self, now: u64) -> bool {
        matches!(
            self.status,
            BillStatus::Accepted | BillStatus::QuoteApproved
        ) && now > self.due_ns.0.saturating_add(GRACE_PERIOD_NS)
    }

    /// Status with lazy expiry applied, for views.
    pub fn effective_status(&self, now: u64) -> BillStatus {
        if self.expired_at(now) {
            BillStatus::Expired
        } else {
            self.status
        }
    }
}

pub fn valid_evm_address(a: &str) -> bool {
    a.len() == 42 && a.starts_with("0x") && a[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn event(name: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "rigbill", "version": "1.0.0", "event": name, "data": [data]})
    ));
}

impl Rigbill {
    pub(crate) fn bill_mut(&mut self, id: u64) -> &mut Bill {
        self.bills
            .get_mut(&id)
            .unwrap_or_else(|| fail("BILL_NOT_FOUND"))
    }

    /// Applies lazy expiry and releases the miner's open-bill lock.
    pub(crate) fn settle_expiry(&mut self, id: u64) {
        let now = env::block_timestamp();
        let (expired, miner) = {
            let b = self.bill_mut(id);
            if b.expired_at(now) {
                b.status = BillStatus::Expired;
                (true, b.miner.clone())
            } else {
                (false, b.miner.clone())
            }
        };
        if expired {
            if self.open_bill.get(&miner) == Some(&id) {
                self.open_bill.remove(&miner);
            }
            event("bill_expired", json!({"bill_id": U64(id)}));
        }
    }

    /// The miner's open bill after expiry is applied, if any.
    pub(crate) fn current_open_bill(&mut self, miner: &AccountId) -> Option<u64> {
        let id = *self.open_bill.get(miner)?;
        self.settle_expiry(id);
        self.open_bill.get(miner).copied()
    }

    fn index(map: &mut near_sdk::store::LookupMap<AccountId, Vec<u64>>, who: &AccountId, id: u64) {
        let mut v = map.get(who).cloned().unwrap_or_default();
        v.push(id);
        map.insert(who.clone(), v);
    }
}

#[near]
impl Rigbill {
    /// FR-003. Any account can issue a bill. It does nothing until the miner accepts it.
    #[payable]
    pub fn issue_bill(
        &mut self,
        miner: AccountId,
        usd_cents: U64,
        period: String,
        due_ns: U64,
        host_address: String,
    ) -> U64 {
        if env::attached_deposit() < BILL_STORAGE_DEPOSIT {
            fail("STORAGE_DEPOSIT_REQUIRED");
        }
        if self.miners.get(&miner).is_none() {
            fail("MINER_NOT_REGISTERED");
        }
        if usd_cents.0 == 0 || usd_cents.0 > 100_000_000 {
            fail("BAD_AMOUNT");
        }
        if period.is_empty() || period.len() > MAX_PERIOD_LEN {
            fail("BAD_PERIOD");
        }
        if due_ns.0 <= env::block_timestamp() {
            fail("BAD_DUE_DATE");
        }
        if !valid_evm_address(&host_address) {
            fail("BAD_ADDRESS");
        }
        let host = env::predecessor_account_id();
        let id = self.next_bill_id;
        self.next_bill_id += 1;
        self.bills.insert(
            id,
            Bill {
                id: U64(id),
                host: host.clone(),
                miner: miner.clone(),
                usd_cents,
                period,
                due_ns,
                host_address,
                status: BillStatus::Issued,
                ceiling_sats: None,
                quote: None,
                split_id: None,
                created_ns: U64(env::block_timestamp()),
            },
        );
        Self::index(&mut self.bills_by_miner, &miner, id);
        Self::index(&mut self.bills_by_host, &host, id);
        event(
            "bill_issued",
            json!({"bill_id": U64(id), "host": host, "miner": miner, "usd_cents": usd_cents}),
        );
        U64(id)
    }

    /// The host can withdraw a bill only before the miner accepts it.
    pub fn withdraw_bill(&mut self, bill_id: U64) {
        let b = self.bill_mut(bill_id.0);
        if b.host != env::predecessor_account_id() {
            fail("NOT_HOST");
        }
        if b.status != BillStatus::Issued {
            fail("BAD_BILL_STATE");
        }
        b.status = BillStatus::Withdrawn;
        event("bill_withdrawn", json!({"bill_id": bill_id}));
    }

    /// FR-004. The miner accepts with a sats ceiling, the overcharge cap
    /// (ADR-004). An accepted bill can't be cancelled by the miner.
    pub fn accept_bill(&mut self, bill_id: U64, ceiling_sats: U64) {
        let caller = env::predecessor_account_id();
        {
            let b = self.bill_mut(bill_id.0);
            if b.miner != caller {
                fail("NOT_MINER");
            }
            if b.status != BillStatus::Issued {
                fail("BAD_BILL_STATE");
            }
            if b.due_ns.0.saturating_add(GRACE_PERIOD_NS) <= env::block_timestamp() {
                fail("BAD_BILL_STATE");
            }
        }
        if ceiling_sats.0 == 0 {
            fail("BAD_AMOUNT");
        }
        if self.current_open_bill(&caller).is_some() {
            fail("BILL_ALREADY_OPEN");
        }
        let b = self.bill_mut(bill_id.0);
        b.status = BillStatus::Accepted;
        b.ceiling_sats = Some(ceiling_sats);
        self.open_bill.insert(caller, bill_id.0);
        event(
            "bill_accepted",
            json!({"bill_id": bill_id, "ceiling_sats": ceiling_sats}),
        );
    }

    /// FR-005. The host locks in one 1Click quote. A new quote may replace
    /// one whose deadline has passed.
    pub fn approve_quote(
        &mut self,
        bill_id: U64,
        deposit_address: String,
        amount_in_sats: U64,
        deadline_ns: U64,
    ) {
        self.settle_expiry(bill_id.0);
        let now = env::block_timestamp();
        let network = self.btc_network;
        let deposit_script = address_to_script(&deposit_address, network);
        let b = self.bill_mut(bill_id.0);
        if b.host != env::predecessor_account_id() {
            fail("NOT_HOST");
        }
        match (&b.status, &b.quote) {
            (BillStatus::Accepted, _) => {}
            (BillStatus::QuoteApproved, Some(q)) if q.deadline_ns.0 <= now => {}
            _ => fail("BAD_BILL_STATE"),
        }
        if deadline_ns.0 <= now {
            fail("QUOTE_EXPIRED");
        }
        if amount_in_sats.0 < crate::DUST_LIMIT {
            fail("DUST_OUTPUT");
        }
        let ceiling = b.ceiling_sats.unwrap_or_else(|| fail("BAD_BILL_STATE"));
        if amount_in_sats.0 > ceiling.0 {
            fail("QUOTE_OVER_CEILING");
        }
        b.quote = Some(Quote {
            deposit_address: deposit_address.clone(),
            deposit_script,
            amount_in_sats,
            deadline_ns,
        });
        b.status = BillStatus::QuoteApproved;
        event(
            "quote_approved",
            json!({"bill_id": bill_id, "deposit_address": deposit_address,
                   "amount_in_sats": amount_in_sats, "deadline_ns": deadline_ns}),
        );
    }

    /// Anyone can apply expiry (FR-014) so the miner's lock releases.
    pub fn expire_bill(&mut self, bill_id: U64) -> BillStatus {
        self.settle_expiry(bill_id.0);
        self.bill_mut(bill_id.0).status
    }

    pub fn get_bill(&self, bill_id: U64) -> Option<Bill> {
        let now = env::block_timestamp();
        self.bills.get(&bill_id.0).cloned().map(|mut b| {
            b.status = b.effective_status(now);
            b
        })
    }

    /// Most recent first, at most `limit` (default 20).
    pub fn get_bills_for_miner(&self, miner: AccountId, limit: Option<u32>) -> Vec<Bill> {
        self.bills_from(self.bills_by_miner.get(&miner), limit)
    }

    pub fn get_bills_for_host(&self, host: AccountId, limit: Option<u32>) -> Vec<Bill> {
        self.bills_from(self.bills_by_host.get(&host), limit)
    }

    pub fn get_open_bill(&self, miner: AccountId) -> Option<Bill> {
        let id = self.open_bill.get(&miner)?;
        self.get_bill(U64(*id))
            .filter(|b| b.status != BillStatus::Expired)
    }
}

impl Rigbill {
    fn bills_from(&self, ids: Option<&Vec<u64>>, limit: Option<u32>) -> Vec<Bill> {
        let limit = limit.unwrap_or(20).min(50) as usize;
        ids.map(|v| {
            v.iter()
                .rev()
                .take(limit)
                .filter_map(|id| self.get_bill(U64(*id)))
                .collect()
        })
        .unwrap_or_default()
    }
}
