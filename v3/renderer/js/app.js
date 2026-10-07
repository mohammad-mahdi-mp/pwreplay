import { state, on, addDataset, formatTime, fmt, priceDigits, listDatasets, setActiveDataset } from './core/store.js';
import * as chartApi from './chart.js';
import * as engine from './trading/engine.js';
import * as risk from './trading/risk.js';
import * as statsApi from './trading/stats.js';
import * as journal from './journal.js';
import { initUi, toast } from './ui.js';
import { initPineEditor, refreshPineForData } from './editor.js';
import { initShortcuts } from './shortcuts.js';
import { enterReplay, exitReplay, restoreSession, jumpTo } from './core/replay.js';

const $ = id => document.getElementById(id);
const SESSION_VERSION = 3;

function markPrice () {
  const i = state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
  return state.candles[i]?.close ?? NaN;
}

function renderAccount () {
  const a = engine.account();
  $('account').textContent = `Balance  ${fmt(a.balance)}\nEquity   ${fmt(a.equity)}\nOpen P&L ${fmt(a.openPnl)}\nMargin   ${fmt(a.marginUsed)}\nFree     ${fmt(a.freeMargin)}\nTrades   ${a.closedCount}`;
}

function renderPositions () {
  const wrap = $('positions-list');
  wrap.textContent = '';
  for (const p of engine.getPositions()) {
    const el = document.createElement('div');
    el.className = 'position';
    const pnl = engine.floatingPnl(p);
    el.innerHTML = `<b class="${p.dir > 0 ? 'pos' : 'neg'}">${p.dir > 0 ? 'LONG' : 'SHORT'} ${p.id}</b><br>${fmt(p.volume, 4)} @ ${fmt(p.entryPrice, priceDigits(p.entryPrice))}<br><span class="${pnl >= 0 ? 'pos' : 'neg'}">P&L ${fmt(pnl)}</span><br><button data-close-pos="${p.id}">Close</button><button data-be-pos="${p.id}">Break even</button>`;
    wrap.appendChild(el);
  }
  wrap.querySelectorAll('[data-close-pos]').forEach(b => b.onclick = () => { const r = engine.closePositionById(b.dataset.closePos); toast(r.msg, r.ok ? 'ok' : 'err'); });
  wrap.querySelectorAll('[data-be-pos]').forEach(b => b.onclick = () => { const r = engine.breakEven(b.dataset.bePos); toast(r.msg, r.ok ? 'ok' : 'err'); });
}

function renderOrders () {
  const wrap = $('pending-orders');
  wrap.textContent = '';
  for (const o of engine.getOrders()) {
    const el = document.createElement('div');
    el.className = 'order';
    el.innerHTML = `<b>${o.dir > 0 ? 'BUY' : 'SELL'} ${o.type.toUpperCase()}</b><br>${o.id} @ ${fmt(o.price, priceDigits(o.price))}<br><button data-cancel-order="${o.id}">Cancel</button>`;
    wrap.appendChild(el);
  }
  wrap.querySelectorAll('[data-cancel-order]').forEach(b => b.onclick = () => { const r = engine.cancelOrder(b.dataset.cancelOrder); toast(r.msg, r.ok ? 'ok' : 'err'); });
}

function renderHistory () {
  const body = $('trades-table').querySelector('tbody');
  body.textContent = '';
  for (const t of [...engine.getClosedTrades()].reverse()) {
    const row = document.createElement('tr');
    [t.id, t.dir > 0 ? 'LONG' : 'SHORT', fmt(t.entryPrice, priceDigits(t.entryPrice)), fmt(t.exitPrice, priceDigits(t.exitPrice)), fmt(t.netPnl), fmt(t.rMultiple, 2)].forEach(v => { const td = document.createElement('td'); td.textContent = v; row.appendChild(td); });
    body.appendChild(row);
  }
}

function renderStats () {
  const basic = risk.computeStats(engine.getClosedTrades(), engine.account().initialBalance, { floating: engine.account().openPnl });
  const adv = statsApi.advancedStats(engine.getClosedTrades(), { initialBalance: basic.initialBalance || engine.account().initialBalance, maxDd: basic.maxDd, journal: journal.listSessionEntries(engine.getSessionId()) });
  const grid = $('stats-grid');
  grid.textContent = '';
  const values = [['Trades', basic.total], ['Win rate', `${fmt(basic.winRate, 1)}%`], ['Profit factor', fmt(basic.profitFactor, 2)], ['Max DD', fmt(basic.maxDd)], ['Avg R', fmt(adv.avgR, 2)], ['SQN', fmt(adv.sqn, 2)], ['Recovery', fmt(adv.recoveryFactor, 2)], ['Max loss streak', adv.maxConsecLosses], ['Avg MFE', fmt(adv.avgMfe)], ['Avg MAE', fmt(adv.avgMae)]];
  for (const [label, value] of values) { const el = document.createElement('div'); el.className = 'stat'; el.innerHTML = `<small>${label}</small><b>${value}</b>`; grid.appendChild(el); }
}

