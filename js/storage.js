/*
 * Local storage with three safety rules:
 * 1. A stored database that cannot be read is NEVER replaced. The app opens in
 *    recovery mode with saving switched off until the owner restores or imports.
 * 2. Every save keeps the previous version in a rolling history.
 * 3. A failed write is reported, never swallowed.
 */
(function (root) {
  'use strict';
  const Core = root.Core || (typeof require === 'function' ? require('./core.js') : null);
  const KEYS = { db: 'stock-claude:db', history: 'stock-claude:history', rescue: 'stock-claude:rescue', finnhub: 'stock-claude:finnhub-key' };
  const HISTORY_LIMIT = 15;

  function createStore(storage) {
    let mode = 'normal';           // 'normal' | 'recovery'
    let recoveryReason = '';

    function load() {
      let raw;
      try { raw = storage.getItem(KEYS.db); } catch (e) { mode = 'recovery'; recoveryReason = '無法讀取瀏覽器儲存空間：' + e.message; return { db: Core.emptyDb(), warnings: [], mode, recoveryReason }; }
      if (!raw) return { db: Core.emptyDb(), warnings: [], mode, fresh: true };
      try {
        const { db, warnings } = Core.normalizeDb(JSON.parse(raw));
        return { db, warnings, mode };
      } catch (e) {
        mode = 'recovery';
        recoveryReason = (e instanceof SyntaxError ? '資料格式損毀' : e.message);
        // Keep an untouched copy under a separate key so nothing can overwrite it.
        try { storage.setItem(KEYS.rescue, raw); } catch (_) { /* best effort */ }
        return { db: Core.emptyDb(), warnings: [], mode, recoveryReason };
      }
    }

    // quiet: bookkeeping writes (e.g. the daily net-asset point) that should not
    // push a history version or count as an edit for the backup reminder.
    function save(db, reason = '', { quiet = false } = {}) {
      if (mode === 'recovery') throw Error('目前是資料救援模式，為避免覆蓋原始資料，暫停儲存。請先還原或匯入備份。');
      const next = quiet ? db : { ...db, meta: { ...db.meta, updatedAt: Core.nowIso() } };
      const text = JSON.stringify(next);
      const previous = storage.getItem(KEYS.db);
      try {
        if (!quiet && previous && previous !== text) pushHistory(previous, reason);
        storage.setItem(KEYS.db, text);
      } catch (e) {
        throw Error('儲存失敗（' + (e.name === 'QuotaExceededError' ? '手機儲存空間不足' : e.message) + '），這次的變更沒有存下來，請先匯出備份');
      }
      return next;
    }

    function pushHistory(previousText, reason) {
      let list = readHistory();
      list.unshift({ at: Core.nowIso(), reason: reason || '修改', data: previousText });
      list = list.slice(0, HISTORY_LIMIT);
      // If storage is tight, drop the oldest versions before giving up.
      while (list.length) {
        try { storage.setItem(KEYS.history, JSON.stringify(list)); return; }
        catch (e) { list.pop(); }
      }
    }

    function readHistory() {
      try { const list = JSON.parse(storage.getItem(KEYS.history) || '[]'); return Array.isArray(list) ? list : []; }
      catch (_) { return []; }
    }

    // Restoring is itself saved, so the current state stays in history and can be undone.
    function restore(index) {
      const item = readHistory()[index];
      if (!item) throw Error('找不到這個版本');
      const { db } = Core.normalizeDb(JSON.parse(item.data));
      mode = 'normal';
      return save(db, '還原 ' + item.at.slice(0, 16).replace('T', ' ') + ' 的版本');
    }

    function replace(db, reason) { mode = 'normal'; return save(db, reason); }
    const rescueText = () => storage.getItem(KEYS.rescue) || storage.getItem(KEYS.db) || '';
    const getKey = () => storage.getItem(KEYS.finnhub) || '';
    const setKey = k => (k ? storage.setItem(KEYS.finnhub, k) : storage.removeItem(KEYS.finnhub));
    function wipe() { for (const k of Object.values(KEYS)) storage.removeItem(k); mode = 'normal'; }

    return { load, save, restore, replace, readHistory, rescueText, getKey, setKey, wipe, get mode() { return mode; }, get recoveryReason() { return recoveryReason; } };
  }

  const api = { createStore, KEYS, HISTORY_LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Storage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
