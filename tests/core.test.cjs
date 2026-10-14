const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

const NOW = Date.parse('2026-10-14T12:00:00+08:00');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const trade = o => ({ id: o.id || C.uid(), bucket: 'swing', ticker: 'AAA', currency: 'USD', side: 'BUY', qty: 10, price: 100, fee: 0, tax: 0, fx: 32, settledAt: o.date, ...o });
function dbWith(parts = {}) {
  const db = C.emptyDb(NOW);
  Object.assign(db, parts);
  db.fx.USDTWD = { rate: 32, asOf: '2026-10-14T11:00:00+08:00', source: 'test' };
  return C.normalizeDb(db).db;
}

test('times without an offset are Taipei time, regardless of the device', () => {
  assert.equal(C.normalizeTime('2026-10-01T09:30'), '2026-10-01T09:30:00+08:00');
  assert.equal(C.normalizeTime('2026-10-01'), '2026-10-01T00:00:00+08:00');
  assert.equal(C.normalizeTime('2026-10-01T01:30:00Z'), '2026-10-01T09:30:00+08:00');
  assert.equal(C.normalizeTime('not a date'), '');
});

test('normalize keeps a bad record but excludes it from calculations', () => {
  const { db, warnings } = C.normalizeDb({ ...C.emptyDb(), trades: [{ id: 'x', date: '2026-10-01', ticker: 'AAA', side: 'BUY', qty: 'abc', price: 1, fx: 32 }] });
  assert.equal(db.trades.length, 1);
  assert.ok(db.trades[0]._invalid);
  assert.equal(warnings.length, 1);
  assert.equal(C.computePositions(db).open.length, 0);
});

test('partial sells realize proportional cost and a round trip closes at zero', () => {
  const db = dbWith({ trades: [
    trade({ id: 'b1', date: '2026-09-01T22:00', qty: 10, price: 100, fee: 1 }),
    trade({ id: 's1', date: '2026-09-05T22:00', side: 'SELL', qty: 4, price: 110, fee: 1 }),
    trade({ id: 's2', date: '2026-09-09T22:00', side: 'SELL', qty: 6, price: 90, fee: 1 })
  ] });
  const r = C.computePositions(db);
  assert.equal(r.open.length, 0);
  assert.equal(r.realized.length, 2);
  near(r.realized[0].pnlBase, 4 * 110 - 1 - 1001 * 0.4);
  near(r.realized[1].pnlBase, 6 * 90 - 1 - 1001 * 0.6);
  assert.equal(r.roundTrips.length, 1);
  near(r.roundTrips[0].realizedBase, 440 - 1 + 540 - 1 - 1001);
});

test('a whole-position broker P/L allocates only the remainder on the final sell', () => {
  const db = dbWith({ trades: [
    trade({ id: 'b', date: '2026-09-01T22:00', qty: 10 }),
    trade({ id: 's1', date: '2026-09-02T22:00', side: 'SELL', qty: 5, price: 110, brokerPnlTwd: 1500, brokerPnlScope: 'execution' }),
    trade({ id: 's2', date: '2026-09-03T22:00', side: 'SELL', qty: 5, price: 120, brokerPnlTwd: 4000, brokerPnlScope: 'position' })
  ] });
  const r = C.computePositions(db);
  near(r.realized[1].pnlTwd, 2500);
  near(r.roundTrips[0].realizedTwd, 4000);
});

test('selling more than held is reported, not silently booked', () => {
  const db = dbWith({ trades: [trade({ date: '2026-09-01T22:00', qty: 1 }), trade({ date: '2026-09-02T22:00', side: 'SELL', qty: 2 })] });
  const r = C.computePositions(db);
  assert.equal(r.issues.length, 1);
  assert.equal(r.realized.length, 0);
});

test('unrealized splits exactly into price effect plus FX effect', () => {
  const db = dbWith({ trades: [trade({ date: '2026-09-01T22:00', qty: 10, price: 100, fee: 2, fx: 31 })], quotes: { AAA: { price: 120, currency: 'USD', asOf: '2026-10-14T05:00:00+08:00' } } });
  const p = C.portfolio(db, NOW);
  const r = p.positions[0];
  near(r.costTwd, 1002 * 31);
  near(r.mktTwd, 1200 * 32);
  near(r.priceEffect + r.fxEffect, r.unrealized);
  near(r.fxEffect, 1200 * (32 - 31));
});

