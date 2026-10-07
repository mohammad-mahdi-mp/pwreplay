// ژورنال ترید: یادداشت/برچسب/احساس برای هر معامله بسته‌شده + اسکرین‌شات از چارت
// کلید هر ورودی: sessionId + tradeId. کلید localStorage با v2 یکی است تا یادداشت‌های قبلی حفظ شوند

const JOURNAL_KEY = 'fxreplay.journal.v2';
const EMPTY = () => ({ note: '', tags: '', emotion: '' });

function loadAll () {
  try {
    const map = JSON.parse(localStorage.getItem(JOURNAL_KEY));
    return map && typeof map === 'object' ? map : {};
  } catch (e) { return {}; }
}

function saveAll (map) {
  try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(map)); return true; } catch (e) { return false; }
}

export function getEntry (sessionId, tradeId) {
  const all = loadAll();
  return (all[sessionId] && all[sessionId][tradeId]) || EMPTY();
}

export function saveEntry (sessionId, tradeId, patch) {
  const all = loadAll();
  if (!all[sessionId]) all[sessionId] = {};
  const prev = all[sessionId][tradeId] || EMPTY();
  all[sessionId][tradeId] = { ...prev, ...patch };
  saveAll(all);
  return all[sessionId][tradeId];
}

export function listSessionEntries (sessionId) {
  const all = loadAll();
  return all[sessionId] || {};
}

// ادغام یادداشت‌های یک سشن ذخیره‌شده (فایل .mrsession)
export function importSessionEntries (sessionId, entries) {
  if (!sessionId || !entries || typeof entries !== 'object') return 0;
  const all = loadAll();
  all[sessionId] = { ...(all[sessionId] || {}), ...entries };
  saveAll(all);
  return Object.keys(entries).length;
}

export function captureChartPng (containerEl) {
  if (!containerEl) return null;
  const canvases = containerEl.querySelectorAll('canvas');
  if (!canvases.length) return null;
  const dpr = window.devicePixelRatio || 1;
  const width = containerEl.clientWidth;
  const height = containerEl.clientHeight;
  if (!width || !height) return null;
  const out = document.createElement('canvas');
  out.width = Math.round(width * dpr);
  out.height = Math.round(height * dpr);
  const ctx = out.getContext('2d');
  const bg = getComputedStyle(containerEl).backgroundColor;
  ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#131722';
  ctx.fillRect(0, 0, out.width, out.height);
  const base = containerEl.getBoundingClientRect();
  for (const c of canvases) {
    if (!c.width || !c.height) continue;
    const r = c.getBoundingClientRect();
    ctx.drawImage(c, (r.left - base.left) * dpr, (r.top - base.top) * dpr, r.width * dpr, r.height * dpr);
  }
  return out.toDataURL('image/png').split(',')[1];
}

export async function saveChartScreenshot (defaultName, containerEl) {
  const base64 = captureChartPng(containerEl);
  if (!base64) return { ok: false, error: 'No chart image to capture' };
  if (window.desktop && window.desktop.savePng) {
    const res = await window.desktop.savePng(defaultName, base64);
    if (res && res.path) return { ok: true, path: res.path };
    if (res && res.error) return { ok: false, error: res.error };
    return { ok: false, error: 'Cancelled' };
  }
  const anchor = document.createElement('a');
  anchor.href = 'data:image/png;base64,' + base64;
  anchor.download = defaultName;
  anchor.click();
  return { ok: true, path: defaultName };
}
