/*
 * Import a Wealth Ledger / Stock Ledger backup into the Stock Claude format.
 * Every assumption made during conversion is written to the report, so the
 * owner can check it instead of trusting it.
 */
(function (root) {
  'use strict';
  const Core = root.Core || (typeof require === 'function' ? require('./core.js') : null);
  const { num, normalizeTime, uid, isNum, round } = Core;

  const isLegacy = raw => raw && typeof raw === 'object' && Array.isArray(raw.transactions) && raw.schema !== Core.SCHEMA;

  function fromLegacy(raw, now = Date.now()) {
    if (!isLegacy(raw)) throw Error('這不是 Wealth Ledger／Stock Ledger 的備份檔');
    const db = Core.emptyDb(now);
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    const report = { notes: [], counts: {} };
    const note = s => report.notes.push(s);
    const fx = num(meta.currentUsdTwd);

    /* trades */
    for (const t of raw.transactions) {
      const date = normalizeTime(t.date);
      const fxStatus = t.fxStatus === 'estimate' ? 'estimate' : 'final';
      db.trades.push({
        id: String(t.id || uid()), date,
        bucket: t.account === '長期' ? 'long' : 'swing',
        ticker: String(t.ticker || '').trim().toUpperCase(), name: String(t.name || ''),
        currency: t.currency === 'TWD' ? 'TWD' : 'USD',
        side: t.side, qty: num(t.qty), price: num(t.price), fee: num(t.fee, 0), tax: num(t.tax, 0),
        fx: t.currency === 'TWD' ? 1 : num(t.fx), fxStatus,
        // The old app stamped settledAt when the button was pressed, not when the bank
        // moved money, so the trade date is the better guess for the bank date.
        settledAt: fxStatus === 'estimate' ? null : date,
        legacySettledAt: normalizeTime(t.settledAt) || null,
        settlementTwd: num(t.settlementTwd, null), stop: num(t.stop, null),
        brokerPnlBase: num(t.brokerPnlBase, null), brokerPnlTwd: num(t.brokerPnlTwd, null),
        brokerPnlScope: ['execution', 'position'].includes(t.brokerPnlScope) ? t.brokerPnlScope : null,
        tradeReturnPct: num(t.tradeReturnPct, null), originalRiskBase: num(t.originalRiskBase, null),
        exitReason: String(t.exitReason || ''), note: String(t.note || '')
      });
    }
    report.counts.trades = db.trades.length;
    const pending = db.trades.filter(t => !t.settledAt).length;
    if (pending) note(`${pending} 筆交易仍是暫估匯率，已列為待交割`);
    if (db.trades.some(t => t.legacySettledAt)) note('舊版的交割時間是按下核銷的時間，不是銀行扣款日；已改用成交日判斷是否已包含在交割戶快照內，請輸入一次目前銀行餘額核對');

    /* quotes: prices only; FX now comes from one shared USD/TWD rate */
    for (const [k, q] of Object.entries(raw.quotes || {})) {
      if (!(num(q && q.price) > 0)) continue;
      const currency = q.currency === 'TWD' || num(q.fx) === 1 ? 'TWD' : 'USD';
      db.quotes[k.toUpperCase()] = { price: num(q.price), currency, asOf: normalizeTime(q.fetchedAt || q.updated), source: String(q.source || '舊版') };
    }
    if (fx > 0) db.fx.USDTWD = { rate: fx, asOf: normalizeTime(meta.exportedAt) || Core.nowIso(now), source: '舊版參考匯率' };

    /* capital: allocations, contributions, Binance funding */
    const cap = meta.capitalTracking || {};
    const plan = meta.fundPlan || {};
    const cash = meta.securitiesCash || {};
    const startDate = normalizeTime(cap.resetDate) || (db.trades[0] && db.trades[0].date) || Core.nowIso(now);
    const contributions = Array.isArray(cash.investmentContributions) ? cash.investmentContributions : [];
    const contributed = { long: 0, swing: 0 };
    for (const c of contributions) {
      const bucket = c.account === '長期' ? 'long' : 'swing';
      contributed[bucket] += num(c.amountTwd, 0);
      db.cashEvents.push({ id: String(c.id || uid()), date: normalizeTime(c.date), type: 'contribution', amountTwd: num(c.amountTwd), bucket, source: null, viaBank: true, note: String(c.note || '舊版新增投入') });
    }
    // The old plan already includes later contributions; the opening allocation is the remainder.
    for (const [bucket, key] of [['long', 'longTerm'], ['swing', 'swing']]) {
      const opening = num(plan[key], 0) - contributed[bucket];
      if (opening > 0) db.cashEvents.push({ id: uid(), date: startDate, type: 'allocation', amountTwd: opening, bucket, source: null, viaBank: false, note: '舊版期初配置' });
    }

    // Binance money. Bank transfers and loan deposits come out of the swing capital
    // (confirmed by the owner); assets that were already on Binance do not.
    const transfers = Array.isArray(cash.externalTransfers) ? cash.externalTransfers : [];
    for (const t of transfers) {
      db.cashEvents.push({ id: String(t.id || uid()), date: normalizeTime(t.date), type: 'to_binance', amountTwd: num(t.amountTwd), bucket: 'swing', source: null, viaBank: true, note: String(t.note || '交割戶轉入幣安') });
    }
    let existingTwd = 0;
    for (const h of raw.externalHoldings || []) {
      for (const f of Array.isArray(h.fundingHistory) ? h.fundingHistory : []) {
        const twd = num(f.originalTwd);
        const source = ['loan', 'self', 'family'].includes(f.source) ? f.source : 'other';
        if (twd > 0) {
          db.cashEvents.push({ id: uid(), date: normalizeTime(f.date), type: 'binance_in', amountTwd: twd, bucket: 'swing', source, viaBank: false, note: f.note || `${source === 'loan' ? '信貸' : ''}入金 ${round(num(f.amountUsdt, 0), 2)} USDT` });
        } else if (num(f.amountUsdt) > 0 && fx > 0) {
          const est = num(f.amountUsdt) * fx;
          existingTwd += est;
          db.cashEvents.push({ id: uid(), date: normalizeTime(f.date), type: 'binance_in', amountTwd: round(est, 0), bucket: null, source, viaBank: false, estimated: true, note: `${f.note || '既有資金'}：${round(num(f.amountUsdt), 2)} USDT，以目前匯率 ${fx} 估算台幣` });
        }
      }
      // A legacy holding with no purchase record enters at its value on the day tracking started.
      if (h.legacy && num(h.baselineMarketValueTwd) > 0) {
        existingTwd += num(h.baselineMarketValueTwd);
        const date = normalizeTime((meta.cryptoSnapshot && meta.cryptoSnapshot.asOf) || h.asOf);
        db.cashEvents.push({ id: uid(), date, type: 'binance_in', amountTwd: round(num(h.baselineMarketValueTwd), 0), bucket: null, source: h.source === 'loan' ? 'loan' : 'self', viaBank: false, note: `既有 ${h.ticker} 持倉，以期初快照市值計入（舊版未計入投入）` });
      }
    }
    if (existingTwd > 0) note(`幣安既有資產約 NT$${Math.round(existingTwd).toLocaleString('zh-TW')}（舊 BTC 持倉與早期 USDT）改列為「投入」，不再算成獲利`);

    const snap = meta.cryptoSnapshot;
    if (snap && num(snap.totalValueTwd) >= 0 && snap.totalValueTwd !== null && normalizeTime(snap.asOf)) {
      db.binance.snapshots.push({ id: uid(), date: normalizeTime(snap.asOf), totalTwd: num(snap.totalValueTwd), note: '舊版幣安總資產快照' });
    }
    db.binance.strategies = (raw.manualTrades || []).map(m => ({
      id: String(m.id || uid()), name: String(m.ticker || ''), mode: String(m.strategyMode || m.direction || ''),
      open: normalizeTime(m.open), close: normalizeTime(m.close),
      pnlUsdt: (m.currency || 'USDT') === 'USDT' ? num(m.pnl, 0) : num(m.pnl, 0) / (fx || 1),
      returnPct: num(m.returnPct), marginUsdt: num(m.marginUsdt ?? m.investedMargin), leverage: num(m.leverage, null),
      note: String(m.note || '')
    }));

    /* bank anchor */
    if (cash.enabled && normalizeTime(cash.asOf)) {
      db.bank.snapshots.push({ id: uid(), date: normalizeTime(cash.asOf), balance: num(cash.accountBalanceTwd, 0), reserved: num(cash.reservedTwd, 0), note: '舊版交割戶快照' });
    }

    /* loan, sources, reserve */
    db.loan = { principal: num(cap.loanGross, 0), fee: num(cap.loanFee, 0), apr: null, startDate: '', principalRepaid: num(cap.principalRepaid, 0), interestPaid: num(cap.interestPaid, 0) };
    db.sources = { asOf: cap.resetDate || '', loan: num(cap.openingLoan, 0), self: num(cap.openingSelf, 0), family: num(cap.openingFamily, 0) };
    db.reserve = { loanPayment: num(plan.loan, 0), emergency: num(plan.reserve, 0) };
    if (num(cap.cashAdjustmentTwd, 0)) note(`舊版「歷史現金校正」${num(cap.cashAdjustmentTwd).toLocaleString('zh-TW')} 元不再使用，交割戶改用「快照＋之後的交割」推算`);

    db.meta.migratedFrom = { app: 'wealth-ledger', version: String(meta.appVersion || ''), exportedAt: String(meta.exportedAt || ''), importedAt: Core.nowIso(now) };
    // Everything the new model does not use is kept verbatim for reference.
    db.meta.legacy = { fundPlan: plan, capitalTracking: cap, cryptoSnapshot: meta.cryptoSnapshot || null, externalHoldings: raw.externalHoldings || [], securitiesCash: { ...cash, pendingSettlements: undefined } };
    report.counts.events = db.cashEvents.length;
    report.counts.strategies = db.binance.strategies.length;
    const { db: normalized, warnings } = Core.normalizeDb(db);
    return { db: normalized, report: { ...report, warnings } };
  }

  const api = { isLegacy, fromLegacy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Migrate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
