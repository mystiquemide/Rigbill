const { chromium } = require('playwright');
const { rolePage, sleep, text, OUT, KEYS } = require('./harness.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');
const S = JSON.parse(fs.readFileSync(OUT + 'state.json'));
const APP = process.env.E2E_APP || 'http://localhost:4173/';
const path = require('path');
const step = (s) => console.log(`\n=== ${s}`);
async function signIn(p, hash) {
  await p.goto(APP + hash, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^Sign in with NEAR/ }).first().click();
  await sleep(1500);
  await p.getByText('E2E Test Wallet').first().click();
  await p.waitForSelector('text=Sign out', { timeout: 20000 });
}
async function waitFor(p, re, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (re.test(await text(p))) return true; await sleep(2000); }
  throw new Error(`timeout waiting for ${re}`);
}
(async () => {
  const b = await chromium.launch(); const log = [];
  const { page: m } = await rolePage(b, S.MINER, log);
  const { page: h } = await rolePage(b, S.HOST, log);

  step('E. miner tries to sweep everything to cold while the bill is open');
  await signIn(m, '#miner');
  await waitFor(m, /Sweep [\d,]+ sats to cold/);
  await m.getByRole('button', { name: /Sweep [\d,]+ sats to cold/ }).click();
  await waitFor(m, /BILL_OPEN_HOST_OUTPUT_REQUIRED/);
  const refusal = await m.locator('.err').filter({ hasText: 'BILL_OPEN' }).innerText();
  const link = await m.locator('.err a').first().getAttribute('href');
  console.log('UI shows:', refusal.replace(/\s+/g, ' '));
  console.log('refusal tx:', link);
  await m.screenshot({ path: OUT + 'E-miner-sweep-refused.png', fullPage: true });

  step('F. relayer pays the bill from the payout');
  const out = execFileSync('npm', ['run', '-s', 'relayer', '--', 'split', S.MINER, '--fee-rate', '2'], {
    cwd: path.join(__dirname, '../relayer'), encoding: 'utf8', timeout: 280000,
    env: { ...process.env, NETWORK: 'testnet', RELAYER_ACCOUNT_ID: process.env.E2E_RELAYER || S.MINER,
      RELAYER_PRIVATE_KEY: JSON.parse(fs.readFileSync(path.join(KEYS, `${process.env.E2E_RELAYER || S.MINER}.json`))).private_key, RIGBILL_CONTRACT: '', MPC_SIGNER: '', NEAR_RPC_URL: '', ESPLORA_URL: '' },
  });
  console.log(out.split('\n').filter((l) => /NEAR tx|"txid"|hostValue|coldValue|deposit"|Testnet/.test(l)).join('\n'));

  step('G. host sees Paying, confirms paid; miner sees Paid');
  await signIn(h, '#host');
  await h.getByRole('tab', { name: 'I host miners' }).click();
  await waitFor(h, /Confirm paid/);
  await h.getByRole('button', { name: 'Confirm paid' }).click();
  await waitFor(h, /\| Paid \|/);
  await h.screenshot({ path: OUT + 'G-host-paid.png', fullPage: true });
  await m.reload({ waitUntil: 'networkidle' });
  await waitFor(m, /\| Paid \|/);
  await sleep(3000);
  await m.screenshot({ path: OUT + 'G-miner-paid.png', fullPage: true });
  console.log('miner view:', (await text(m)).match(/\$6\.00[^]*?Refresh status/)?.[0]);
  console.log('\nLOG', log);
  await b.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
