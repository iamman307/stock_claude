const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const M = require('../js/migrate.js');
const S = require('../js/storage.js');
const Market = require('../js/market.js');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    data
  };
}

test('an unreadable database opens in recovery mode and is never overwritten', () => {
  const mem = memoryStorage({ [S.KEYS.db]: '{"schema":"stock-claude","trades":' });
  const store = S.createStore(mem);
  const r = store.load();
  assert.equal(r.mode, 'recovery');
  assert.throws(() => store.save(C.emptyDb()), /救援模式/);
  assert.equal(mem.data[S.KEYS.db], '{"schema":"stock-claude","trades":');
  assert.equal(mem.data[S.KEYS.rescue], '{"schema":"stock-claude","trades":');
});

test('every edit keeps the previous version; quiet saves do not', () => {
  const mem = memoryStorage();
  const store = S.createStore(mem);
  let db = store.load().db;
  db = store.save({ ...db, reserve: { loanPayment: 1, emergency: 0 } }, 'first');
  db = store.save({ ...db, reserve: { loanPayment: 2, emergency: 0 } }, 'second');
  db = store.save({ ...db, navHistory: [{ date: '2026-10-14', totalTwd: 1 }] }, 'nav', { quiet: true });
  const history = store.readHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].reason, 'second');
  const restored = store.restore(0);
  assert.equal(restored.reserve.loanPayment, 1);
});

test('a failed write is reported instead of swallowed', () => {
  const mem = memoryStorage();
  mem.setItem = () => { const e = Error('full'); e.name = 'QuotaExceededError'; throw e; };
  const store = S.createStore(mem);
  assert.throws(() => store.save(C.emptyDb()), /儲存空間不足/);
});

function legacyBackup() {
  return {
    transactions: [
      { id: 't1', date: '2026-09-01T22:00:00', account: '長期', ticker: 'AAA', asset: '美股', side: 'BUY', qty: 2, price: 100, fee: 1, tax: 0, fx: 32, currency: 'USD', stop: null },
      { id: 't2', date: '2026-10-06T22:00:00', account: '波段', ticker: 'BBB', asset: '美股', side: 'BUY', qty: 1, price: 50, fee: 0, tax: 0, fx: 32, currency: 'USD', fxStatus: 'final', settledAt: '2026-10-12T11:34', settlementTwd: 1600 },
      { id: 't3', date: '2026-10-13T22:00', account: '波段', ticker: 'CCC', asset: '美股', side: 'BUY', qty: 1, price: 10, fee: 0, tax: 0, fx: 32, currency: 'USD', fxStatus: 'estimate' },
      { id: 't4', date: '2026-09-02T09:30:00', account: '波段', ticker: '2330', name: '台積電', asset: '台股', side: 'BUY', qty: 1000, price: 100, fee: 142, tax: 0, fx: 1, currency: 'TWD' }
    ],
    manualTrades: [{ id: 'm1', ticker: 'BTCUSDT-GRID', direction: 'LONG', strategyMode: 'NEUTRAL', open: '2026-09-01T00:00', close: '2026-09-03T00:00', entry: 100, exit: 105, qty: 1, pnl: 5, currency: 'USDT', returnPct: 5, marginUsdt: 100 }],
    externalHoldings: [
      { id: 'btc', ticker: 'BTC', venue: 'Binance', asOf: '2026-10-01T00:00:00Z', currency: 'USDT', qty: 0.01, currentPrice: 100000, fx: 32, legacy: true, source: 'self', baselineMarketValueTwd: 30000 },
      { id: 'usdt', ticker: 'USDT', venue: 'Binance', asOf: '2026-09-19T23:00', currency: 'USDT', qty: 100, currentPrice: 1, fx: 32, source: 'mixed', fundingHistory: [{ date: '2026-08-01T00:00', amountUsdt: 10, source: 'self' }, { date: '2026-08-09T00:00', amountUsdt: 3000, source: 'loan', originalTwd: 100000 }] }
    ],
    cash: {},
    quotes: { AAA: { price: 120, fx: 32, updated: '2026-10-14T04:00:00Z', currency: 'USD', source: 'Finnhub' }, 2330: { price: 110, fx: 1, updated: '2026-10-14T05:00:00Z' } },
    meta: {
      appVersion: '1.2.0', currentUsdTwd: 32, exportedAt: '2026-10-14T04:40:00Z',
      cryptoSnapshot: { asOf: '2026-09-19T23:28', totalValueTwd: 140000 },
      fundPlan: { longTerm: 500000, swing: 310000, loan: 50000, reserve: 100000 },
      capitalTracking: { enabled: true, resetDate: '2026-09-01', openingLoan: 600000, openingSelf: 10000, openingFamily: 0, loanGross: 600000, loanFee: 500, principalRepaid: 1000, interestPaid: 2000, cashAdjustmentTwd: 1234, events: [] },
      securitiesCash: {
        enabled: true, asOf: '2026-10-07T23:01', accountBalanceTwd: 200000, reservedTwd: 0,
        externalTransfers: [{ id: 'x1', date: '2026-09-26T10:00:00Z', amountTwd: 50000, destination: 'Binance' }],
        investmentContributions: [{ id: 'c1', date: '2026-10-07T22:45', amountTwd: 10000, account: '波段' }],
        pendingSettlements: [{ id: 'settlement-t3', transactionId: 't3', date: '2026-10-13T22:00', currency: 'USD', amount: -10, fx: 32 }]
      }
    }
  };
}

