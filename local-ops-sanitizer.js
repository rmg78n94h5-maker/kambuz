(() => {
  'use strict';
  const VERSION = '1.9.1';
  const OPS_KEY = 'kambuz_ops';
  const BACKUP_KEY = 'kambuz_invalid_ops_backup';

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function validDate(value) {
    if (!value) return false;
    const t = new Date(value).getTime();
    return Number.isFinite(t);
  }
  function looksLikeEpochMilliseconds(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    // Roughly years 2001–2100 in epoch milliseconds. Stock quantities should never live in this range.
    return n >= 978307200000 && n <= 4133980800000;
  }
  function malformed(op) {
    if (!op || typeof op !== 'object') return true;
    if (!['receipt','consumption','writeoff','adjustment'].includes(op.type)) return false;
    const q = Number(op.quantity);
    if (!Number.isFinite(q) || q < 0) return true;
    if (looksLikeEpochMilliseconds(q)) return true;
    if (!validDate(op.created_at)) return true;
    return false;
  }

  const ops = read(OPS_KEY, []);
  if (Array.isArray(ops) && ops.length) {
    const good = [];
    const bad = [];
    for (const op of ops) (malformed(op) ? bad : good).push(op);
    if (bad.length) {
      const previous = read(BACKUP_KEY, []);
      const backup = Array.isArray(previous) ? previous : [];
      const known = new Set(backup.map(x => JSON.stringify(x)));
      for (const op of bad) {
        const key = JSON.stringify(op);
        if (!known.has(key)) backup.push(op);
      }
      write(BACKUP_KEY, backup.slice(-200));
      write(OPS_KEY, good);
      console.warn(`Камбуз: из локальной статистики исключено повреждённых операций: ${bad.length}`);
    }
  }

  window.KAMBUZ_LOCAL_OPS_SANITIZER = { version: VERSION };
})();