function renderJournal () {
  const wrap = $('journal-list');
  wrap.textContent = '';
  for (const t of [...engine.getClosedTrades()].reverse()) {
    const entry = journal.getEntry(engine.getSessionId(), t.id);
    const card = document.createElement('div'); card.className = 'position';
    card.innerHTML = `<b>${t.id} ${t.dir > 0 ? 'LONG' : 'SHORT'} ${fmt(t.netPnl)}</b><textarea data-note="${t.id}" placeholder="Setup, mistake, lesson...">${entry.note || ''}</textarea><input data-tags="${t.id}" placeholder="Tags" value="${entry.tags || ''}"><button data-save-note="${t.id}">Save</button>`;
    wrap.appendChild(card);
  }
  wrap.querySelectorAll('[data-save-note]').forEach(b => b.onclick = () => { const id = b.dataset.saveNote; journal.saveEntry(engine.getSessionId(), id, { note: wrap.querySelector(`[data-note="${id}"]`).value, tags: wrap.querySelector(`[data-tags="${id}"]`).value }); toast('Journal saved', 'ok'); });
}

function renderAll () { renderAccount(); renderPositions(); renderOrders(); renderHistory(); renderStats(); renderJournal(); }

function submitOrder (dir) {
  if (state.mode !== 'replay') return toast('Start replay before trading', 'err');
  const sl = $('order-sl').value.trim() ? Number($('order-sl').value) : null;
  const tp = $('order-tp').value.trim() ? Number($('order-tp').value) : null;
  const r = engine.marketOrder(dir, Number($('order-volume').value) || 1, sl, tp);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

function sessionPayload () {
  return { version: SESSION_VERSION, savedAt: Date.now(), symbol: state.symbol, timeframe: state.timeframe, candles: state.candles, replayStart: state.replayStart, replayIndex: state.replayIndex, mode: state.mode, engine: engine.exportSession(), drawings: chartApi.serializeDrawings(), journal: journal.listSessionEntries(engine.getSessionId()) };
}

async function saveSession () {
  const payload = JSON.stringify(sessionPayload());
  const name = `${state.symbol || 'market'}-${state.timeframe || 'session'}.mrsession`;
  const result = window.desktop?.saveFile ? await window.desktop.saveFile(name, payload) : null;
  if (result?.path) toast('Session saved', 'ok'); else if (result?.error) toast(result.error, 'err'); else if (!window.desktop) { localStorage.setItem('pwreplay.lastSession', payload); toast('Session saved locally', 'ok'); }
}

async function openSession () {
  const result = window.desktop?.openSession ? await window.desktop.openSession() : null;
  if (!result?.content) return toast('No session selected', 'info');
  try {
    const p = JSON.parse(result.content);
    if (p.version !== SESSION_VERSION || !Array.isArray(p.candles)) throw new Error('Unsupported session file');
    addDataset(p.candles, p.symbol || 'IMPORTED', p.timeframe || 'M15');
    chartApi.resetDrawings(); chartApi.restoreDrawings(p.drawings || []);
    if (p.mode === 'replay') restoreSession(p.replayStart, p.replayIndex, p.engine); else engine.resetSession('');
    journal.importSessionEntries(engine.getSessionId(), p.journal || {});
    toast('Session loaded', 'ok');
  } catch (e) { toast(`Session load failed: ${e.message}`, 'err'); }
}

function setupTradeChart () {
  chartApi.setTradeClickHandler((_, price) => {
    if (state.mode !== 'replay') return toast('Start replay before trading', 'err');
    const market = markPrice(); const dir = price >= market ? -1 : 1; const r = engine.marketOrder(dir, Number($('order-volume').value) || 1, null, null); toast(r.msg, r.ok ? 'ok' : 'err');
  });
}

function initTabs () {
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { const tab = b.dataset.tab; ['history', 'stats', 'journal', 'pine'].forEach(x => $(`tab-${x}`).classList.toggle('hidden', x !== tab)); });
}

function init () {
  chartApi.initChart($('chart-container')); chartApi.applyAll([]); initUi(); initPineEditor(); initShortcuts(); setupTradeChart(); initTabs();
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { chartApi.setTool(b.dataset.tool); document.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b)); });
  $('btn-clear-draws').onclick = () => { chartApi.clearDrawings(); toast('Drawings cleared', 'info'); };
  $('btn-buy').onclick = () => submitOrder(1); $('btn-sell').onclick = () => submitOrder(-1);
  $('btn-session-save').onclick = saveSession; $('btn-session-open').onclick = openSession;
  $('btn-export-trades').onclick = () => { const csv = risk.exportTradesCsv(engine.getClosedTrades(), formatTime); window.desktop?.saveFile('trades.csv', csv); };
  $('btn-journal-shot').onclick = () => journal.saveChartScreenshot(`${state.symbol}-review.png`, $('chart-container'));
  on('data-loaded', () => { chartApi.resetDrawings(); chartApi.applyAll(state.candles); refreshPineForData(); $('chart-empty').classList.add('hidden'); $('dataset-label').textContent = `${state.symbol} · ${state.timeframe} · ${state.candles.length} bars`; renderAll(); });
  on('engine-changed', renderAll); on('replay-index', renderAll); on('mode-changed', renderAll);
  document.addEventListener('replay-play-state', e => $('btn-play').textContent = e.detail ? '❚❚' : '▶');
  renderAll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();