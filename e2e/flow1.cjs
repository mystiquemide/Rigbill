const { chromium } = require('playwright');
const { rolePage, sleep, text, OUT } = require('./harness.cjs');
const fs = require('fs');
const need = (k) => process.env[k] || (console.error(`Set ${k}`), process.exit(2));
const MINER = need('E2E_MINER'), HOST = need('E2E_HOST');
const COLD = need('E2E_COLD'), STANDIN = need('E2E_STANDIN');
const APP = process.env.E2E_APP || 'http://localhost:4173/';
const BASE = '0x3333333333333333333333333333333333333333';
const step = (s) => console.log(`\n=== ${s}`);
async function signIn(p, hash) {
  await p.goto(APP + hash, { waitUntil: 'load' });
  await p.getByRole('button', { name: /^Sign in with NEAR/ }).first().click();
  await sleep(1500);
  await p.getByText('E2E Test Wallet').first().click();
  await p.waitForSelector('text=Sign out', { timeout: 20000 });
}
async function waitFor(p, re, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (re.test(await text(p))) return true; await sleep(1500); }
  throw new Error(`timeout waiting for ${re}`);
}
(async () => {
  const b = await chromium.launch(); const log = [];
  const { page: m } = await rolePage(b, MINER, log);
  const { page: h } = await rolePage(b, HOST, log);

  step('A. miner signs in and registers');
  await signIn(m, 'miner');
  await m.getByLabel('Cold wallet address').fill(COLD);
  await m.getByRole('button', { name: 'Register' }).click();
  await waitFor(m, /Your payout address/);
  const payout = (await m.locator('.addr .mono').innerText()).trim();
  console.log('payout address shown:', payout);
  await m.screenshot({ path: OUT + 'A-miner-registered.png', fullPage: true });

  step('B. host signs in and issues a $6 bill');
  await signIn(h, 'host');
  await h.getByLabel("Miner's NEAR account").fill(MINER);
  await h.getByLabel('Amount (USD)').fill('6.00');
  await h.getByLabel('Your Base address for USDC').fill(BASE);
  await h.getByRole('button', { name: 'Issue bill' }).click();
  await waitFor(h, new RegExp(`to ${MINER.replace(/\./g, '\\.')}`));
  await h.screenshot({ path: OUT + 'B-host-issued.png', fullPage: true });

  step('C. miner accepts with the pre-filled ceiling');
  await m.reload({ waitUntil: 'load' });
  await waitFor(m, /Review and accept/);
  await m.locator('a.hist-row', { hasText: 'Review and accept' }).first().click();
  await waitFor(m, /Accept bill/);
  const ceiling = await m.getByLabel("Most sats you'll allow for this bill").inputValue();
  console.log('pre-filled ceiling:', ceiling);
  await m.getByRole('button', { name: 'Accept bill' }).click();
  await waitFor(m, /You accepted this bill/);
  await m.screenshot({ path: OUT + 'C-miner-accepted.png', fullPage: true });

  step('D. host gets a quote and approves it (testnet stand-in deposit)');
  await h.reload({ waitUntil: 'load' });
  await waitFor(h, /Lock a quote/);
  await h.locator('a.host-row', { hasText: 'Lock a quote' }).first().click();
  await waitFor(h, /Get a live quote/);
  await h.getByRole('button', { name: 'Get a live quote' }).click();
  await waitFor(h, /Stand-in deposit address/);
  await h.getByLabel('Stand-in deposit address (testnet)').fill(STANDIN);
  await h.getByRole('button', { name: 'Lock this quote' }).click();
  await waitFor(h, /The miner's next payout sends exactly this/);
  await h.screenshot({ path: OUT + 'D-host-quote.png', fullPage: true });

  fs.writeFileSync(OUT + 'state.json', JSON.stringify({ MINER, HOST, payout, COLD, STANDIN }, null, 2));
  console.log('\nLOG', log);
  await b.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
