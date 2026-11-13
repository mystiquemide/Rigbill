// E2E harness: real app, real testnet transactions. Only the wallet is a test double:
// it signs with the e2e account's key from ~/.near-credentials, through near-api-js.
const { chromium } = require('playwright');
const fs = require('fs');
const { createRequire } = require('module');
const path = require('path');
const os = require('os');
const rq = createRequire(path.join(__dirname, '../relayer/package.json'));
const OUT = path.join(__dirname, 'out') + '/';
fs.mkdirSync(OUT, { recursive: true });
const KEYS = path.join(os.homedir(), '.near-credentials/testnet');

async function nearSign(accountId, receiverId, actions) {
  const { Account, JsonRpcProvider, actions: A } = await import(rq.resolve('near-api-js'));
  const key = JSON.parse(fs.readFileSync(path.join(KEYS, `${accountId}.json`))).private_key;
  const acct = new Account(accountId, new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' }), key);
  const acts = actions.map((a) => {
    if (a.type !== 'FunctionCall') throw new Error('test wallet only signs FunctionCall');
    return A.functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit));
  });
  const res = await acct.signAndSendTransaction({ receiverId, actions: acts, waitUntil: 'FINAL', throwOnFailure: false });
  return JSON.parse(JSON.stringify(res, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

async function rolePage(browser, accountId, log) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`[${accountId}] PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && log.push(`[${accountId}] console ${m.text().slice(0, 200)}`));
  await page.exposeFunction('e2eSign', (receiverId, actions) => nearSign(accountId, receiverId, actions));
  await page.addInitScript((acct) => {
    const manifest = {
      id: 'e2e-test-wallet', platform: ['web'], name: 'E2E Test Wallet', icon: '', description: 'test only',
      website: '', version: '1.0.0', executor: '', type: 'injected', permissions: {},
      features: { signMessage: false, signTransaction: false, signAndSendTransaction: true, signAndSendTransactions: false,
        signInWithoutAddKey: true, signInAndSignMessage: false, signInWithFunctionCallKey: false, signDelegateActions: false,
        mainnet: false, testnet: true },
    };
    let signedIn = localStorage.getItem('e2e-signed-in') === '1';
    const wallet = {
      manifest,
      signIn: async () => { signedIn = true; localStorage.setItem('e2e-signed-in', '1'); return [{ accountId: acct, publicKey: '' }]; },
      signOut: async () => { signedIn = false; localStorage.removeItem('e2e-signed-in'); },
      getAccounts: async () => (signedIn ? [{ accountId: acct, publicKey: '' }] : []),
      signAndSendTransaction: async ({ receiverId, actions }) => window.e2eSign(receiverId, actions),
    };
    const announce = () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet }));
    window.addEventListener('near-selector-ready', announce);
  }, accountId);
  return { ctx, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function text(page) { return (await page.innerText('body')).replace(/\n+/g, ' | '); }

module.exports = { rolePage, sleep, text, OUT, KEYS };
