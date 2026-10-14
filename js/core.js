/*
 * Stock Claude — calculation engine.
 * Pure functions only: no DOM, no storage, no network. Runs in the browser
 * (window.Core) and in Node for tests (module.exports).
 *
 * Money model
 * - Trades are the source of truth for positions, cost and realized P/L.
 * - Cash events record every movement of money (allocation, contribution,
 *   transfers to/from Binance, bank adjustments).
 * - Bank and Binance snapshots are anchors used to CHECK the computed numbers.
 *   They never overwrite the event history.
 */
(function (root) {
  'use strict';

  const SCHEMA = 'stock-claude';
  const SCHEMA_VERSION = 1;
  const TZ_OFFSET = '+08:00';
  const DAY = 864e5;
  const BUCKETS = ['long', 'swing'];
  const BUCKET_LABEL = { long: '長期', swing: '波段' };
  const SOURCES = ['loan', 'self', 'family', 'other'];
  const SOURCE_LABEL = { loan: '信貸', self: '自有', family: '家人', other: '其他' };
  const EVENT_TYPES = ['allocation', 'contribution', 'withdrawal', 'to_binance', 'binance_in', 'from_binance', 'bank_adjust', 'income'];
  const EVENT_LABEL = {
    allocation: '配置本金', contribution: '新增投入', withdrawal: '提領',
    to_binance: '交割戶轉入幣安', binance_in: '直接入金幣安', from_binance: '幣安出金',
    bank_adjust: '交割戶對帳調整', income: '股利／折讓／利息'
  };
  const SMALL_NET_USD = 300;          // below this, a bank net amount cannot pin the FX rate
  const FX_DEVIATION_WARN = 0.02;     // implied FX more than 2% from the reference rate

  /* ---------- small helpers ---------- */
  const isNum = x => typeof x === 'number' && Number.isFinite(x);
  const num = (x, fallback = NaN) => {
    if (x === null || x === undefined || x === '') return fallback;
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
  };
  const sum = (arr, f = x => x) => arr.reduce((s, x) => s + f(x), 0);
  const clone = x => JSON.parse(JSON.stringify(x));
  const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));

  /* ---------- time: every stored timestamp carries an offset ---------- */
  // Strings without an offset are Taipei local time, never device local time.
  function normalizeTime(value) {
    if (value === null || value === undefined || value === '') return '';
    let s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += TZ_OFFSET;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return '';
    return toTaipeiIso(t);
  }
  function toTaipeiIso(ms) {
    const d = new Date(ms + 8 * 36e5);
    return d.toISOString().slice(0, 19) + TZ_OFFSET;
  }
  const time = s => { const t = Date.parse(normalizeTime(s)); return Number.isFinite(t) ? t : NaN; };
  const taipeiDate = ms => toTaipeiIso(ms).slice(0, 10);
  const nowIso = (now = Date.now()) => toTaipeiIso(now);

  /* ---------- empty database ---------- */
  function emptyDb(now = Date.now()) {
    return {
      schema: SCHEMA, version: SCHEMA_VERSION,
      trades: [], quotes: {}, cashEvents: [],
      fx: { USDTWD: { rate: null, asOf: '', source: '' } },
      bank: { snapshots: [] },
      binance: { snapshots: [], strategies: [] },
      loan: { principal: 0, fee: 0, apr: null, startDate: '', principalRepaid: 0, interestPaid: 0 },
      sources: { asOf: '', loan: 0, self: 0, family: 0 },
      reserve: { loanPayment: 0, emergency: 0 },
      navHistory: [],
      settings: { upColor: 'red', backupReminderDays: 7 },
      meta: { createdAt: nowIso(now), updatedAt: nowIso(now), lastExportAt: '', migratedFrom: null, legacy: null }
    };
  }

  /* ---------- normalization: lenient, never drops data ---------- */
  // Bad records are flagged (_invalid) and excluded from calculations, but kept,
  // so a stricter rule can never silently erase someone's history.
  function normalizeDb(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('資料不是有效的物件');
    if (raw.schema !== SCHEMA) throw Error('不是 Stock Claude 的資料格式');
    const base = emptyDb();
    const db = { ...base, ...clone(raw) };
    const warnings = [];
    const obj = (x, d) => (x && typeof x === 'object' && !Array.isArray(x) ? x : d);
    const arr = x => (Array.isArray(x) ? x : []);

    db.trades = arr(db.trades).map((t, i) => normalizeTrade(t, i, warnings));
    db.cashEvents = arr(db.cashEvents).map((e, i) => normalizeEvent(e, i, warnings));
    db.quotes = obj(db.quotes, {});
    for (const [k, q] of Object.entries(db.quotes)) {
      if (!q || !(num(q.price) > 0)) { warnings.push(`報價 ${k} 格式錯誤，已略過`); delete db.quotes[k]; continue; }
      db.quotes[k] = { price: num(q.price), currency: q.currency === 'TWD' ? 'TWD' : 'USD', asOf: normalizeTime(q.asOf), source: String(q.source || '') };
    }
    db.fx = obj(db.fx, base.fx);
    const fx = obj(db.fx.USDTWD, {});
    db.fx.USDTWD = { rate: num(fx.rate) > 0 ? num(fx.rate) : null, asOf: normalizeTime(fx.asOf), source: String(fx.source || '') };
    db.bank = obj(db.bank, base.bank);
    db.bank.snapshots = arr(db.bank.snapshots).map(s => ({
      id: String(s.id || uid()), date: normalizeTime(s.date), balance: num(s.balance, 0), reserved: num(s.reserved, 0), note: String(s.note || '')
    })).filter(s => s.date);
    db.binance = obj(db.binance, base.binance);
    db.binance.snapshots = arr(db.binance.snapshots).map(s => ({
      id: String(s.id || uid()), date: normalizeTime(s.date), totalTwd: num(s.totalTwd, 0), note: String(s.note || '')
    })).filter(s => s.date);
    db.binance.strategies = arr(db.binance.strategies).map(s => ({ ...s, id: String(s.id || uid()), open: normalizeTime(s.open), close: normalizeTime(s.close), pnlUsdt: num(s.pnlUsdt, 0), returnPct: num(s.returnPct), marginUsdt: num(s.marginUsdt) }));
    db.loan = { ...base.loan, ...obj(db.loan, {}) };
    for (const k of ['principal', 'fee', 'principalRepaid', 'interestPaid']) db.loan[k] = num(db.loan[k], 0);
    db.loan.apr = num(db.loan.apr) > 0 ? num(db.loan.apr) : null;
    db.sources = { ...base.sources, ...obj(db.sources, {}) };
    db.reserve = { ...base.reserve, ...obj(db.reserve, {}) };
    db.navHistory = arr(db.navHistory).filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && num(p.totalTwd) >= 0);
    db.settings = { ...base.settings, ...obj(db.settings, {}) };
    db.meta = { ...base.meta, ...obj(db.meta, {}) };
    db.version = SCHEMA_VERSION;
    return { db, warnings };
  }

  function normalizeTrade(raw, i, warnings) {
    const t = { ...raw };
    const label = `交易 ${i + 1}${t.ticker ? '（' + t.ticker + '）' : ''}`;
    t.id = String(t.id || uid());
    t.date = normalizeTime(t.date);
    t.ticker = String(t.ticker || '').trim().toUpperCase();
    t.bucket = BUCKETS.includes(t.bucket) ? t.bucket : 'swing';
    t.currency = t.currency === 'TWD' ? 'TWD' : 'USD';
    t.market = t.currency === 'TWD' ? 'TW' : 'US';
    t.side = String(t.side || '').toUpperCase();
    for (const k of ['qty', 'price', 'fx']) t[k] = num(t[k]);
    if (t.currency === 'TWD') t.fx = 1;
    t.fee = num(t.fee, 0); t.tax = num(t.tax, 0);
    for (const k of ['stop', 'settlementTwd', 'brokerPnlBase', 'brokerPnlTwd', 'tradeReturnPct', 'originalRiskBase']) t[k] = num(t[k], null);
    t.settledAt = t.settledAt ? normalizeTime(t.settledAt) : null;
    t.fxStatus = t.fxStatus === 'estimate' ? 'estimate' : 'final';
    t.name = String(t.name || ''); t.note = String(t.note || ''); t.exitReason = String(t.exitReason || '');
    const problems = [];
    if (!t.date) problems.push('日期');
    if (!t.ticker) problems.push('代號');
    if (!['BUY', 'SELL', 'INIT'].includes(t.side)) problems.push('買賣別');
    if (!(t.qty > 0)) problems.push('數量');
    if (!(t.price > 0)) problems.push('價格');
    if (!(t.fx > 0)) problems.push('匯率');
    if (t.fee < 0 || t.tax < 0) problems.push('費用');
    if (problems.length) { t._invalid = problems.join('、'); warnings.push(`${label} 的${t._invalid}有誤，暫不計入`); }
    else delete t._invalid;
    return t;
  }

  function normalizeEvent(raw, i, warnings) {
    const e = { ...raw };
    e.id = String(e.id || uid());
    e.date = normalizeTime(e.date);
    e.type = EVENT_TYPES.includes(e.type) ? e.type : '';
    e.amountTwd = num(e.amountTwd);
    e.bucket = BUCKETS.includes(e.bucket) ? e.bucket : null;
    e.source = SOURCES.includes(e.source) ? e.source : null;
    e.viaBank = Boolean(e.viaBank);
    e.estimated = Boolean(e.estimated);
    e.note = String(e.note || '');
    const ok = e.date && e.type && isNum(e.amountTwd) && (e.type === 'bank_adjust' ? e.amountTwd !== 0 : e.amountTwd > 0);
    if (!ok) { e._invalid = '資料不完整'; warnings.push(`資金事件 ${i + 1} 資料不完整，暫不計入`); }
    else delete e._invalid;
    return e;
  }

  const validTrades = db => db.trades.filter(t => !t._invalid);
  const validEvents = db => db.cashEvents.filter(e => !e._invalid);

  /* ---------- trade amounts ---------- */
  const tradeFees = t => (t.fee || 0) + (t.tax || 0);
  // Amount in the trade currency that moves through the bank: buys pay fees on top,
  // sells receive proceeds net of fees.
  function tradeBaseAmount(t) {
    const gross = t.qty * t.price;
    return t.side === 'SELL' ? gross - tradeFees(t) : gross + tradeFees(t);
  }
  function tradeTwd(t) {
    if (isNum(t.settlementTwd)) return Math.abs(t.settlementTwd);
    return tradeBaseAmount(t) * t.fx;
  }
  // Signed bank effect: buys take money out, sells bring it in. INIT never touches the bank.
  const tradeBankTwd = t => (t.side === 'SELL' ? 1 : t.side === 'BUY' ? -1 : 0) * tradeTwd(t);
  const isPending = t => t.side !== 'INIT' && !t.settledAt;

  /* ---------- positions, realized P/L and round trips ---------- */
  function computePositions(db) {
    const positions = new Map();
    const active = new Map();
    const realized = [];
    const roundTrips = [];
    const issues = [];
    const trades = validTrades(db).map((t, i) => ({ t, i }))
      .sort((a, b) => time(a.t.date) - time(b.t.date) || a.i - b.i).map(x => x.t);

    for (const t of trades) {
      const key = [t.bucket, t.ticker, t.currency].join('|');
      if (!positions.has(key)) positions.set(key, { bucket: t.bucket, ticker: t.ticker, name: t.name, currency: t.currency, market: t.market, qty: 0, costBase: 0, costTwd: 0, opened: '' });
      const p = positions.get(key);
      if (t.name) p.name = t.name;
      if (t.side === 'BUY' || t.side === 'INIT') {
        const base = t.qty * t.price + tradeFees(t);
        const twd = tradeTwd(t);
        if (!(p.qty > 1e-9)) {
          p.opened = t.date;
          active.set(key, { bucket: t.bucket, ticker: t.ticker, name: p.name, currency: t.currency, open: t.date, buyBase: 0, buyTwd: 0, realizedBase: 0, realizedTwd: 0, riskBase: 0, riskKnown: true, fromInit: t.side === 'INIT', exitReason: '' });
        }
        const r = active.get(key);
        r.buyBase += base; r.buyTwd += twd;
        if (isNum(t.stop) && t.stop >= 0 && t.stop < t.price) r.riskBase += (t.price - t.stop) * t.qty + tradeFees(t);
        else r.riskKnown = false;
        p.qty += t.qty; p.costBase += base; p.costTwd += twd;
      } else if (t.side === 'SELL') {
        if (t.qty > p.qty + 1e-9) { issues.push(`${t.ticker} ${t.date.slice(0, 10)} 賣出 ${t.qty} 股，但當時只持有 ${round(p.qty, 4)} 股，這筆未計入損益`); continue; }
        const share = t.qty / p.qty;
        const costBase = p.costBase * share, costTwd = p.costTwd * share;
        const calcBase = t.qty * t.price - tradeFees(t) - costBase;
        const calcTwd = tradeTwd(t) - costTwd;
        const r = active.get(key);
        const whole = t.brokerPnlScope === 'position';
        if (whole && Math.abs(p.qty - t.qty) > 1e-8) { issues.push(`${t.ticker}：整輪券商損益只能填在最後一筆平倉`); continue; }
        // A whole-position broker total settles the round trip once; earlier partial
        // sells already booked their share, so only the remainder is allocated here.
        const pnlBase = isNum(t.brokerPnlBase) ? t.brokerPnlBase - (whole ? r.realizedBase : 0) : calcBase;
        const pnlTwd = isNum(t.brokerPnlTwd) ? t.brokerPnlTwd - (whole ? r.realizedTwd : 0) : calcTwd;
        realized.push({ id: t.id, date: t.date, bucket: t.bucket, ticker: t.ticker, currency: t.currency, qty: t.qty, pnlBase, pnlTwd, costTwd });
        p.qty -= t.qty; p.costBase -= costBase; p.costTwd -= costTwd;
        r.realizedBase += pnlBase; r.realizedTwd += pnlTwd;
        if (t.exitReason) r.exitReason = t.exitReason;
        if (Math.abs(p.qty) < 1e-8) {
          p.qty = 0; p.costBase = 0; p.costTwd = 0;
          const risk = isNum(t.originalRiskBase) && t.originalRiskBase > 0 ? t.originalRiskBase : (r.riskKnown ? r.riskBase : 0);
          roundTrips.push({
            ...r, close: t.date,
            holdDays: (time(t.date) - time(r.open)) / DAY,
            returnPct: r.buyTwd > 0 ? r.realizedTwd / r.buyTwd * 100 : NaN,
            returnPctBase: r.buyBase > 0 ? r.realizedBase / r.buyBase * 100 : NaN,
            riskBase: risk, rMultiple: risk > 0 ? r.realizedBase / risk : NaN
          });
          active.delete(key);
        }
      }
    }
    const open = [...positions.values()].filter(p => p.qty > 1e-9);
    return { open, realized, roundTrips, issues };
  }

  /* ---------- valuation with price / FX split ---------- */
  function fxRate(db) { const r = db.fx && db.fx.USDTWD && db.fx.USDTWD.rate; return num(r) > 0 ? num(r) : NaN; }

  function valuePositions(db, open) {
    const usdTwd = fxRate(db);
    return open.map(p => {
      const q = db.quotes[p.ticker];
      const rate = p.currency === 'TWD' ? 1 : usdTwd;
      const price = q && q.price > 0 ? q.price : NaN;
      const mktBase = p.qty * price;
      const mktTwd = mktBase * rate;
      const avgFx = p.costBase > 0 ? p.costTwd / p.costBase : NaN;
      // unrealized = price effect (at the average cost FX) + FX effect (on current value)
      const priceEffect = (mktBase - p.costBase) * (p.currency === 'TWD' ? 1 : avgFx);
      const fxEffect = p.currency === 'TWD' ? 0 : mktBase * (rate - avgFx);
      const unrealized = mktTwd - p.costTwd;
      return {
        ...p, price, quoteAsOf: q ? q.asOf : '', quoteSource: q ? q.source : '',
        avgPrice: p.costBase / p.qty, avgFx, mktBase, mktTwd, unrealized,
        unrealizedPct: p.costTwd > 0 ? unrealized / p.costTwd * 100 : NaN,
        priceEffect, fxEffect, priced: isNum(mktTwd)
      };
    });
  }

  /* ---------- capital buckets ---------- */
  function bucketCapital(db) {
    const cap = { long: 0, swing: 0 };
    for (const e of validEvents(db)) {
      if (!e.bucket) continue;
      const sign = { allocation: 1, contribution: 1, withdrawal: -1, to_binance: -1, binance_in: -1, from_binance: 1 }[e.type] || 0;
      cap[e.bucket] += sign * e.amountTwd;
    }
    return cap;
  }

  /* ---------- bank (securities settlement account) ---------- */
  function bankSummary(db, now = Date.now()) {
    const snaps = [...db.bank.snapshots].sort((a, b) => time(a.date) - time(b.date));
    const anchor = snaps[snaps.length - 1] || null;
    const anchorAt = anchor ? time(anchor.date) : -Infinity;
    const flows = [];
    for (const e of validEvents(db)) {
      if (!e.viaBank || time(e.date) <= anchorAt) continue;
      const sign = { contribution: 1, withdrawal: -1, to_binance: -1, from_binance: 1, bank_adjust: 1, income: 1 }[e.type];
      if (!sign) continue;
      flows.push({ kind: 'event', id: e.id, date: e.date, label: EVENT_LABEL[e.type], amount: sign * e.amountTwd });
    }
    const pending = [];
    for (const t of validTrades(db)) {
      if (t.side === 'INIT') continue;
      if (isPending(t)) { pending.push({ id: t.id, date: t.date, ticker: t.ticker, side: t.side, amount: tradeBankTwd(t), estimate: true, trade: t }); continue; }
      if (time(t.settledAt) > anchorAt) flows.push({ kind: 'trade', id: t.id, date: t.settledAt, label: `${t.ticker} ${t.side === 'BUY' ? '買進' : '賣出'}交割`, amount: tradeBankTwd(t) });
    }
    flows.sort((a, b) => time(a.date) - time(b.date));
    const flowTotal = sum(flows, f => f.amount);
    const pendingTotal = sum(pending, p => p.amount);
    const expected = anchor ? anchor.balance + flowTotal : NaN;
    return {
      configured: Boolean(anchor), anchor, flows, flowTotal, pending, pendingTotal,
      expected, afterPending: expected + pendingTotal,
      available: anchor ? expected - anchor.reserved : NaN,
      ageDays: anchor ? (now - anchorAt) / DAY : NaN
    };
  }

  // Compare a fresh bank reading with what the ledger expects. The difference is
  // returned, never applied automatically.
  function reconcileBank(db, balance, at, now = Date.now()) {
    const s = bankSummary(db, now);
    const diff = s.configured ? balance - s.expected : NaN;
    return { expected: s.expected, actual: balance, diff, flows: s.flows, anchor: s.anchor, at: normalizeTime(at) };
  }

  /* ---------- Binance ---------- */
  function binanceSummary(db, now = Date.now()) {
    const snaps = [...db.binance.snapshots].sort((a, b) => time(a.date) - time(b.date));
    const latest = snaps[snaps.length - 1] || null;
    const at = latest ? time(latest.date) : Infinity;
    const funding = validEvents(db).filter(e => ['to_binance', 'binance_in', 'from_binance'].includes(e.type))
      .map(e => ({ ...e, signed: e.type === 'from_binance' ? -e.amountTwd : e.amountTwd }))
      .sort((a, b) => time(a.date) - time(b.date));
    // Only money that arrived before the snapshot can be compared with it.
    const counted = funding.filter(e => time(e.date) <= at);
    const later = funding.filter(e => time(e.date) > at);
    const netFunding = sum(counted, e => e.signed);
    const bySource = {};
    for (const e of counted) { const k = e.source || 'other'; bySource[k] = (bySource[k] || 0) + e.signed; }
    return {
      configured: Boolean(latest), latest, funding, counted, later,
      netFunding, laterFunding: sum(later, e => e.signed), bySource,
      // Money sent after the snapshot is not in the snapshot yet, but it is still an asset.
      value: latest ? latest.totalTwd + sum(later, e => e.signed) : NaN,
      pnl: latest ? latest.totalTwd - netFunding : NaN,
      ageDays: latest ? (now - at) / DAY : NaN,
      hasEstimate: counted.some(e => e.estimated)
    };
  }

  function strategyStats(strategies) {
    const rows = strategies.filter(s => isNum(s.pnlUsdt));
    const wins = rows.filter(s => s.pnlUsdt > 0), losses = rows.filter(s => s.pnlUsdt < 0);
    const grossWin = sum(wins, s => s.pnlUsdt), grossLoss = -sum(losses, s => s.pnlUsdt);
    return {
      count: rows.length, totalUsdt: sum(rows, s => s.pnlUsdt),
      winRate: rows.length ? wins.length / rows.length * 100 : NaN,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : NaN,
      avgWinUsdt: wins.length ? grossWin / wins.length : NaN,
      avgLossUsdt: losses.length ? grossLoss / losses.length : NaN
    };
  }

  /* ---------- trade quality (swing round trips) ---------- */
  // Win/loss and every ratio use the TWD result, so FX cannot make one trade a
  // win in one metric and a loss in another.
  function tradeStats(trips) {
    const done = trips.filter(t => isNum(t.realizedTwd)).sort((a, b) => time(a.close) - time(b.close));
    const wins = done.filter(t => t.realizedTwd > 0), losses = done.filter(t => t.realizedTwd < 0);
    const avg = (rows, f) => rows.length ? sum(rows, f) / rows.length : NaN;
    const avgWinPct = avg(wins, t => t.returnPct), avgLossPct = Math.abs(avg(losses, t => t.returnPct));
    const grossWin = sum(wins, t => t.realizedTwd), grossLoss = Math.abs(sum(losses, t => t.realizedTwd));
    let equity = 0, peak = 0, maxDd = 0, ws = 0, ls = 0, maxWs = 0, maxLs = 0;
    const curve = [];
    for (const t of done) {
      equity += t.realizedTwd; peak = Math.max(peak, equity); maxDd = Math.min(maxDd, equity - peak);
      if (t.realizedTwd > 0) { ws++; ls = 0; maxWs = Math.max(maxWs, ws); } else if (t.realizedTwd < 0) { ls++; ws = 0; maxLs = Math.max(maxLs, ls); }
      curve.push({ date: t.close, value: equity, ticker: t.ticker, pnl: t.realizedTwd });
    }
    const rated = done.filter(t => isNum(t.rMultiple));
    return {
      count: done.length, wins: wins.length, losses: losses.length,
      winRate: done.length ? wins.length / done.length * 100 : NaN,
      avgWinPct, avgLossPct, payoff: avgLossPct > 0 ? avgWinPct / avgLossPct : NaN,
      expectancyPct: avg(done, t => t.returnPct),
      expectancyTwd: avg(done, t => t.realizedTwd),
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : NaN,
      totalTwd: equity, maxDrawdown: maxDd, maxWinStreak: maxWs, maxLossStreak: maxLs,
      avgHoldDays: avg(done, t => t.holdDays),
      avgR: avg(rated, t => t.rMultiple), rCount: rated.length, curve
    };
  }

  /* ---------- money-weighted return ---------- */
  function xirr(flows) {
    const f = flows.filter(x => isNum(x.amount) && isNum(x.t) && x.amount !== 0).sort((a, b) => a.t - b.t);
    if (f.length < 2 || !f.some(x => x.amount > 0) || !f.some(x => x.amount < 0)) return NaN;
    const t0 = f[0].t;
    const npv = r => sum(f, x => x.amount / Math.pow(1 + r, (x.t - t0) / (365 * DAY)));
    let lo = -0.9999, hi = 10;
    let fLo = npv(lo), fHi = npv(hi);
    if (!isNum(fLo) || !isNum(fHi) || fLo * fHi > 0) return NaN;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-7) return mid;
      if (fLo * fm < 0) { hi = mid; fHi = fm; } else { lo = mid; fLo = fm; }
    }
    return (lo + hi) / 2;
  }

  // Return of one bucket from its own trade cash flows plus today's market value.
  function bucketReturn(db, rows, bucket, now = Date.now()) {
    const trades = validTrades(db).filter(t => t.bucket === bucket);
    const flows = trades.map(t => ({ t: time(t.date), amount: t.side === 'SELL' ? tradeTwd(t) : -tradeTwd(t) }));
    const open = rows.filter(r => r.bucket === bucket);
    const priced = open.every(r => r.priced);
    const mkt = sum(open, r => (r.priced ? r.mktTwd : 0));
    if (mkt > 0) flows.push({ t: now, amount: mkt });
    const start = flows.length ? Math.min(...flows.map(x => x.t)) : NaN;
    const days = (now - start) / DAY;
    const annual = priced ? xirr(flows) : NaN;
    return {
      days, priced, annual,
      // Money-weighted return over the holding period; annualizing a few weeks
      // of data exaggerates it, so the annual figure is only shown past 90 days.
      period: isNum(annual) ? Math.pow(1 + annual, days / 365) - 1 : NaN,
      showAnnual: isNum(annual) && days >= 90
    };
  }

  /* ---------- settlement ---------- */
  function settleBatch(db, input) {
    const ids = [...new Set((input.ids || []).filter(Boolean))];
    if (!ids.length) throw Error('請至少選擇一筆交易');
    const settledAt = normalizeTime(input.settledAt);
    if (!settledAt) throw Error('請填寫銀行實際扣款／入帳日期');
    const trades = ids.map(id => db.trades.find(t => t.id === id));
    if (trades.some(t => !t)) throw Error('找不到選取的交易');
    if (trades.some(t => t.side === 'INIT')) throw Error('期初持倉不需要交割');
    if (trades.some(t => !isPending(t))) throw Error('選取的交易中有已交割的項目');
    const currencies = new Set(trades.map(t => t.currency));
    if (currencies.size !== 1) throw Error('同一批只能選同一種幣別');
    const currency = trades[0].currency;
    const netBase = sum(trades, t => (t.side === 'BUY' ? 1 : -1) * tradeBaseAmount(t)); // >0 means the bank pays out
    const twd = num(input.actualTwd), fxIn = num(input.actualFx);
    const warnings = [];
    let rate;
    if (currency === 'TWD') {
      rate = 1;
      if (twd > 0 && Math.abs(twd - Math.abs(netBase)) > 1) warnings.push(`銀行金額 ${round(twd, 0)} 與交易淨額 ${round(Math.abs(netBase), 0)} 不一致，請確認手續費或稅`);
    } else if (fxIn > 0) {
      rate = fxIn;
    } else if (twd > 0) {
      if (Math.abs(netBase) < SMALL_NET_USD) throw Error(`這批買賣淨額只有 ${round(Math.abs(netBase), 2)} 美元，銀行金額四捨五入就會讓匯率失真，請改填銀行的成交匯率`);
      rate = twd / Math.abs(netBase);
    } else throw Error('請填銀行實際金額或成交匯率');
    const ref = num(input.referenceFx);
    if (currency !== 'TWD' && ref > 0 && Math.abs(rate / ref - 1) > FX_DEVIATION_WARN) {
      warnings.push(`反算匯率 ${round(rate, 4)} 與參考匯率 ${round(ref, 4)} 相差超過 ${FX_DEVIATION_WARN * 100}%，請確認金額或是否選錯交易`);
    }
    const next = clone(db);
    for (const id of ids) {
      const t = next.trades.find(x => x.id === id);
      t.fx = rate; t.fxStatus = 'final'; t.settledAt = settledAt;
      t.settlementTwd = tradeBaseAmount(t) * rate;
    }
    return { db: next, rate, netBase, netTwd: netBase * rate, warnings };
  }

  /* ---------- whole-portfolio summary ---------- */
  function portfolio(db, now = Date.now()) {
    const pos = computePositions(db);
    const rows = valuePositions(db, pos.open);
    const usdTwd = fxRate(db);
    const bank = bankSummary(db, now);
    const binance = binanceSummary(db, now);
    const capital = bucketCapital(db);

    const byBucket = {};
    for (const b of BUCKETS) {
      const r = rows.filter(x => x.bucket === b);
      const realizedTwd = sum(pos.realized.filter(x => x.bucket === b), x => x.pnlTwd);
      const costTwd = sum(r, x => x.costTwd);
      const priced = r.every(x => x.priced);
      const mktTwd = sum(r, x => (x.priced ? x.mktTwd : 0));
      byBucket[b] = {
        rows: r, costTwd, mktTwd, priced, realizedTwd,
        unrealized: priced ? mktTwd - costTwd : NaN,
        priceEffect: sum(r, x => (x.priced ? x.priceEffect : 0)), fxEffect: sum(r, x => (x.priced ? x.fxEffect : 0)),
        capital: capital[b], available: capital[b] - costTwd + realizedTwd,
        returns: bucketReturn(db, rows, b, now)
      };
    }
    const stockPriced = rows.every(r => r.priced);
    const stockMkt = sum(rows, r => (r.priced ? r.mktTwd : 0));
    const stockCost = sum(rows, r => r.costTwd);
    const stockRealized = sum(pos.realized, r => r.pnlTwd);
    const stockUnrealized = stockPriced ? stockMkt - stockCost : NaN;
    const financing = db.loan.fee + db.loan.interestPaid;
    // Dividends, fee rebates and account interest are investment returns.
    const incomeTwd = sum(validEvents(db).filter(e => e.type === 'income'), e => e.amountTwd);
    const cash = bank.configured ? bank.afterPending : NaN;
    const totalAssets = stockPriced && bank.configured && binance.configured ? stockMkt + cash + binance.value : NaN;
    const binancePnl = binance.configured ? binance.pnl : NaN;
    const grossPnl = stockRealized + stockUnrealized + binancePnl + incomeTwd;
    const netPnl = grossPnl - financing;
    const invested = capital.long + capital.swing + binance.netFunding + binance.laterFunding;

    const swingTrips = pos.roundTrips.filter(t => t.bucket === 'swing');
    return {
      now, usdTwd, positions: rows, realized: pos.realized, roundTrips: pos.roundTrips, issues: pos.issues,
      byBucket, bank, binance, capital,
      stockPriced, stockMkt, stockCost, stockRealized, stockUnrealized,
      priceEffect: byBucket.long.priceEffect + byBucket.swing.priceEffect,
      fxEffect: byBucket.long.fxEffect + byBucket.swing.fxEffect,
      cash, totalAssets, binancePnl, incomeTwd, grossPnl, financing, netPnl, invested,
      netPct: invested > 0 && isNum(netPnl) ? netPnl / invested * 100 : NaN,
      swingStats: tradeStats(swingTrips),
      strategy: strategyStats(db.binance.strategies),
      composition: [
        { key: 'long', label: '長期', value: byBucket.long.priced ? byBucket.long.mktTwd : NaN },
        { key: 'swing', label: '波段', value: byBucket.swing.priced ? byBucket.swing.mktTwd : NaN },
        { key: 'binance', label: '幣安', value: binance.value },
        { key: 'cash', label: '交割戶', value: cash }
      ]
    };
  }

  /* ---------- alerts: everything that makes a number incomplete or stale ---------- */
  function alerts(db, p, now = Date.now()) {
    const out = [];
    const add = (level, text, action) => out.push({ level, text, action });
    const fx = db.fx.USDTWD;
    if (p.issues.length) for (const i of p.issues) add('critical', i, 'trades');
    const invalid = db.trades.filter(t => t._invalid).length + db.cashEvents.filter(e => e._invalid).length;
    if (invalid) add('critical', `${invalid} 筆紀錄資料有誤，暫不計入（到交易頁查看）`, 'trades');
    if (!(fx.rate > 0)) add('critical', '還沒有 USD/TWD 匯率，美股市值無法換算', 'fx');
    else if (fx.asOf && now - time(fx.asOf) > 3 * DAY) add('warning', `匯率已 ${Math.floor((now - time(fx.asOf)) / DAY)} 天沒更新`, 'fx');
    const missing = p.positions.filter(r => !r.priced).map(r => r.ticker);
    if (missing.length) add('critical', `缺少報價：${missing.join('、')}`, 'quotes');
    const stale = p.positions.filter(r => r.priced && r.quoteAsOf && now - time(r.quoteAsOf) > 4 * DAY).map(r => r.ticker);
    if (stale.length) add('warning', `報價超過 4 天：${stale.join('、')}`, 'quotes');
    if (p.bank.pending.length) add('info', `${p.bank.pending.length} 筆交易待交割，銀行扣款後記得核銷`, 'settle');
    if (!p.bank.configured) add('critical', '還沒有交割戶餘額，總資產無法計算', 'bank');
    else if (p.bank.ageDays > 7) add('warning', `交割戶餘額已 ${Math.floor(p.bank.ageDays)} 天沒核對`, 'bank');
    if (!p.binance.configured) add('critical', '還沒有幣安總資產，總資產無法計算', 'binance');
    else if (p.binance.ageDays > 7) add('warning', `幣安總資產已 ${Math.floor(p.binance.ageDays)} 天沒更新，幣安損益可能失真`, 'binance');
    for (const b of BUCKETS) if (p.byBucket[b].available < -1) add('warning', `${BUCKET_LABEL[b]}資金已超用 ${Math.round(-p.byBucket[b].available).toLocaleString('zh-TW')} 元`, 'capital');
    const days = db.settings.backupReminderDays || 7;
    const lastExport = time(db.meta.lastExportAt);
    const updated = time(db.meta.updatedAt);
    if ((db.trades.length || db.cashEvents.length) && (!isNum(lastExport) || (updated > lastExport && now - lastExport > days * DAY))) {
      add('warning', isNum(lastExport) ? `已 ${Math.floor((now - lastExport) / DAY)} 天沒匯出備份` : '還沒匯出過備份，資料只存在這支手機', 'backup');
    }
    const rank = { critical: 0, warning: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  /* ---------- net-asset history (one point per Taipei day) ---------- */
  function recordNav(db, p, now = Date.now()) {
    if (!isNum(p.totalAssets)) return db;
    const date = taipeiDate(now);
    const point = { date, totalTwd: Math.round(p.totalAssets), stockTwd: Math.round(p.stockMkt), cashTwd: Math.round(p.cash), binanceTwd: Math.round(p.binance.value), netPnl: isNum(p.netPnl) ? Math.round(p.netPnl) : null };
    const next = db.navHistory.filter(x => x.date !== date);
    next.push(point);
    next.sort((a, b) => a.date.localeCompare(b.date));
    return { ...db, navHistory: next };
  }

  const api = {
    SCHEMA, SCHEMA_VERSION, BUCKETS, BUCKET_LABEL, SOURCES, SOURCE_LABEL, EVENT_TYPES, EVENT_LABEL, SMALL_NET_USD,
    isNum, num, sum, clone, round, uid, normalizeTime, toTaipeiIso, time, taipeiDate, nowIso,
    emptyDb, normalizeDb, normalizeTrade, normalizeEvent,
    tradeBaseAmount, tradeTwd, tradeBankTwd, isPending,
    computePositions, valuePositions, bucketCapital, bankSummary, reconcileBank, binanceSummary,
    strategyStats, tradeStats, xirr, bucketReturn, settleBatch, portfolio, alerts, recordNav, fxRate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