test('win/loss uses TWD, so FX cannot make one trade both a win and a loss', () => {
  const db = dbWith({ trades: [
    trade({ id: 'b', date: '2026-01-01T22:00', qty: 1, price: 100, fx: 33 }),
    trade({ id: 's', date: '2026-02-01T22:00', side: 'SELL', qty: 1, price: 101, fx: 32 })
  ] });
  const trips = C.computePositions(db).roundTrips;
  assert.ok(trips[0].returnPctBase > 0, 'positive in USD');
  assert.ok(trips[0].realizedTwd < 0, 'negative in TWD');
  const s = C.tradeStats(trips);
  assert.equal(s.losses, 1);
  assert.ok(s.expectancyPct < 0);
});

test('max drawdown follows the cumulative realized curve', () => {
  const mk = (d, v) => ({ realizedTwd: v, returnPct: v / 10, close: d, open: d, holdDays: 1, rMultiple: NaN });
  const s = C.tradeStats([mk('2026-01-01', 100), mk('2026-01-02', -50), mk('2026-01-03', -80), mk('2026-01-04', 200)]);
  assert.equal(s.maxDrawdown, -130);
  assert.equal(s.maxLossStreak, 2);
});

test('batch settlement back-solves one FX from the bank net amount', () => {
  const db = dbWith({ trades: [
    trade({ id: 'b0', date: '2026-10-01T22:00', ticker: 'BBB', qty: 10, price: 20, settledAt: '2026-10-02T10:00' }),
    trade({ id: 'b', date: '2026-10-09T22:00', qty: 20, price: 28, fee: 2, fx: 31.8, fxStatus: 'estimate', settledAt: null }),
    trade({ id: 's', date: '2026-10-09T22:10', ticker: 'BBB', side: 'SELL', qty: 10, price: 25, fee: 2, fx: 31.8, fxStatus: 'estimate', settledAt: null })
  ] });
  const net = 562 - 248;
  const r = C.settleBatch(db, { ids: ['b', 's'], settledAt: '2026-10-11T10:00', actualTwd: 10000, referenceFx: 32 });
  near(r.rate, 10000 / net);
  const signedTwd = r.db.trades.filter(t => ['b', 's'].includes(t.id)).reduce((s, t) => s + (t.side === 'BUY' ? 1 : -1) * t.settlementTwd, 0);
  near(signedTwd, 10000);
  assert.ok(r.db.trades.every(t => t.settledAt));
});

test('batch settlement refuses a bank amount when the net is too small to pin FX', () => {
  const db = dbWith({ trades: [
    trade({ id: 'b0', date: '2026-10-01T22:00', ticker: 'BBB', qty: 10, price: 30 }),
    trade({ id: 'b', date: '2026-10-09T22:00', qty: 100, price: 30, settledAt: null }),
    trade({ id: 's', date: '2026-10-09T22:10', ticker: 'BBB', side: 'SELL', qty: 10, price: 299, settledAt: null })
  ] });
  assert.throws(() => C.settleBatch(db, { ids: ['b', 's'], settledAt: '2026-10-11', actualTwd: 318 }), /淨額只有/);
  const r = C.settleBatch(db, { ids: ['b', 's'], settledAt: '2026-10-11', actualFx: 31.8 });
  assert.equal(r.rate, 31.8);
});

test('batch settlement warns when the implied FX is far from the reference', () => {
  const db = dbWith({ trades: [trade({ id: 'b', date: '2026-10-09T22:00', settledAt: null })] });
  const r = C.settleBatch(db, { ids: ['b'], settledAt: '2026-10-11', actualTwd: 1000 * 35, referenceFx: 32 });
  assert.equal(r.warnings.length, 1);
});