test('legacy backups migrate with every assumption reported', () => {
  const { db, report } = M.fromLegacy(legacyBackup(), Date.parse('2026-10-14T12:00:00+08:00'));
  assert.equal(db.trades.length, 4);
  assert.equal(db.trades.find(t => t.id === 't1').bucket, 'long');
  assert.equal(db.trades.find(t => t.id === 't4').currency, 'TWD');
  assert.equal(db.trades.find(t => t.id === 't3').settledAt, null, 'estimate stays pending');
  assert.equal(db.trades.find(t => t.id === 't2').settledAt, '2026-10-06T22:00:00+08:00', 'old button-press time is not a bank date');
  assert.equal(db.quotes['2330'].currency, 'TWD');
  assert.ok(report.notes.some(n => n.includes('既有資產')));
  const cap = C.bucketCapital(db);
  assert.equal(cap.long, 500000);
  assert.equal(cap.swing, 310000 - 50000 - 100000);
  const bn = C.binanceSummary(db, Date.parse('2026-10-14T12:00:00+08:00'));
  assert.equal(bn.netFunding, 100000 + 320 + 30000);
  assert.equal(bn.laterFunding, 50000);
  assert.equal(db.loan.fee + db.loan.interestPaid, 2500);
  assert.equal(db.binance.strategies[0].pnlUsdt, 5);
  assert.ok(db.meta.legacy.fundPlan);
});

test('migrated stock numbers equal a direct calculation', () => {
  const { db } = M.fromLegacy(legacyBackup());
  const p = C.portfolio(db, Date.parse('2026-10-14T12:00:00+08:00'));
  const aaa = p.positions.find(r => r.ticker === 'AAA');
  assert.equal(aaa.costTwd, 201 * 32);
  assert.equal(aaa.mktTwd, 2 * 120 * 32);
});

test('quotes: Finnhub payload checks and FX source fallback', async () => {
  assert.throws(() => Market.parseFinnhub({ c: 0, t: 0 }), /沒有可用/);
  const ok = Market.parseFinnhub({ c: 10, t: Math.floor(Date.now() / 1000) - 60 });
  assert.equal(ok.price, 10);
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url.includes('er-api')) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ date: '2026-10-14', usd: { twd: 31.9234 } }) };
  };
  const fx = await Market.usdTwd(fetcher);
  assert.equal(fx.rate, 31.9234);
  assert.equal(calls.length, 2);
});

test('Finnhub requests carry the key as a query parameter (custom headers fail CORS)', async () => {
  let seen;
  const fetcher = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ c: 10, t: Math.floor(Date.now() / 1000) }) }; };
  await Market.finnhubQuote('BRK.B', 'abc 123', fetcher);
  assert.match(seen.url, /symbol=BRK\.B&token=abc%20123$/);
  assert.equal(seen.opts.headers, undefined);
});
