// ژورنال ترید: یادداشت/برچسب/احساس برای هر معامله بسته‌شده + اسکرین‌شات از چارت
// کلید هر ورودی: sessionId + tradeId — با عوض شدن سشن ریپلی، یادداشت‌ها حفظ می‌شوند

const JOURNAL_KEY = 'fxreplay.journal.v2';

function loadAll () {
  try {
    const map = JSON.parse(localStorage.getItem(JOURNAL_KEY));
    return map && typeof map === 'object' ? map : {};
  } catch (e) { return {}; }
}

function saveAll (map) {
  try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(map)); } catch (e) { /* پر شدن حافظه */ }
}

export function getEntry (sessionId, tradeId) {
  if (!tradeId) { tradeId = sessionId; sessionId = 'default'; }
  const all = loadAll();
  const item = (all[sessionId] && all[sessionId][tradeId]) || { note: '', notes: '', tags: [], emotion: '' };
  if (!item.notes && item.note) item.notes = item.note;
  if (!item.note && item.notes) item.note = item.notes;
  if (typeof item.tags === 'string') item.tags = item.tags.split(',').map(s => s.trim()).filter(Boolean);
  return item;
}

export function getJournalEntry (tradeId, sessionId = 'default') {
  return getEntry(sessionId, tradeId);
}

export function saveEntry (sessionId, tradeId, patch) {
  if (typeof tradeId === 'object' && patch === undefined) {
    patch = tradeId;
    tradeId = sessionId;
    sessionId = 'default';
  }
  const all = loadAll();
  if (!all[sessionId]) all[sessionId] = {};
  const prev = all[sessionId][tradeId] || { note: '', notes: '', tags: [], emotion: '' };
  const updated = { ...prev, ...patch };
  if (updated.notes && !updated.note) updated.note = updated.notes;
  if (updated.note && !updated.notes) updated.notes = updated.note;
  all[sessionId][tradeId] = updated;
  saveAll(all);
  return updated;
}

export function saveJournalEntry (tradeId, patch, sessionId = 'default') {
  return saveEntry(sessionId, tradeId, patch);
}

export function listSessionEntries (sessionId = 'default') {
  const all = loadAll();
  return all[sessionId] || {};
}

// ترکیب بوم‌های چارت در یک PNG — خروجی base64 بدون پیشوند data:
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
  for (const c of canvases) {
    if (!c.width || !c.height) continue;
    ctx.drawImage(c, (c.offsetLeft || 0) * dpr, (c.offsetTop || 0) * dpr);
  }
  return out.toDataURL('image/png').split(',')[1];
}

// ذخیره اسکرین‌شات چارت — در الکترون با دیالوگ ذخیره، در مرورگر با دانلود
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