test('bank balance = last snapshot + flows after it; earlier trades are already inside the snapshot', () => {
  const db = dbWith({
    trades: [
      trade({ id: 'old', date: '2026-10-01T22:00', qty: 1, price: 100, settledAt: '2026-10-02T10:00' }),
      trade({ id: 'new', date: '2026-10-08T22:00', qty: 1, price: 100, settledAt: '2026-10-09T10:00' }),
      trade({ id: 'pend', date: '2026-10-13T22:00', qty: 1, price: 100, settledAt: null })
    ],
    bank: { snapshots: [{ id: 's', date: '2026-10-05T20:00', balance: 100000, reserved: 0 }] },
    cashEvents: [{ id: 'c', date: '2026-10-10T10:00', type: 'contribution', amountTwd: 5000, bucket: 'swing', viaBank: true }]
  });
  const b = C.bankSummary(db, NOW);
  assert.equal(b.flows.length, 2);
  near(b.expected, 100000 - 3200 + 5000);
  near(b.afterPending, 100000 - 3200 + 5000 - 3200);
  const rec = C.reconcileBank(db, 101000, '2026-10-14T12:00', NOW);
  near(rec.diff, 101000 - 101800);
});

test('Binance P/L only compares a snapshot with money that arrived before it', () => {
  const db = dbWith({
    binance: { snapshots: [{ id: 'x', date: '2026-09-19T23:00', totalTwd: 320000 }], strategies: [] },
    cashEvents: [
      { id: 'a', date: '2026-08-09', type: 'binance_in', amountTwd: 150000, bucket: 'swing', source: 'loan' },
      { id: 'b', date: '2026-09-19T20:00', type: 'binance_in', amountTwd: 100000, source: 'self' },
      { id: 'c', date: '2026-09-26', type: 'to_binance', amountTwd: 100000, bucket: 'swing', viaBank: true }
    ]
  });
  const s = C.binanceSummary(db, NOW);
  assert.equal(s.netFunding, 250000);
  assert.equal(s.pnl, 70000);
  assert.equal(s.value, 420000);
  assert.deepEqual(C.bucketCapital(db), { long: 0, swing: -250000 });
});

test('xirr matches a simple one-year case and refuses one-sided flows', () => {
  const t0 = Date.parse('2025-01-01T00:00:00Z');
  near(C.xirr([{ t: t0, amount: -1000 }, { t: t0 + 365 * 864e5, amount: 1100 }]), 0.1, 1e-6);
  assert.ok(Number.isNaN(C.xirr([{ t: t0, amount: -1000 }])));
});

test('alerts flag stale snapshots, overdrawn capital and a missing backup', () => {
  const db = dbWith({
    trades: [trade({ date: '2026-10-01T22:00', qty: 10, price: 100 })],
    quotes: { AAA: { price: 100, currency: 'USD', asOf: '2026-10-14T05:00:00+08:00' } },
    bank: { snapshots: [{ id: 's', date: '2026-09-01', balance: 1, reserved: 0 }] },
    binance: { snapshots: [{ id: 'b', date: '2026-10-13', totalTwd: 1 }], strategies: [] },
    cashEvents: [{ id: 'a', date: '2026-09-01', type: 'allocation', amountTwd: 1000, bucket: 'swing' }]
  });
  const texts = C.alerts(db, C.portfolio(db, NOW), NOW).map(a => a.text).join('\n');
  assert.match(texts, /交割戶餘額已 \d+ 天沒核對/);
  assert.match(texts, /波段資金已超用/);
  assert.match(texts, /還沒匯出過備份/);
});

test('one net-asset point per Taipei day', () => {
  let db = dbWith({ trades: [] });
  const p = { totalAssets: 100, stockMkt: 50, cash: 30, binance: { value: 20 }, netPnl: 1 };
  db = C.recordNav(db, p, NOW);
  db = C.recordNav(db, { ...p, totalAssets: 120 }, NOW + 3600e3);
  assert.equal(db.navHistory.length, 1);
  assert.equal(db.navHistory[0].totalTwd, 120);
});

test('income events add to P/L and the bank, but never to invested capital', () => {
  const db = dbWith({
    bank: { snapshots: [{ id: 's', date: '2026-10-01', balance: 1000, reserved: 0 }] },
    binance: { snapshots: [{ id: 'b', date: '2026-10-13', totalTwd: 0 }], strategies: [] },
    cashEvents: [
      { id: 'a', date: '2026-09-01', type: 'allocation', amountTwd: 1000, bucket: 'swing' },
      { id: 'i', date: '2026-10-08T03:50', type: 'income', amountTwd: 584, viaBank: true, note: '折讓' }
    ]
  });
  const p = C.portfolio(db, NOW);
  assert.equal(p.incomeTwd, 584);
  assert.equal(p.bank.expected, 1584);
  assert.equal(C.bucketCapital(db).swing, 1000);
  assert.equal(p.grossPnl, 584);
});
