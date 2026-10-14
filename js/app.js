/* Stock Claude — user interface. All numbers come from Core; this file only
   renders them and turns form input into new database states. */
(function () {
  'use strict';
  const APP_VERSION = '1.0.1';
  const C = window.Core;
  const store = window.Storage.createStore(window.localStorage);
  const $ = id => document.getElementById(id);

  let loaded = store.load();
  let db = loaded.db;
  let loadWarnings = loaded.warnings || [];
  const ui = { view: 'overview', perf: 'swing', holdFilter: 'all', tradeFilter: 'all', tradeQuery: '', busy: false };

  /* ---------- formatting ---------- */
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const ok = v => typeof v === 'number' && Number.isFinite(v);
  const nf = (d = 0) => new Intl.NumberFormat('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v, d = 0) => (ok(v) ? nf(d).format(v) : '—');
  const twd = v => (ok(v) ? 'NT$' + money(v) : '—');
  const signed = (v, d = 0) => (ok(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + nf(d).format(Math.abs(v)) : '—');
  const pct = (v, d = 2) => (ok(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%' : '—');
  const tone = v => (!ok(v) || Math.abs(v) < 0.5 ? '' : v > 0 ? 'up' : 'down');
  const qty = v => (ok(v) ? nf(Number.isInteger(v) ? 0 : 4).format(v).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : '—');
  const day = s => (s ? s.slice(0, 10).replace(/-/g, '/') : '—');
  const dayTime = s => (s ? s.slice(0, 16).replace('T', ' ').replace(/-/g, '/') : '—');
  const short = v => (Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(Math.abs(v) >= 1e5 ? 0 : 1) + '萬' : String(Math.round(v)));
  const ago = iso => {
    const t = C.time(iso); if (!ok(t)) return '未記錄';
    const m = (Date.now() - t) / 6e4;
    if (m < 60) return Math.max(1, Math.round(m)) + ' 分鐘前';
    if (m < 1440) return Math.round(m / 60) + ' 小時前';
    return Math.floor(m / 1440) + ' 天前';
  };
  const localInput = (ms = Date.now()) => C.toTaipeiIso(ms).slice(0, 16);
  const bucketName = b => C.BUCKET_LABEL[b] || b;
  const sideName = s => ({ BUY: '買進', SELL: '賣出', INIT: '期初持倉' }[s] || s);
  const MODE_LABEL = { NEUTRAL: '中性網格', LONG: '做多網格', SHORT: '做空網格', LONG_UPWARD_TRAILING: '做多網格（追高）' };
  const COLORS = { long: 'var(--c-long)', swing: 'var(--c-swing)', binance: 'var(--c-binance)', cash: 'var(--c-cash)' };

  /* ---------- icons ---------- */
  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    overview: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'),
    holdings: svg('<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>'),
    trades: svg('<path d="m17 3 4 4-4 4"/><path d="M3 11V9a2 2 0 0 1 2-2h16"/><path d="m7 21-4-4 4-4"/><path d="M21 13v2a2 2 0 0 1-2 2H3"/>'),
    performance: svg('<path d="M4 20V11M10 20V5M16 20v-6M22 20H2"/>'),
    funds: svg('<path d="M3 9h18M5 9v9M10 9v9M14 9v9M19 9v9M2 21h20M12 3l9 5H3z"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    refresh: svg('<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>'),
    close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
    critical: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>'),
    warning: svg('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.5"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5V8"/>')
  };
  const TABS = [['overview', '總覽'], ['holdings', '持倉'], ['trades', '交易'], ['performance', '績效'], ['funds', '資金']];
  const TITLES = { overview: '總覽', holdings: '持倉', trades: '交易', performance: '績效', funds: '資金', settings: '設定與備份' };

  /* ---------- persistence ---------- */
  function commit(next, reason, message) {
    try {
      db = store.save(next, reason);
      render();
      if (message) toast(message);
      return true;
    } catch (e) { showError(e.message); return false; }
  }

  function recordNavQuietly(p) {
    if (store.mode !== 'normal' || !ok(p.totalAssets)) return;
    const today = C.taipeiDate(Date.now());
    const last = db.navHistory[db.navHistory.length - 1];
    if (last && last.date === today && last.totalTwd === Math.round(p.totalAssets)) return;
    try { db = store.save(C.recordNav(db, p), 'nav', { quiet: true }); } catch (_) { /* reported on the next edit */ }
  }

  /* ---------- rendering ---------- */
  function render() {
    applySettings();
    if (store.mode === 'recovery') { renderRecovery(); return; }
    const empty = !db.trades.length && !db.cashEvents.length && !db.bank.snapshots.length;
    if (empty) { renderWelcome(); return; }
    const p = C.portfolio(db);
    recordNavQuietly(p);
    renderOverview(p); renderHoldings(p); renderTrades(p); renderPerformance(p); renderFunds(p); renderSettings();
  }

  function applySettings() {
    document.documentElement.dataset.updown = db.settings.upColor === 'green' ? 'green' : 'red';
  }

  function showView(view) {
    ui.view = view;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('#tabbar button').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    $('viewTitle').textContent = TITLES[view];
    // Charts size themselves to their container, which is only measurable once visible.
    if (store.mode === 'normal' && (view === 'overview' || view === 'performance')) render();
    window.scrollTo({ top: 0 });
  }

  const row = ({ title, sub = '', end = '', end2 = '', cls = '', attrs = '', lead = '' }) =>
    `<li class="row ${cls}" ${attrs}>${lead}<div class="row-main"><div class="row-title">${title}</div>${sub ? `<div class="row-sub">${sub}</div>` : ''}</div>${end || end2 ? `<div class="row-end">${end}${end2}</div>` : ''}</li>`;
  const n = (v, cls = '') => `<span class="num ${cls}">${v}</span>`;
  const stat = (label, value, sub = '', cls = '') => `<div class="stat"><span>${label}</span><strong class="num ${cls}">${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const section = (title, body, { action = '', note = '' } = {}) =>
    `<section class="section"><div class="section-head"><h2>${title}</h2>${action}</div>${note ? `<p class="section-note">${note}</p>` : ''}${body}</section>`;

  /* ----- overview ----- */
  function renderOverview(p) {
    const parts = p.composition;
    const known = parts.filter(x => ok(x.value) && x.value > 0);
    const total = known.reduce((s, x) => s + x.value, 0);
    const band = `
      <div class="band">
        <div class="band-label"><span>總資產</span><span>USD/TWD ${ok(p.usdTwd) ? p.usdTwd.toFixed(3) : '未設定'}</span></div>
        <div class="band-total num"><small>NT$</small>${ok(p.totalAssets) ? money(p.totalAssets) : '資料不完整'}</div>
        <div class="band-pnl">淨損益 <span class="num ${tone(p.netPnl)}">${signed(p.netPnl)}</span><span class="chip num ${tone(p.netPnl)}">${pct(p.netPct)}</span></div>
        <div class="stack" role="img" aria-label="資產組成">${known.map(x => `<span style="flex:${x.value};background:${COLORS[x.key]}"></span>`).join('')}</div>
        <div class="legend">${parts.map(x => `<div class="legend-item"><i class="swatch" style="background:${COLORS[x.key]}"></i><span>${x.label}</span><strong class="num">${ok(x.value) ? short(x.value) + (total ? ` · ${Math.round(x.value / total * 100)}%` : '') : '—'}</strong></div>`).join('')}</div>
      </div>`;
    const list = C.alerts(db, p);
    const actions = { fx: ['更新', 'refresh'], quotes: ['更新', 'refresh'], bank: ['核對', 'bank'], binance: ['更新', 'binance'], backup: ['匯出', 'export'], settle: ['核銷', 'gotoTrades'], trades: ['查看', 'gotoTrades'], capital: ['查看', 'gotoFunds'] };
    const alertsHtml = list.length ? `<div class="alerts">${list.map(a => {
      const act = actions[a.action];
      return `<div class="alert ${a.level}">${ICON[a.level]}<p>${esc(a.text)}</p>${act ? `<button class="btn btn-small" data-act="${act[1]}">${act[0]}</button>` : ''}</div>`;
    }).join('')}</div>` : '';

    const pnl = `<ul class="rows">
      ${row({ title: '股票已實現', end: n(signed(p.stockRealized), tone(p.stockRealized)) })}
      ${row({ title: '股票未實現', end: n(signed(p.stockUnrealized), tone(p.stockUnrealized)) })}
      ${row({ title: '股價變動', cls: 'indent', end: n(signed(p.priceEffect), tone(p.priceEffect)) })}
      ${row({ title: '匯率變動', cls: 'indent', end: n(signed(p.fxEffect), tone(p.fxEffect)) })}
      ${row({ title: '幣安', sub: p.binance.configured ? `快照 ${day(p.binance.latest.date)}` : '尚未設定', end: n(signed(p.binancePnl), tone(p.binancePnl)) })}
      ${p.incomeTwd ? row({ title: '股利／折讓／利息', end: n(signed(p.incomeTwd), tone(p.incomeTwd)) }) : ''}
      ${row({ title: '融資成本', sub: '信貸開辦費＋已付利息', end: n(p.financing ? '−' + money(p.financing) : '0', p.financing ? 'down' : '') })}
      ${row({ title: '淨損益', cls: 'total', end: n(signed(p.netPnl), tone(p.netPnl)) })}
    </ul>`;

    const accounts = `<ul class="rows">
      ${['long', 'swing'].map(b => { const x = p.byBucket[b]; return row({ lead: `<i class="dot" style="background:${COLORS[b]}"></i>`, title: bucketName(b), sub: `成本 ${money(x.costTwd)} · 可動用 ${money(x.available)}`, end: n(money(x.mktTwd)), end2: n(signed(x.unrealized), tone(x.unrealized)), cls: 'clickable', attrs: `data-act="gotoHoldings"` }); }).join('')}
      ${row({ lead: `<i class="dot" style="background:${COLORS.binance}"></i>`, title: '幣安', sub: p.binance.configured ? `淨投入 ${money(p.binance.netFunding + p.binance.laterFunding)}` : '尚未設定', end: n(money(p.binance.value)), end2: n(signed(p.binancePnl), tone(p.binancePnl)), cls: 'clickable', attrs: 'data-act="gotoFunds"' })}
      ${row({ lead: `<i class="dot" style="background:${COLORS.cash}"></i>`, title: '交割戶', sub: p.bank.configured ? `預估，含 ${p.bank.pending.length} 筆待交割` : '尚未設定', end: n(money(p.cash)), cls: 'clickable', attrs: 'data-act="gotoFunds"' })}
    </ul>`;

    $('view-overview').innerHTML = band + alertsHtml +
      `<div class="two-col">${section('帳戶', accounts)}${section('損益構成', pnl)}</div>` +
      section('資產走勢', '<div class="chart" id="navChart"></div>', { note: '每天第一次打開時自動記錄一筆總資產' });
    Charts.lineChart($('navChart'), db.navHistory.map(x => ({ x: C.time(x.date), y: x.totalTwd, label: x.date.replace(/-/g, '/') })), {
      format: v => short(v), ariaLabel: '總資產走勢', emptyText: '從今天開始記錄，明天起就能看到走勢'
    });
  }

  /* ----- holdings ----- */
  function renderHoldings(p) {
    const filters = [['all', '全部'], ['long', '長期'], ['swing', '波段']];
    const rows = p.positions.filter(r => ui.holdFilter === 'all' || r.bucket === ui.holdFilter)
      .sort((a, b) => (b.mktTwd || 0) - (a.mktTwd || 0));
    const mkt = rows.reduce((s, r) => s + (r.priced ? r.mktTwd : 0), 0);
    const unreal = rows.reduce((s, r) => s + (r.priced ? r.unrealized : 0), 0);
    const list = rows.length ? `<ul class="rows">${rows.map(r => row({
      lead: `<i class="dot" style="background:${COLORS[r.bucket]}"></i>`,
      title: `${esc(r.ticker)}${r.name ? `<span class="muted small">${esc(r.name)}</span>` : ''}`,
      sub: `${qty(r.qty)} 股 · 均價 ${money(r.avgPrice, 2)} · 現價 ${money(r.price, 2)}${r.quoteAsOf ? ' · ' + ago(r.quoteAsOf) : ''}`,
      end: n(money(r.mktTwd)), end2: n(`${signed(r.unrealized)} (${pct(r.unrealizedPct, 1)})`, tone(r.unrealized)),
      cls: 'clickable', attrs: `data-act="position" data-key="${esc(r.bucket + '|' + r.ticker + '|' + r.currency)}"`
    })).join('')}</ul>` : '<div class="empty">目前沒有持倉</div>';
    $('view-holdings').innerHTML = `
      <div class="segmented" role="group" aria-label="篩選帳戶">${filters.map(([k, l]) => `<button data-hold="${k}" aria-pressed="${ui.holdFilter === k}">${l}</button>`).join('')}</div>
      ${section('持倉', `<div class="stats">${stat('市值', money(mkt))}${stat('未實現', signed(unreal), '', tone(unreal))}</div>` + list, {
        action: `<button class="btn btn-small" data-act="quote">手動報價</button>`,
        note: '點一檔看股價與匯率各貢獻多少'
      })}`;
  }

  function openPosition(key) {
    const p = C.portfolio(db);
    const r = p.positions.find(x => [x.bucket, x.ticker, x.currency].join('|') === key);
    if (!r) return;
    const trades = db.trades.filter(t => t.ticker === r.ticker && t.bucket === r.bucket).sort((a, b) => C.time(b.date) - C.time(a.date));
    const body = `<ul class="rows">
      ${row({ title: '持有', end: n(qty(r.qty) + ' 股') })}
      ${row({ title: '成本', sub: r.currency === 'USD' ? `平均匯率 ${money(r.avgFx, 3)}` : '', end: n(money(r.costTwd)), end2: r.currency === 'USD' ? n(money(r.costBase, 2) + ' USD') : '' })}
      ${row({ title: '市值', sub: r.quoteAsOf ? `報價 ${dayTime(r.quoteAsOf)}（${esc(r.quoteSource)}）` : '沒有報價', end: n(money(r.mktTwd)) })}
      ${row({ title: '未實現', cls: 'total', end: n(signed(r.unrealized), tone(r.unrealized)), end2: n(pct(r.unrealizedPct), tone(r.unrealized)) })}
      ${r.currency === 'USD' ? row({ title: '股價變動', cls: 'indent', end: n(signed(r.priceEffect), tone(r.priceEffect)) }) + row({ title: '匯率變動', cls: 'indent', end: n(signed(r.fxEffect), tone(r.fxEffect)) }) : ''}
    </ul>
    <h3 class="small muted" style="margin:14px 0 0">交易紀錄</h3>
    <ul class="rows" style="padding:0">${trades.map(t => row({ title: `${sideName(t.side)} ${qty(t.qty)} 股 @ ${money(t.price, 2)}`, sub: dayTime(t.date), end: n(money(C.tradeTwd(t))) })).join('')}</ul>`;
    openSheet({ title: `${r.ticker} ${r.name || ''}`, body, submitLabel: '' });
  }

  /* ----- trades ----- */
  function renderTrades(p) {
    const pending = p.bank.pending;
    const pendingHtml = pending.length ? section('待交割', `<ul class="rows">${pending.map(x => row({
      lead: `<input type="checkbox" class="settle-pick" value="${esc(x.id)}" aria-label="選取 ${esc(x.ticker)}" style="width:20px;height:20px">`,
      title: `${esc(x.ticker)} ${sideName(x.side)} ${qty(x.trade.qty)} 股`,
      sub: `${dayTime(x.date)} · ${x.trade.currency === 'USD' ? '暫估匯率 ' + money(x.trade.fx, 3) : '台股'}`,
      end: n(signed(x.amount), tone(x.amount))
    })).join('')}</ul><div style="padding:0 16px 14px" class="btn-row"><button class="btn btn-primary" data-act="settle" id="settleButton" disabled>核銷選取項目</button></div>`, {
      note: '銀行扣款或入帳後，勾選同一天交割的交易，輸入一次實際金額即可'
    }) : '';

    const filters = [['all', '全部'], ['long', '長期'], ['swing', '波段']];
    const q = ui.tradeQuery.trim().toUpperCase();
    const realizedById = new Map(p.realized.map(r => [r.id, r.pnlTwd]));
    const list = db.trades
      .filter(t => (ui.tradeFilter === 'all' || t.bucket === ui.tradeFilter) && (!q || t.ticker.includes(q) || t.name.toUpperCase().includes(q)))
      .sort((a, b) => C.time(b.date) - C.time(a.date));
    const listHtml = list.length ? `<ul class="rows">${list.slice(0, 300).map(t => {
      const pnl = realizedById.get(t.id);
      return row({
        lead: `<i class="dot" style="background:${COLORS[t.bucket]}"></i>`,
        title: `${esc(t.ticker)} <span class="tag">${sideName(t.side)}</span>${t._invalid ? `<span class="tag" style="color:var(--critical)">資料有誤</span>` : ''}${!t.settledAt && t.side !== 'INIT' ? '<span class="tag">待交割</span>' : ''}`,
        sub: `${dayTime(t.date)} · ${qty(t.qty)} 股 @ ${money(t.price, 2)} ${t.currency}`,
        end: n(money(C.tradeTwd(t))), end2: ok(pnl) ? n(signed(pnl), tone(pnl)) : '',
        cls: 'clickable', attrs: `data-act="trade" data-id="${esc(t.id)}"`
      });
    }).join('')}</ul>` : '<div class="empty">沒有符合的交易</div>';

    $('view-trades').innerHTML = pendingHtml + `
      <div class="toolbar"><input class="search" id="tradeSearch" type="search" placeholder="搜尋代號或名稱" value="${esc(ui.tradeQuery)}" aria-label="搜尋交易"><button class="btn btn-primary" data-act="addTrade">${ICON.plus.replace('<svg', '<svg width="18" height="18"')}記一筆</button></div>
      <div class="segmented" role="group" aria-label="篩選帳戶">${filters.map(([k, l]) => `<button data-tfilter="${k}" aria-pressed="${ui.tradeFilter === k}">${l}</button>`).join('')}</div>
      ${section(`交易紀錄（${list.length}）`, listHtml)}`;
    const search = $('tradeSearch');
    search.oninput = () => { ui.tradeQuery = search.value; const pos = search.selectionStart; renderTrades(C.portfolio(db)); const s = $('tradeSearch'); s.focus(); s.setSelectionRange(pos, pos); };
    document.querySelectorAll('.settle-pick').forEach(cb => cb.onchange = () => {
      const count = document.querySelectorAll('.settle-pick:checked').length;
      $('settleButton').disabled = !count;
      $('settleButton').textContent = count ? `核銷選取的 ${count} 筆` : '核銷選取項目';
    });
  }

  function openTrade(id) {
    const t = db.trades.find(x => x.id === id);
    if (!t) return;
    const body = `<ul class="rows" style="padding:0">
      ${row({ title: '帳戶', end: n(bucketName(t.bucket)) })}
      ${row({ title: '成交時間', end: n(dayTime(t.date)) })}
      ${row({ title: '數量 × 價格', end: n(`${qty(t.qty)} × ${money(t.price, 4)} ${t.currency}`) })}
      ${row({ title: '手續費＋稅', end: n(money(t.fee + t.tax, 2) + ' ' + t.currency) })}
      ${t.currency === 'USD' ? row({ title: '匯率', sub: t.fxStatus === 'estimate' ? '暫估，交割後回填' : '實際交割匯率', end: n(money(t.fx, 4)) }) : ''}
      ${row({ title: '台幣金額', end: n(money(C.tradeTwd(t))) })}
      ${row({ title: '交割', end: n(t.settledAt ? dayTime(t.settledAt) : t.side === 'INIT' ? '不需交割' : '待交割') })}
      ${t._invalid ? row({ title: '資料問題', end: n(esc(t._invalid), 'down') }) : ''}
      ${t.note ? row({ title: '備註', sub: esc(t.note) }) : ''}
    </ul>`;
    openSheet({
      title: `${t.ticker} ${sideName(t.side)}`, body, submitLabel: '',
      extra: `<button type="button" class="btn btn-danger" data-sheet-delete>刪除這筆</button>`,
      onExtra: () => {
        if (!confirm('確定刪除這筆交易？刪除前的版本會保留在設定裡的「還原紀錄」。')) return false;
        const next = C.clone(db); next.trades = next.trades.filter(x => x.id !== id);
        const issues = C.computePositions(next).issues.filter(i => !C.computePositions(db).issues.includes(i));
        if (issues.length) { showError('刪除後會造成：' + issues.join('；')); return false; }
        return commit(next, `刪除 ${t.ticker} 交易`, '交易已刪除');
      }
    });
  }

  /* ----- performance ----- */
  function renderPerformance(p) {
    const tabs = [['swing', '波段'], ['long', '長期'], ['binance', '幣安']];
    let body = '';
    if (ui.perf === 'swing') {
      const s = p.swingStats;
      body = section('交易品質', `<div class="stats">
          ${stat('完整交易', s.count + ' 筆', `${s.wins} 勝 ${s.losses} 敗`)}
          ${stat('勝率', ok(s.winRate) ? s.winRate.toFixed(1) + '%' : '—')}
          ${stat('平均獲利', pct(s.avgWinPct), '獲利交易', 'up')}
          ${stat('平均虧損', ok(s.avgLossPct) ? '−' + s.avgLossPct.toFixed(2) + '%' : '—', '虧損交易', 'down')}
          ${stat('盈虧比 Payoff', ok(s.payoff) ? s.payoff.toFixed(2) : '—', '平均獲利 ÷ 平均虧損')}
          ${stat('期望值', pct(s.expectancyPct), `每筆約 ${signed(s.expectancyTwd)} 元`, tone(s.expectancyPct))}
          ${stat('獲利因子', ok(s.profitFactor) ? s.profitFactor.toFixed(2) : '—', '總獲利 ÷ 總虧損', s.profitFactor >= 1 ? 'up' : 'down')}
          ${stat('最大回撤', signed(s.maxDrawdown), `最多 ${s.maxWinStreak} 連勝 · ${s.maxLossStreak} 連敗`, s.maxDrawdown < 0 ? 'down' : '')}
          ${stat('平均持有', ok(s.avgHoldDays) ? s.avgHoldDays.toFixed(1) + ' 天' : '—')}
          ${stat('平均 R', ok(s.avgR) ? s.avgR.toFixed(2) + 'R' : '—', s.rCount ? `${s.rCount} 筆有停損` : '進場時填停損就能計算')}
        </div>`, { note: '只計算完整平倉的波段交易；勝負與比率都以台幣損益為準，匯率不會讓同一筆交易在不同指標裡一勝一敗' }) +
        section('已實現損益累積', '<div class="chart" id="swingChart"></div>', { note: '回撤就是這條線從高點往下掉的幅度' }) +
        section('完整交易', p.roundTrips.filter(t => t.bucket === 'swing').length ? `<ul class="rows">${p.roundTrips.filter(t => t.bucket === 'swing').sort((a, b) => C.time(b.close) - C.time(a.close)).map(t => row({
          title: esc(t.ticker), sub: `${day(t.open)} → ${day(t.close)} · ${t.holdDays.toFixed(1)} 天${ok(t.rMultiple) ? ` · ${t.rMultiple.toFixed(2)}R` : ''}`,
          end: n(signed(t.realizedTwd), tone(t.realizedTwd)), end2: n(pct(t.returnPct), tone(t.realizedTwd))
        })).join('')}</ul>` : '<div class="empty">還沒有完整平倉的交易</div>');
    } else if (ui.perf === 'long') {
      const b = p.byBucket.long, r = b.returns;
      const trips = p.roundTrips.filter(t => t.bucket === 'long');
      body = section('長期報酬', `<div class="stats">
          ${stat('市值', money(b.mktTwd))}
          ${stat('成本', money(b.costTwd))}
          ${stat('未實現', signed(b.unrealized), `股價 ${signed(b.priceEffect)} · 匯率 ${signed(b.fxEffect)}`, tone(b.unrealized))}
          ${stat('已實現', signed(b.realizedTwd), '', tone(b.realizedTwd))}
          ${stat('資金加權報酬', ok(r.period) ? pct(r.period * 100) : '—', ok(r.days) ? `過去 ${Math.round(r.days)} 天` : '', tone(r.period))}
          ${stat('年化（XIRR）', r.showAnnual ? pct(r.annual * 100) : '累積中', r.showAnnual ? '' : '滿 90 天才顯示，期間太短年化會失真', r.showAnnual ? tone(r.annual) : '')}
        </div>`, { note: '資金加權報酬會考慮每次加碼的時間與金額，比「損益 ÷ 成本」更能反映分批買進的真實表現' }) +
        section('各檔貢獻', `<ul class="rows">${b.rows.sort((x, y) => (y.unrealized || 0) - (x.unrealized || 0)).map(x => row({
          lead: `<i class="dot" style="background:${COLORS.long}"></i>`, title: esc(x.ticker), sub: `成本 ${money(x.costTwd)} · 市值 ${money(x.mktTwd)}`,
          end: n(signed(x.unrealized), tone(x.unrealized)), end2: n(pct(x.unrealizedPct, 1), tone(x.unrealized))
        })).join('') || '<li class="empty">沒有長期持倉</li>'}${trips.map(t => row({ title: `${esc(t.ticker)}（已出清）`, sub: `${day(t.open)} → ${day(t.close)}`, end: n(signed(t.realizedTwd), tone(t.realizedTwd)) })).join('')}</ul>`) +
        loanSection(p);
    } else {
      const bn = p.binance, s = p.strategy;
      body = section('幣安損益', `<div class="stats">
          ${stat('最新總資產', money(bn.latest ? bn.latest.totalTwd : NaN), bn.latest ? `快照 ${day(bn.latest.date)}（${ago(bn.latest.date)}）` : '尚未設定')}
          ${stat('快照前淨投入', money(bn.netFunding), bn.hasEstimate ? '含以匯率估算的項目' : '')}
          ${stat('損益', signed(bn.pnl), '最新總資產 − 快照前淨投入', tone(bn.pnl))}
          ${stat('報酬率', ok(bn.pnl) && bn.netFunding > 0 ? pct(bn.pnl / bn.netFunding * 100) : '—', '', tone(bn.pnl))}
        </div>`, { note: bn.later.length ? `快照之後又轉入 ${money(bn.laterFunding)} 元，要等下一次快照才能算進損益` : '' }) +
        section('策略紀錄（USDT）', `<div class="stats">
          ${stat('策略數', s.count + ' 個')}
          ${stat('合計', signed(s.totalUsdt, 2) + ' U', '', tone(s.totalUsdt))}
          ${stat('勝率', ok(s.winRate) ? s.winRate.toFixed(1) + '%' : '—')}
          ${stat('獲利因子', ok(s.profitFactor) ? s.profitFactor.toFixed(2) : '—')}
        </div><ul class="rows">${db.binance.strategies.slice().sort((a, b) => C.time(b.close) - C.time(a.close)).map(x => row({
          title: esc(x.name), sub: `${day(x.open)} → ${day(x.close)}${x.mode ? ' · ' + esc(MODE_LABEL[x.mode] || x.mode) : ''}`,
          end: n(signed(x.pnlUsdt, 2) + ' U', tone(x.pnlUsdt)), end2: ok(x.returnPct) ? n(pct(x.returnPct), tone(x.pnlUsdt)) : ''
        })).join('')}</ul>`, { action: '<button class="btn btn-small" data-act="strategy">新增策略</button>', note: '策略損益已經包含在幣安總資產裡，這裡只用來檢討策略，不會重複計入' });
    }
    $('view-performance').innerHTML = `<div class="segmented" role="group" aria-label="績效類別">${tabs.map(([k, l]) => `<button data-perf="${k}" aria-pressed="${ui.perf === k}">${l}</button>`).join('')}</div>` + body;
    if (ui.perf === 'swing') {
      const curve = [{ x: C.time(p.swingStats.curve[0]?.date) - 864e5, y: 0, label: '起點' }, ...p.swingStats.curve.map(c => ({ x: C.time(c.date), y: c.value, label: `${day(c.date)} ${c.ticker} ${signed(c.pnl)}` }))];
      Charts.lineChart($('swingChart'), p.swingStats.curve.length ? curve : [], { format: v => short(v), zeroLine: true, stepped: true, ariaLabel: '波段已實現損益累積', emptyText: '還沒有完整平倉的交易' });
    }
  }

  function loanSection(p) {
    const L = db.loan;
    if (!L.principal) return '';
    const outstanding = L.principal - L.principalRepaid;
    const covered = ok(p.grossPnl) ? p.grossPnl - p.financing : NaN;
    return section('信貸成本', `<ul class="rows">
      ${row({ title: '信貸本金', sub: `已還 ${money(L.principalRepaid)}`, end: n(money(outstanding)) })}
      ${row({ title: '年利率', end: n(L.apr ? L.apr + '%' : '未設定') })}
      ${row({ title: '已付成本', sub: `開辦費 ${money(L.fee)} ＋ 利息 ${money(L.interestPaid)}`, end: n('−' + money(p.financing), 'down') })}
      ${row({ title: '投資損益扣掉成本', cls: 'total', end: n(signed(covered), tone(covered)) })}
    </ul>`, { note: '用借來的錢投資，關鍵是報酬有沒有贏過利息', action: '<button class="btn btn-small" data-act="loan">編輯</button>' });
  }

  /* ----- funds ----- */
  function renderFunds(p) {
    const b = p.bank;
    const bankHtml = b.configured ? `<ul class="rows">
        ${row({ title: '上次核對餘額', sub: `${dayTime(b.anchor.date)}（${ago(b.anchor.date)}）`, end: n(money(b.anchor.balance)) })}
        ${b.flows.map(f => row({ title: esc(f.label), cls: 'indent', sub: dayTime(f.date), end: n(signed(f.amount), tone(f.amount)) })).join('')}
        ${row({ title: '目前應有餘額', cls: 'total', end: n(money(b.expected)) })}
        ${b.pending.length ? row({ title: `待交割 ${b.pending.length} 筆`, sub: '暫估金額', end: n(signed(b.pendingTotal), tone(b.pendingTotal)) }) : ''}
        ${row({ title: '交割後預估', end: n(money(b.afterPending)) })}
        ${row({ title: '圈存', sub: '上次核對時', end: n(money(b.anchor.reserved)) })}
      </ul>` : '<div class="empty">還沒有輸入交割戶餘額</div>';
    const bn = p.binance;
    const binanceHtml = `<ul class="rows">
        ${row({ title: '最新總資產', sub: bn.latest ? `${dayTime(bn.latest.date)}（${ago(bn.latest.date)}）` : '尚未設定', end: n(money(bn.latest ? bn.latest.totalTwd : NaN)) })}
        ${bn.later.length ? row({ title: '快照後轉入', cls: 'indent', end: n(signed(bn.laterFunding), tone(bn.laterFunding)) }) : ''}
        ${row({ title: '目前估值', cls: 'total', end: n(money(bn.value)) })}
        ${Object.entries(bn.bySource).map(([k, v]) => row({ title: `投入：${C.SOURCE_LABEL[k] || k}`, cls: 'indent', end: n(money(v)) })).join('')}
        ${row({ title: '損益', end: n(signed(bn.pnl), tone(bn.pnl)) })}
      </ul>`;
    const capHtml = `<ul class="rows">${['long', 'swing'].map(k => {
      const x = p.byBucket[k];
      return row({ lead: `<i class="dot" style="background:${COLORS[k]}"></i>`, title: bucketName(k) + '本金', sub: `持倉成本 ${money(x.costTwd)} · 已實現 ${signed(x.realizedTwd)}`, end: n(money(x.capital)), end2: n('可動用 ' + money(x.available), x.available < 0 ? 'down' : '') });
    }).join('')}
      ${db.reserve.loanPayment || db.reserve.emergency ? row({ title: '保留資金（不投入）', sub: `信貸扣款 ${money(db.reserve.loanPayment)} · 緊急預備金 ${money(db.reserve.emergency)}`, end: n(money(db.reserve.loanPayment + db.reserve.emergency)) }) : ''}
      ${db.sources.loan || db.sources.self || db.sources.family ? row({ title: '資金來源', sub: `${db.sources.asOf ? day(db.sources.asOf) + ' · ' : ''}信貸 ${money(db.sources.loan)} · 自有 ${money(db.sources.self)} · 家人 ${money(db.sources.family)}` }) : ''}
    </ul>`;
    const events = db.cashEvents.slice().sort((a, b2) => C.time(b2.date) - C.time(a.date));
    const evHtml = events.length ? `<ul class="rows">${events.map(e => row({
      title: `${C.EVENT_LABEL[e.type] || '未知'}${e.bucket ? `<span class="tag">${bucketName(e.bucket)}</span>` : ''}${e.source ? `<span class="tag">${C.SOURCE_LABEL[e.source]}</span>` : ''}${e.estimated ? '<span class="tag">估算</span>' : ''}`,
      sub: `${day(e.date)}${e.note ? ' · ' + esc(e.note) : ''}`, end: n(money(e.amountTwd)), cls: 'clickable', attrs: `data-act="event" data-id="${esc(e.id)}"`
    })).join('')}</ul>` : '<div class="empty">還沒有資金紀錄</div>';

    $('view-funds').innerHTML =
      `<div class="two-col">` +
      section('交割戶', bankHtml, { action: '<button class="btn btn-small btn-primary" data-act="bank">核對餘額</button>', note: '餘額 = 上次核對 ＋ 之後的交割與轉帳；核對時有差額會直接告訴你差多少' }) +
      section('幣安', binanceHtml, { action: '<button class="btn btn-small btn-primary" data-act="binance">更新總資產</button>', note: '損益 = 最新總資產 − 快照當時以前的淨投入' }) +
      `</div>` +
      section('配置本金', capHtml, { action: '<button class="btn btn-small" data-act="cashEvent">記錄資金</button>', note: '可動用 = 本金 − 持倉成本 ＋ 已實現；轉入幣安的錢從波段本金扣除' }) +
      loanSection(p) +
      section('資金紀錄', evHtml);
  }

  function openEvent(id) {
    const e = db.cashEvents.find(x => x.id === id);
    if (!e) return;
    openSheet({
      title: C.EVENT_LABEL[e.type] || '資金紀錄',
      body: `<ul class="rows" style="padding:0">
        ${row({ title: '日期', end: n(dayTime(e.date)) })}
        ${row({ title: '金額', end: n(money(e.amountTwd)) })}
        ${e.bucket ? row({ title: '影響本金', end: n(bucketName(e.bucket)) }) : ''}
        ${e.source ? row({ title: '資金來源', end: n(C.SOURCE_LABEL[e.source]) }) : ''}
        ${row({ title: '經過交割戶', end: n(e.viaBank ? '是' : '否') })}
        ${e.note ? row({ title: '備註', sub: esc(e.note) }) : ''}
      </ul>`,
      submitLabel: '',
      extra: '<button type="button" class="btn btn-danger" data-sheet-delete>刪除這筆</button>',
      onExtra: () => {
        if (!confirm('確定刪除這筆資金紀錄？')) return false;
        const next = C.clone(db); next.cashEvents = next.cashEvents.filter(x => x.id !== id);
        return commit(next, '刪除資金紀錄', '資金紀錄已刪除');
      }
    });
  }

  /* ----- settings ----- */
  function renderSettings() {
    const fx = db.fx.USDTWD;
    const history = store.readHistory();
    $('view-settings').innerHTML =
      section('匯率', `<ul class="rows">${row({ title: 'USD/TWD 參考匯率', sub: fx.rate ? `${esc(fx.source)} · ${ago(fx.asOf)}` : '尚未設定', end: n(fx.rate ? fx.rate.toFixed(4) : '—') })}</ul>
        <div class="btn-row" style="padding:0 16px 14px"><button class="btn" data-act="refresh">自動更新</button><button class="btn" data-act="fxManual">手動輸入</button></div>`,
        { note: '用來估算美股市值的中間價。實際交割匯率會在核銷時依銀行金額回填，不受這裡影響' }) +
      section('美股報價', `<div class="btn-row" style="padding:0 16px 14px"><button class="btn" data-act="finnhub">${store.getKey() ? '更換 Finnhub 金鑰' : '設定 Finnhub 金鑰'}</button>${store.getKey() ? '<button class="btn btn-danger" data-act="finnhubRemove">移除金鑰</button>' : ''}</div>`,
        { note: store.getKey() ? '已設定。金鑰只存在這台裝置，不會進備份檔' : '到 finnhub.io 免費註冊取得金鑰，就能自動更新美股報價。台股請用手動報價' }) +
      section('顯示', `<div style="padding:0 16px 14px"><div class="segmented" style="margin:0" role="group" aria-label="漲跌顏色"><button data-setupdown="red" aria-pressed="${db.settings.upColor !== 'green'}">紅漲綠跌</button><button data-setupdown="green" aria-pressed="${db.settings.upColor === 'green'}">綠漲紅跌</button></div></div>`) +
      section('備份', `<ul class="rows">${row({ title: '上次匯出', end: n(db.meta.lastExportAt ? ago(db.meta.lastExportAt) : '從未匯出') })}</ul>
        <div class="btn-row" style="padding:0 16px 14px"><button class="btn btn-primary" data-act="export">匯出備份</button><button class="btn" data-act="import">匯入備份</button></div>`,
        { note: '資料只存在這支手機的瀏覽器裡。換手機或清除瀏覽器資料前一定要先匯出；可以匯入舊版 Wealth Ledger 的備份' }) +
      section('還原紀錄', history.length ? `<ul class="rows">${history.map((h, i) => row({ title: esc(h.reason), sub: dayTime(h.at), end: `<button class="btn btn-small" data-act="restore" data-index="${i}">還原</button>` })).join('')}</ul>` : '<div class="empty">還沒有修改紀錄</div>',
        { note: `每次修改前都會自動保留前一個版本（最多 ${window.Storage.HISTORY_LIMIT} 個），改錯可以從這裡救回來` }) +
      section('清除資料', `<div style="padding:0 16px 14px"><button class="btn btn-danger" data-act="wipe">清除這台裝置的所有資料</button></div>`) +
      `<p class="muted small" style="text-align:center">Stock Claude ${APP_VERSION}</p>`;
  }

  /* ----- welcome & recovery ----- */
  function renderWelcome() {
    $('view-overview').innerHTML = `<div class="notice-page"><h2>開始記帳</h2>
      <p>匯入舊版 Wealth Ledger 的備份，會自動轉換所有交易、資金與幣安紀錄。也可以從零開始。</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="import">匯入備份檔</button><button class="btn" data-act="bank">從零開始：先輸入交割戶餘額</button></div></div>`;
    ['holdings', 'trades', 'performance', 'funds'].forEach(v => { $('view-' + v).innerHTML = '<div class="empty">先到總覽匯入備份或輸入交割戶餘額</div>'; });
    renderSettings();
  }

  function renderRecovery() {
    const history = store.readHistory();
    $('view-overview').innerHTML = `<div class="notice-page"><h2>資料讀取失敗，已暫停儲存</h2>
      <p>原因：${esc(store.recoveryReason)}。原始資料沒有被覆蓋，你可以先下載它保存，再從還原紀錄或備份檔救回。</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="rescue">下載原始資料</button><button class="btn" data-act="import">匯入備份檔</button></div></div>` +
      section('還原紀錄', history.length ? `<ul class="rows">${history.map((h, i) => row({ title: esc(h.reason), sub: dayTime(h.at), end: `<button class="btn btn-small" data-act="restore" data-index="${i}">還原</button>` })).join('')}</ul>` : '<div class="empty">沒有可還原的版本</div>');
    ['holdings', 'trades', 'performance', 'funds', 'settings'].forEach(v => { $('view-' + v).innerHTML = '<div class="empty">資料救回之前，這一頁暫時無法使用</div>'; });
    showView('overview');
  }

  /* ---------- sheet (dialog) ---------- */
  function openSheet({ title, body, submitLabel = '儲存', onSubmit, extra = '', onExtra, onInput }) {
    const sheet = $('sheet');
    sheet.innerHTML = `<form method="dialog" novalidate>
      <div class="sheet-head"><h2 id="sheetTitle">${esc(title)}</h2><button type="button" class="icon-btn" data-sheet-close aria-label="關閉">${ICON.close}</button></div>
      <div class="sheet-body">${body}<p class="form-error" id="sheetError" hidden></p></div>
      ${submitLabel || extra ? `<div class="sheet-foot">${extra}<span style="flex:1"></span>${submitLabel ? `<button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>` : ''}</div>` : ''}
    </form>`;
    const form = sheet.querySelector('form');
    sheet.querySelector('[data-sheet-close]').onclick = () => sheet.close();
    const err = $('sheetError');
    const fail = m => { err.hidden = false; err.textContent = m; };
    form.onsubmit = ev => {
      ev.preventDefault();
      if (!onSubmit) { sheet.close(); return; }
      err.hidden = true;
      try { if (onSubmit(form, fail) !== false) sheet.close(); } catch (e) { fail(e.message); }
    };
    const del = sheet.querySelector('[data-sheet-delete]');
    if (del && onExtra) del.onclick = () => { if (onExtra() !== false) sheet.close(); };
    if (onInput) { form.oninput = () => onInput(form); onInput(form); }
    sheet.showModal();
    return form;
  }

  const field = (name, label, { type = 'number', value = '', attrs = '', hint = '', full = false } = {}) =>
    `<div class="field${full ? ' full' : ''}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  const select = (name, label, options, value, full = false) =>
    `<div class="field${full ? ' full' : ''}"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  const val = (form, name) => (form.elements[name] ? form.elements[name].value.trim() : '');
  const numVal = (form, name) => C.num(val(form, name));
  const checked = (form, name) => Boolean(form.elements[name] && form.elements[name].checked);

  /* ---------- forms ---------- */
  function openAddTrade() {
    if (store.mode !== 'normal') return;
    const fx = C.fxRate(db);
    openSheet({
      title: '記一筆交易', submitLabel: '新增交易',
      body: `<div class="form-grid">
        ${field('ticker', '代號', { type: 'text', attrs: 'required autocapitalize="characters" autocomplete="off" style="text-transform:uppercase" placeholder="例如 AVGO 或 2330"' })}
        ${select('side', '買賣', [['BUY', '買進'], ['SELL', '賣出'], ['INIT', '期初持倉']], 'BUY')}
        ${select('bucket', '帳戶', [['swing', '波段'], ['long', '長期']], 'swing')}
        ${select('currency', '幣別', [['USD', '美元（美股）'], ['TWD', '台幣（台股）']], 'USD')}
        ${field('qty', '股數', { attrs: 'required min="0"' })}
        ${field('price', '成交價', { attrs: 'required min="0"' })}
        ${field('fee', '手續費', { value: 0, attrs: 'min="0"' })}
        ${field('tax', '交易稅', { value: 0, attrs: 'min="0"' })}
        ${field('date', '成交時間', { type: 'datetime-local', full: true, value: localInput(), attrs: 'required' })}
        ${field('fx', '參考匯率', { value: ok(fx) ? fx : '', hint: '先用參考值，交割後再回填實際匯率' })}
        ${field('stop', '停損價（選填）', { hint: '填了才能計算 R 倍數' })}
        ${field('name', '名稱（選填）', { type: 'text' })}
        <label class="check"><input type="checkbox" name="settled"> 銀行已經扣款／入帳（而且匯率是實際交割匯率）</label>
        <div class="preview" id="tradePreview"></div>
      </div>`,
      onInput: form => {
        const ticker = val(form, 'ticker').toUpperCase();
        const known = db.trades.find(t => t.ticker === ticker);
        if (known && document.activeElement === form.elements.ticker) { form.elements.bucket.value = known.bucket; form.elements.currency.value = known.currency; if (known.name && !val(form, 'name')) form.elements.name.value = known.name; }
        const twdCur = val(form, 'currency') === 'TWD';
        form.elements.fx.disabled = twdCur;
        const side = val(form, 'side');
        form.elements.settled.disabled = side === 'INIT';
        const amount = numVal(form, 'qty') * numVal(form, 'price');
        const fees = (numVal(form, 'fee') || 0) + (numVal(form, 'tax') || 0);
        const base = side === 'SELL' ? amount - fees : amount + fees;
        const rate = twdCur ? 1 : numVal(form, 'fx');
        $('tradePreview').textContent = ok(base) && base > 0 ? `${side === 'SELL' ? '入帳' : '扣款'}約 NT$${money(base * rate)}${twdCur ? '' : `（${money(base, 2)} USD）`}` : '填入股數與價格後會顯示台幣金額';
      },
      onSubmit: form => {
        const currency = val(form, 'currency');
        const side = val(form, 'side');
        const t = C.normalizeTrade({
          id: C.uid(), date: val(form, 'date'), bucket: val(form, 'bucket'), ticker: val(form, 'ticker'), name: val(form, 'name'),
          currency, side, qty: numVal(form, 'qty'), price: numVal(form, 'price'), fee: numVal(form, 'fee') || 0, tax: numVal(form, 'tax') || 0,
          fx: currency === 'TWD' ? 1 : numVal(form, 'fx'), stop: val(form, 'stop') ? numVal(form, 'stop') : null,
          fxStatus: checked(form, 'settled') || currency === 'TWD' ? 'final' : 'estimate',
          settledAt: checked(form, 'settled') && side !== 'INIT' ? C.nowIso() : null
        }, 0, []);
        if (t._invalid) throw Error(`請確認${t._invalid}`);
        const next = C.clone(db); next.trades.push(t);
        const before = C.computePositions(db).issues;
        const issues = C.computePositions(next).issues.filter(i => !before.includes(i));
        if (issues.length) throw Error(issues.join('；'));
        if (commit(next, `新增 ${t.ticker} ${sideName(side)}`, `${t.ticker} ${sideName(side)}已記錄`)) { refreshQuotes(false); return true; }
        return false;
      }
    });
  }

  function openSettle() {
    const ids = [...document.querySelectorAll('.settle-pick:checked')].map(x => x.value);
    const trades = ids.map(id => db.trades.find(t => t.id === id)).filter(Boolean);
    if (!trades.length) return;
    const currency = trades[0].currency;
    const netBase = trades.reduce((s, t) => s + (t.side === 'BUY' ? 1 : -1) * C.tradeBaseAmount(t), 0);
    const dir = netBase >= 0 ? '扣款' : '入帳';
    const small = currency === 'USD' && Math.abs(netBase) < C.SMALL_NET_USD;
    openSheet({
      title: `核銷 ${trades.length} 筆交割`, submitLabel: '完成核銷',
      body: `<div class="form-grid">
        <div class="preview full">${trades.map(t => `${esc(t.ticker)} ${sideName(t.side)} ${qty(t.qty)} 股`).join('、')}<br>${currency} 淨額 <strong>${money(Math.abs(netBase), 2)}</strong>，銀行應為${dir}</div>
        ${field('settledAt', '銀行實際' + dir + '日', { type: 'datetime-local', full: true, value: localInput(), attrs: 'required' })}
        ${currency === 'USD' ? field('actualTwd', `銀行實際${dir}（台幣）`, { attrs: small ? 'disabled' : '', hint: small ? '淨額太小，請改填成交匯率' : '輸入一次，系統會反算整批匯率' }) : field('actualTwd', `銀行實際${dir}（台幣）`)}
        ${currency === 'USD' ? field('actualFx', '或：銀行成交匯率', { hint: '和台幣金額擇一填寫' }) : ''}
        <div class="preview" id="settlePreview"></div>
      </div>`,
      onInput: form => {
        const out = $('settlePreview');
        try {
          const r = C.settleBatch(db, { ids, settledAt: val(form, 'settledAt') || C.nowIso(), actualTwd: numVal(form, 'actualTwd'), actualFx: numVal(form, 'actualFx'), referenceFx: C.fxRate(db) });
          out.className = 'preview' + (r.warnings.length ? ' warn' : '');
          out.innerHTML = `整批匯率 <strong>${r.rate.toFixed(4)}</strong> · 銀行${dir} NT$${money(Math.abs(r.netTwd))}${r.warnings.map(w => '<br>' + esc(w)).join('')}`;
        } catch (e) { out.className = 'preview'; out.textContent = e.message; }
      },
      onSubmit: form => {
        const r = C.settleBatch(db, { ids, settledAt: val(form, 'settledAt'), actualTwd: numVal(form, 'actualTwd'), actualFx: numVal(form, 'actualFx'), referenceFx: C.fxRate(db) });
        if (r.warnings.length && !confirm(r.warnings.join('\n') + '\n\n確定要用這個匯率完成核銷嗎？')) return false;
        return commit(r.db, `核銷 ${ids.length} 筆交割`, `已核銷 ${ids.length} 筆，匯率 ${r.rate.toFixed(4)}`);
      }
    });
  }

  function openBank() {
    if (store.mode !== 'normal') return;
    const p = db.bank.snapshots.length ? C.portfolio(db) : null;
    const expected = p ? p.bank.expected : NaN;
    openSheet({
      title: '核對交割戶餘額', submitLabel: '記錄餘額',
      body: `<div class="form-grid">
        ${field('date', '查詢時間', { type: 'datetime-local', full: true, value: localInput(), attrs: 'required' })}
        ${field('balance', '銀行帳面餘額', { attrs: 'required min="0"', hint: ok(expected) ? `系統推算應為 ${money(expected)}` : '' })}
        ${field('reserved', '圈存金額', { value: 0, attrs: 'min="0"' })}
        ${field('note', '備註（選填）', { type: 'text' })}
        <div class="preview" id="bankPreview"></div>
      </div>`,
      onInput: form => {
        const bal = numVal(form, 'balance'), out = $('bankPreview');
        if (!ok(bal) || !ok(expected)) { out.className = 'preview'; out.textContent = ok(expected) ? '輸入銀行顯示的帳面餘額' : '第一次輸入，之後的交割與轉帳都會從這個數字往下推算'; return; }
        const diff = bal - expected;
        out.className = 'preview' + (Math.abs(diff) > 1 ? ' warn' : '');
        out.textContent = Math.abs(diff) <= 1 ? '和系統推算一致 ✓' : `比系統推算${diff > 0 ? '多' : '少'} ${money(Math.abs(diff))} 元。可能有漏記的交割、轉帳或利息，記錄後差額會從這個時間點歸零`;
      },
      onSubmit: form => {
        const balance = numVal(form, 'balance'), reserved = numVal(form, 'reserved') || 0;
        if (!(balance >= 0)) throw Error('請填銀行帳面餘額');
        if (reserved < 0 || reserved > balance) throw Error('圈存金額不能大於帳面餘額');
        const date = C.normalizeTime(val(form, 'date'));
        if (!date) throw Error('請填查詢時間');
        const next = C.clone(db);
        const diff = ok(expected) ? balance - expected : 0;
        next.bank.snapshots.push({ id: C.uid(), date, balance, reserved, note: val(form, 'note') + (Math.abs(diff) > 1 ? `（與推算差 ${Math.round(diff)}）` : '') });
        return commit(next, '核對交割戶餘額', Math.abs(diff) > 1 ? `已記錄，與推算差 ${signed(diff)} 元` : '交割戶餘額已記錄');
      }
    });
  }

  function openBinance() {
    if (store.mode !== 'normal') return;
    const fx = C.fxRate(db);
    openSheet({
      title: '更新幣安總資產', submitLabel: '記錄總資產',
      body: `<div class="form-grid">
        ${field('date', '查詢時間', { type: 'datetime-local', full: true, value: localInput(), attrs: 'required' })}
        ${field('total', '總資產（台幣）', { hint: '幣安「資產總覽」的台幣估值' })}
        ${field('usdt', '或：總資產（USDT）', { hint: ok(fx) ? `以 ${fx} 換算` : '需要先設定匯率' })}
        ${field('note', '備註（選填）', { type: 'text' })}
        <p class="section-note full" style="padding:0">這只是記錄目前的價值，不會新增投入或損益。</p>
      </div>`,
      onSubmit: form => {
        let total = numVal(form, 'total');
        if (!ok(total) && ok(numVal(form, 'usdt')) && ok(fx)) total = numVal(form, 'usdt') * fx;
        if (!(total >= 0)) throw Error('請填台幣或 USDT 總資產');
        const date = C.normalizeTime(val(form, 'date'));
        const next = C.clone(db);
        next.binance.snapshots.push({ id: C.uid(), date, totalTwd: Math.round(total), note: val(form, 'note') });
        return commit(next, '更新幣安總資產', '幣安總資產已更新');
      }
    });
  }

  function openCashEvent() {
    if (store.mode !== 'normal') return;
    const types = [['contribution', '新增投入到交割戶'], ['to_binance', '交割戶轉入幣安'], ['binance_in', '其他資金直接入金幣安'], ['from_binance', '幣安出金'], ['withdrawal', '從交割戶提領'], ['allocation', '調整配置本金（不動用現金）'], ['income', '股利／手續費折讓／利息入帳']];
    openSheet({
      title: '記錄資金', submitLabel: '新增紀錄',
      body: `<div class="form-grid">
        ${select('type', '類型', types, 'contribution', true)}
        ${field('amount', '金額（台幣）', { attrs: 'required min="0"' })}
        ${field('date', '日期時間', { type: 'datetime-local', full: true, value: localInput(), attrs: 'required' })}
        ${select('bucket', '影響哪個本金', [['swing', '波段'], ['long', '長期'], ['', '都不影響']], 'swing')}
        ${select('source', '資金來源', [['', '不指定'], ['self', '自有'], ['loan', '信貸'], ['family', '家人'], ['other', '其他']], '')}
        <div class="preview" id="eventPreview"></div>
      </div>`,
      onInput: form => {
        const type = val(form, 'type');
        const text = {
          contribution: '交割戶餘額增加，所選帳戶的本金增加',
          to_binance: '交割戶餘額減少，幣安投入增加；預設從波段本金扣除',
          binance_in: '不經過交割戶（例如信貸直接換 USDT），幣安投入增加',
          from_binance: '幣安投入減少，錢回到交割戶與所選本金',
          withdrawal: '交割戶餘額減少，所選本金減少',
          allocation: '只調整本金數字，不影響交割戶餘額（例如重新分配長期／波段）',
          income: '交割戶餘額增加，計入投資損益（不算投入本金）'
        }[type];
        $('eventPreview').textContent = text;
      },
      onSubmit: form => {
        const type = val(form, 'type');
        const e = C.normalizeEvent({
          id: C.uid(), type, date: val(form, 'date'), amountTwd: numVal(form, 'amount'),
          bucket: type === 'income' ? null : (val(form, 'bucket') || null), source: val(form, 'source') || null,
          viaBank: ['contribution', 'to_binance', 'from_binance', 'withdrawal', 'income'].includes(type)
        }, 0, []);
        if (e._invalid) throw Error('請填金額與日期');
        const next = C.clone(db); next.cashEvents.push(e);
        return commit(next, C.EVENT_LABEL[type], `${C.EVENT_LABEL[type]}已記錄`);
      }
    });
  }

  function openStrategy() {
    if (store.mode !== 'normal') return;
    openSheet({
      title: '新增幣安策略結果', submitLabel: '新增策略',
      body: `<div class="form-grid">
        ${field('name', '策略名稱', { type: 'text', value: 'BTCUSDT-GRID', attrs: 'required' })}
        ${field('mode', '模式（選填）', { type: 'text', attrs: 'placeholder="例如 做多網格"' })}
        ${field('open', '開始時間', { type: 'datetime-local', full: true, attrs: 'required' })}
        ${field('close', '結束時間', { type: 'datetime-local', full: true, value: localInput(), attrs: 'required' })}
        ${field('pnl', '總收益（USDT）', { attrs: 'required' })}
        ${field('margin', '投入保證金（USDT）')}
        ${field('returnPct', '報酬率（%）')}
        ${field('leverage', '槓桿（選填）')}
      </div>`,
      onSubmit: form => {
        const s = { id: C.uid(), name: val(form, 'name').toUpperCase(), mode: val(form, 'mode'), open: C.normalizeTime(val(form, 'open')), close: C.normalizeTime(val(form, 'close')), pnlUsdt: numVal(form, 'pnl'), marginUsdt: numVal(form, 'margin'), returnPct: numVal(form, 'returnPct'), leverage: C.num(val(form, 'leverage'), null) };
        if (!s.name || !s.open || !s.close || !ok(s.pnlUsdt)) throw Error('請填名稱、時間與收益');
        if (!ok(s.returnPct) && s.marginUsdt > 0) s.returnPct = s.pnlUsdt / s.marginUsdt * 100;
        const next = C.clone(db); next.binance.strategies.push(s);
        return commit(next, '新增幣安策略', '策略已新增');
      }
    });
  }

  function openQuote() {
    const tickers = [...new Set(C.portfolio(db).positions.map(r => r.ticker))];
    openSheet({
      title: '手動報價', submitLabel: '儲存報價',
      body: `<div class="form-grid">
        ${select('ticker', '代號', tickers.map(t => [t, t]), tickers[0], true)}
        ${field('price', '目前價格', { attrs: 'required min="0"' })}
        ${select('currency', '幣別', [['USD', 'USD'], ['TWD', 'TWD']], 'USD')}
      </div>`,
      onInput: form => {
        const pos = C.portfolio(db).positions.find(r => r.ticker === val(form, 'ticker'));
        if (pos && document.activeElement === form.elements.ticker) form.elements.currency.value = pos.currency;
      },
      onSubmit: form => {
        const price = numVal(form, 'price');
        if (!(price > 0)) throw Error('請填價格');
        const next = C.clone(db);
        next.quotes[val(form, 'ticker')] = { price, currency: val(form, 'currency'), asOf: C.nowIso(), source: '手動' };
        return commit(next, `${val(form, 'ticker')} 手動報價`, '報價已更新');
      }
    });
  }

  function openLoan() {
    const L = db.loan;
    openSheet({
      title: '信貸設定', submitLabel: '儲存',
      body: `<div class="form-grid">
        ${field('principal', '原始本金', { value: L.principal })}
        ${field('apr', '年利率（%）', { value: L.apr ?? '' })}
        ${field('fee', '開辦費', { value: L.fee })}
        ${field('interestPaid', '累計已付利息', { value: L.interestPaid })}
        ${field('principalRepaid', '累計已還本金', { value: L.principalRepaid })}
        ${field('startDate', '撥款日', { type: 'date', value: L.startDate })}
      </div>`,
      onSubmit: form => {
        const next = C.clone(db);
        next.loan = { principal: numVal(form, 'principal') || 0, apr: numVal(form, 'apr') > 0 ? numVal(form, 'apr') : null, fee: numVal(form, 'fee') || 0, interestPaid: numVal(form, 'interestPaid') || 0, principalRepaid: numVal(form, 'principalRepaid') || 0, startDate: val(form, 'startDate') };
        if (next.loan.principalRepaid > next.loan.principal) throw Error('已還本金不能大於原始本金');
        return commit(next, '更新信貸設定', '信貸設定已更新');
      }
    });
  }

  function openFxManual() {
    openSheet({
      title: '手動輸入匯率', submitLabel: '儲存',
      body: `<div class="form-grid">${field('rate', 'USD/TWD', { value: db.fx.USDTWD.rate || '', attrs: 'required', full: true })}</div>`,
      onSubmit: form => {
        const rate = numVal(form, 'rate');
        if (!(rate > 20 && rate < 50)) throw Error('匯率看起來不合理，請確認');
        const next = C.clone(db); next.fx.USDTWD = { rate, asOf: C.nowIso(), source: '手動' };
        return commit(next, '手動輸入匯率', '匯率已更新');
      }
    });
  }

  function openFinnhub() {
    openSheet({
      title: 'Finnhub 金鑰', submitLabel: '儲存並更新報價',
      body: `<div class="form-grid">${field('key', 'API 金鑰', { type: 'password', attrs: 'required autocomplete="off"', full: true, hint: '只存在這台裝置，不會寫進備份檔，也不會上傳到 GitHub' })}</div>`,
      onSubmit: form => {
        const key = val(form, 'key');
        if (!key) throw Error('請貼上金鑰');
        store.setKey(key); renderSettings(); refreshQuotes(true);
        return true;
      }
    });
  }

  /* ---------- market refresh ---------- */
  async function refreshQuotes(force = true) {
    if (ui.busy || store.mode !== 'normal') return;
    ui.busy = true;
    const btn = $('refreshButton'); btn.disabled = true;
    const msgs = [], errors = [];
    let next = C.clone(db);
    try {
      const fx = db.fx.USDTWD;
      if (force || !fx.rate || Date.now() - C.time(fx.asOf) > 6 * 36e5) {
        try { const r = await Market.usdTwd(); next.fx.USDTWD = { rate: r.rate, asOf: C.nowIso(), source: r.source }; msgs.push(`匯率 ${r.rate}`); }
        catch (e) { errors.push(e.message); }
      }
      const key = store.getKey();
      if (key) {
        const tickers = [...new Set(C.computePositions(db).open.filter(p => p.currency === 'USD').map(p => p.ticker))]
          .filter(t => force || !db.quotes[t] || Date.now() - C.time(db.quotes[t].asOf) > 2 * 36e5);
        const results = await Promise.allSettled(tickers.map(t => Market.finnhubQuote(t, key)));
        let count = 0;
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') { next.quotes[tickers[i]] = { price: r.value.price, currency: 'USD', asOf: C.normalizeTime(r.value.asOf), source: r.value.source }; count++; }
          else errors.push(`${tickers[i]}：${r.reason.message}`);
        });
        if (count) msgs.push(`${count} 檔報價`);
      } else if (force) errors.push('尚未設定 Finnhub 金鑰，美股報價請到設定頁設定或手動輸入');
      if (msgs.length) {
        // Market data is not an edit: save without a history version.
        db = store.save(next, '更新行情', { quiet: true });
        render();
      }
      if (errors.length) showError('部分資料沒更新：' + errors.join('；') + '。舊資料仍保留。');
      else if (msgs.length) toast('已更新' + msgs.join('、'));
      else if (force) toast('行情已是最新');
    } catch (e) { showError(e.message); }
    finally { ui.busy = false; btn.disabled = false; }
  }

  /* ---------- import / export ---------- */
  function exportDb() {
    const next = C.clone(db);
    next.meta.lastExportAt = C.nowIso();
    const blob = new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' });
    download(blob, `stock-claude-${C.taipeiDate(Date.now())}.json`);
    try { db = store.save(next, '匯出備份', { quiet: true }); render(); toast('備份已匯出，請存到雲端硬碟或電腦'); }
    catch (e) { showError(e.message); }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function importFile(file) {
    let raw;
    try { raw = JSON.parse(await file.text()); } catch (e) { showError('這個檔案不是有效的 JSON'); return; }
    let result;
    try {
      if (Migrate.isLegacy(raw)) result = Migrate.fromLegacy(raw);
      else { const r = C.normalizeDb(raw); result = { db: r.db, report: { notes: [], warnings: r.warnings, counts: { trades: r.db.trades.length, events: r.db.cashEvents.length, strategies: r.db.binance.strategies.length } } }; }
    } catch (e) { showError('無法匯入：' + e.message); return; }
    const { report } = result;
    const hasData = db.trades.length || db.cashEvents.length;
    openSheet({
      title: Migrate.isLegacy(raw) ? '匯入舊版備份' : '匯入備份', submitLabel: '確認匯入',
      body: `<p>將匯入 <strong>${report.counts.trades}</strong> 筆交易、<strong>${report.counts.events}</strong> 筆資金紀錄、<strong>${report.counts.strategies}</strong> 個幣安策略。</p>
        ${report.notes.length ? `<p class="small muted" style="margin-bottom:4px">轉換時做了這些調整：</p><ul class="report">${report.notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${report.warnings.length ? `<ul class="report" style="color:var(--critical)">${report.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${hasData || store.mode === 'recovery' ? '<p class="preview warn">會取代這台裝置目前的資料。目前的資料會保留在「還原紀錄」，匯入後還能救回。</p>' : ''}`,
      onSubmit: () => {
        try { db = store.replace(result.db, '匯入備份'); }
        catch (e) { showError(e.message); return false; }
        loadWarnings = report.warnings;
        render(); showView('overview'); toast('匯入完成');
        refreshQuotes(false);
        return true;
      }
    });
  }

  /* ---------- feedback ---------- */
  function toast(message) {
    const t = $('toast'); t.textContent = message; t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
  }
  function showError(message) {
    const sheet = $('sheet');
    if (sheet.open) { const err = $('sheetError'); if (err) { err.hidden = false; err.textContent = message; return; } }
    openSheet({ title: '需要處理', body: `<p>${esc(message)}</p>`, submitLabel: '知道了' });
  }

  /* ---------- events ---------- */
  function onClick(ev) {
    const el = ev.target.closest('[data-act],[data-hold],[data-tfilter],[data-perf],[data-setupdown]');
    if (!el || el.disabled) return;
    if (el.dataset.hold) { ui.holdFilter = el.dataset.hold; renderHoldings(C.portfolio(db)); return; }
    if (el.dataset.tfilter) { ui.tradeFilter = el.dataset.tfilter; renderTrades(C.portfolio(db)); return; }
    if (el.dataset.perf) { ui.perf = el.dataset.perf; renderPerformance(C.portfolio(db)); return; }
    if (el.dataset.setupdown) { commit({ ...C.clone(db), settings: { ...db.settings, upColor: el.dataset.setupdown } }, '變更漲跌顏色'); return; }
    const act = el.dataset.act;
    const actions = {
      refresh: () => refreshQuotes(true), bank: openBank, binance: openBinance, export: exportDb, import: () => $('fileInput').click(),
      gotoTrades: () => showView('trades'), gotoFunds: () => showView('funds'), gotoHoldings: () => showView('holdings'),
      addTrade: openAddTrade, settle: openSettle, trade: () => openTrade(el.dataset.id), position: () => openPosition(el.dataset.key),
      event: () => openEvent(el.dataset.id), cashEvent: openCashEvent, strategy: openStrategy, quote: openQuote, loan: openLoan,
      fxManual: openFxManual, finnhub: openFinnhub,
      finnhubRemove: () => { store.setKey(''); renderSettings(); toast('金鑰已從這台裝置移除'); },
      restore: () => {
        if (!confirm('確定還原到這個版本？目前的資料會先保留在還原紀錄裡。')) return;
        try { db = store.restore(Number(el.dataset.index)); render(); showView('overview'); toast('已還原'); } catch (e) { showError(e.message); }
      },
      rescue: () => download(new Blob([store.rescueText()], { type: 'application/json' }), `stock-claude-rescue-${C.taipeiDate(Date.now())}.json`),
      wipe: () => {
        if (!confirm('會清除這台裝置的所有投資資料、還原紀錄與金鑰，而且無法復原。確定已經匯出備份了嗎？')) return;
        store.wipe(); db = C.emptyDb(); render(); showView('overview'); toast('資料已清除');
      }
    };
    if (actions[act]) actions[act]();
  }

  function init() {
    $('tabbar').innerHTML = TABS.map(([k, l]) => `<button type="button" data-view="${k}" aria-current="${k === 'overview' ? 'page' : 'false'}">${ICON[k]}<span>${l}</span></button>`).join('');
    $('refreshButton').innerHTML = ICON.refresh; $('addButton').innerHTML = ICON.plus; $('settingsButton').innerHTML = ICON.settings;
    $('tabbar').addEventListener('click', ev => { const b = ev.target.closest('[data-view]'); if (b) showView(b.dataset.view); });
    $('settingsButton').onclick = () => showView(ui.view === 'settings' ? 'overview' : 'settings');
    $('addButton').onclick = openAddTrade;
    $('refreshButton').onclick = () => refreshQuotes(true);
    document.addEventListener('click', onClick);
    $('fileInput').onchange = ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) importFile(f); };
    render();
    if (loadWarnings.length) showError('部分紀錄格式有誤，已保留但暫不計入：' + loadWarnings.join('；'));
    if (store.mode === 'normal' && (db.trades.length || db.cashEvents.length)) setTimeout(() => refreshQuotes(false), 600);
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  init();
})();
