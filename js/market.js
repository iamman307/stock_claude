/*
 * Market data, fetched from the owner's device. Nothing about the portfolio is
 * sent anywhere except the tickers needed for a quote.
 */
(function (root) {
  'use strict';
  const MAX_QUOTE_AGE = 7 * 864e5;

  function parseFinnhub(payload, fetchedAt = Date.now()) {
    if (payload && payload.error) throw Error(String(payload.error));
    const price = Number(payload && payload.c), ts = Number(payload && payload.t);
    if (!(price > 0) || !(ts > 0)) throw Error('沒有可用的報價');
    const at = ts * 1000;
    if (at > fetchedAt + 5 * 6e4) throw Error('報價時間異常');
    if (fetchedAt - at > MAX_QUOTE_AGE) throw Error('報價超過 7 天，保留舊價格');
    return { price, asOf: new Date(at).toISOString(), source: 'Finnhub' };
  }

  // Finnhub does not allow custom headers in browser (CORS) requests, so the key
  // goes in the query string. The request is HTTPS and the service worker never
  // caches cross-origin URLs, so the key is not stored anywhere on the device.
  async function finnhubQuote(symbol, key, fetcher = root.fetch.bind(root)) {
    const url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol) + '&token=' + encodeURIComponent(key);
    const res = await fetcher(url, { cache: 'no-store' });
    if (!res.ok) throw Error(res.status === 429 ? '請求太頻繁，請稍後再試' : res.status === 401 || res.status === 403 ? '金鑰無效' : '報價服務錯誤 ' + res.status);
    return parseFinnhub(await res.json());
  }

  // Reference mid-market USD/TWD. Bank rates differ by the spread; the actual
  // settlement rate is entered when a trade settles.
  const FX_SOURCES = [
    { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD', pick: j => j && j.result === 'success' ? { rate: j.rates && j.rates.TWD, at: j.time_last_update_unix * 1000 } : null },
    { name: 'currency-api', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', pick: j => j && j.usd ? { rate: j.usd.twd, at: Date.parse(j.date + 'T00:00:00Z') } : null }
  ];

  async function usdTwd(fetcher = root.fetch.bind(root)) {
    const errors = [];
    for (const src of FX_SOURCES) {
      try {
        const res = await fetcher(src.url, { cache: 'no-store' });
        if (!res.ok) throw Error('HTTP ' + res.status);
        const got = src.pick(await res.json());
        if (!got || !(got.rate > 20 && got.rate < 50)) throw Error('匯率數值異常');
        return { rate: Math.round(got.rate * 10000) / 10000, asOf: new Date(Number.isFinite(got.at) ? got.at : Date.now()).toISOString(), source: src.name };
      } catch (e) { errors.push(src.name + '：' + e.message); }
    }
    throw Error('匯率抓取失敗（' + errors.join('；') + '）');
  }

  const api = { parseFinnhub, finnhubQuote, usdTwd, FX_SOURCES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Market = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
