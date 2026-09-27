// Market Replay Pro 2.0 — Commercial Workspace Controller
// Manages preferences, splitters, draw toolbar, order desk, positions, execution engine,
// multi-timeframe resampling, audio feedback, 1-click trading, analytics & Pine editor

import { state, on, fmt, formatTime, priceDigits, listDatasets, setActiveDataset, addDataset } from './core/store.js';
import { generateSampleCandles } from './core/sample.js';
import * as chartApi from './chart.js';
import * as engine from './trading/engine.js';
import * as risk from './trading/risk.js';
import * as journal from './journal.js';
import * as sound from './core/sound.js';
import { TIMEFRAMES, resampleCandles, normalizeTfLabel } from './core/timeframe.js';
import { initUi, toast, openModal, closeModal } from './ui.js';
import { initPineEditor, runCurrentPine, setPineScript } from './editor.js';
import { initShortcuts } from './shortcuts.js';
import { enterReplay, jumpTo, isPlaying, startPlay, stopPlay } from './core/replay.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'fxreplay.ui.preferences.v2';
const defaults = {
  theme: 'dark',
  accent: '#f0b90b',
  density: 'compact',
  sound: true,
  tradePanel: true,
  bottomPanel: true,
  quickTrade: true,
  tradeWidth: 310,
  bottomHeight: 260
};

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
let preferences = loadPreferences();

let rawBaseCandles = [];
let lastPrice = null;
let priceFlashTimer = null;
let activeTradeFilter = 'all'; // 'all' | 'wins' | 'losses'
let calendarDayFilter = null;

function loadPreferences () {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY));
    return { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch (e) { return { ...defaults }; }
}

function accentRgb (hex) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : defaults.accent;
  return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16)).join(', ');
}

function applyPreferences (resizeChart = true) {
  preferences.theme = ['dark', 'light'].includes(preferences.theme) ? preferences.theme : 'dark';
  preferences.density = ['compact', 'comfortable'].includes(preferences.density) ? preferences.density : 'compact';
  preferences.accent = /^#[0-9a-f]{6}$/i.test(preferences.accent) ? preferences.accent : defaults.accent;
  preferences.tradeWidth = clamp(Number(preferences.tradeWidth) || 310, 240, 500);
  preferences.bottomHeight = clamp(Number(preferences.bottomHeight) || 260, 140, Math.max(140, window.innerHeight * 0.55));
  
  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.dataset.density = preferences.density;
  document.documentElement.style.setProperty('--accent', preferences.accent);
  document.documentElement.style.setProperty('--accent-rgb', accentRgb(preferences.accent));
  document.documentElement.style.setProperty('--trade-panel-width', preferences.tradeWidth + 'px');
  document.documentElement.style.setProperty('--bottom-panel-height', preferences.bottomHeight + 'px');
  
  document.body.classList.toggle('trade-collapsed', !preferences.tradePanel);
  document.body.classList.toggle('bottom-collapsed', !preferences.bottomPanel);
  document.body.classList.toggle('trade-pinned', preferences.tradePanel);

  sound.setMuted(!preferences.sound);
  const sndBtn = $('btn-sound');
  if (sndBtn) sndBtn.classList.toggle('active', preferences.sound);

  if (chartApi.getChart()) chartApi.applyAppearance(preferences);
  if (resizeChart && chartApi.getChart()) requestAnimationFrame(chartApi.resize);
}

function savePreferences () {
  localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
}
applyPreferences(false);

// ---------- قیمت لحظه‌ای و سود شناور ----------

function markPrice () {
  const idx = state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
  const c = state.candles[idx];
  return c ? c.close : NaN;
}

function floatingOf (pos, price) {
  return (price - pos.entryPrice) * pos.dir * pos.volume * engine.getConfig().contractSize;
}

// ---------- ترجیحات و تنظیمات فضای کار ----------

function initWorkspacePreferences () {
  const syncControls = () => {
    $('pref-theme').value = preferences.theme;
    $('pref-accent').value = preferences.accent;
    $('pref-density').value = preferences.density;
    $('pref-sound').checked = preferences.sound;
    $('pref-trade-panel').checked = preferences.tradePanel;
    $('pref-bottom-panel').checked = preferences.bottomPanel;
  };

  $('btn-preferences').addEventListener('click', () => { syncControls(); openModal('preferences-modal'); });

  $('btn-save-preferences').addEventListener('click', () => {
    preferences.theme = $('pref-theme').value;
    preferences.accent = $('pref-accent').value;
    preferences.density = $('pref-density').value;
    preferences.sound = $('pref-sound').checked;
    preferences.tradePanel = $('pref-trade-panel').checked;
    preferences.bottomPanel = $('pref-bottom-panel').checked;
    applyPreferences();
    savePreferences();
    closeModal('preferences-modal');
    toast('Workspace preferences saved', 'ok');
  });

  $('btn-reset-layout').addEventListener('click', () => {
    preferences = { ...defaults };
    applyPreferences();
    savePreferences();
    syncControls();
    toast('Workspace layout reset', 'info');
  });

  const togglePanel = name => {
    preferences[name] = !preferences[name];
    applyPreferences();
    savePreferences();
  };

  $('btn-toggle-trade').addEventListener('click', () => togglePanel('tradePanel'));
  $('btn-toggle-bottom').addEventListener('click', () => togglePanel('bottomPanel'));
  $('btn-close-trade-panel').addEventListener('click', () => togglePanel('tradePanel'));
  $('btn-close-bottom-panel').addEventListener('click', () => togglePanel('bottomPanel'));

  // Sound toggle button
  $('btn-sound').addEventListener('click', () => {
    preferences.sound = !preferences.sound;
    sound.setMuted(!preferences.sound);
    $('btn-sound').classList.toggle('active', preferences.sound);
    savePreferences();
    toast(preferences.sound ? 'Sound FX enabled' : 'Sound FX muted', 'info');
  });

  // Fullscreen button
  $('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Shortcuts modal
  $('btn-shortcuts').addEventListener('click', () => {
    openModal('shortcuts-modal');
  });

  // Chart screenshot button
  $('btn-screenshot').addEventListener('click', saveScreenshot);

  // Splitters
  initSplitter($('trade-resizer'), event => {
    preferences.tradeWidth = clamp(window.innerWidth - event.clientX, 240, 500);
    document.documentElement.style.setProperty('--trade-panel-width', preferences.tradeWidth + 'px');
  });

  initSplitter($('bottom-resizer'), event => {
    preferences.bottomHeight = clamp(window.innerHeight - event.clientY, 140, window.innerHeight * 0.55);
    document.documentElement.style.setProperty('--bottom-panel-height', preferences.bottomHeight + 'px');
  });
}

function initSplitter (element, onMove) {
  let dragging = false;
  element.addEventListener('pointerdown', event => {
    dragging = true;
    element.classList.add('dragging');
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener('pointermove', event => {
    if (!dragging) return;
    onMove(event);
    chartApi.resize();
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    element.classList.remove('dragging');
    savePreferences();
    chartApi.resize();
  };
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
}

// ---------- نوار ابزار ترسیم ----------

function initDrawToolbar () {
  const buttons = [...document.querySelectorAll('#draw-toolbar .dt-btn[data-tool]')];
  const setActive = tool => buttons.forEach(button => button.classList.toggle('active', button.dataset.tool === tool));

  buttons.forEach(button => button.addEventListener('click', () => {
    chartApi.setTool(button.dataset.tool);
    setActive(button.dataset.tool);
  }));

  $('btn-drawing-settings').addEventListener('click', () => $('drawing-inspector').classList.toggle('hidden'));
  $('btn-close-drawing-settings').addEventListener('click', () => $('drawing-inspector').classList.add('hidden'));

  $('btn-clear-draws').addEventListener('click', () => {
    if (!chartApi.listUserDrawings().length || !window.confirm('Delete all user drawings? Active trade markers will be preserved.')) return;
    chartApi.clearDrawings();
    toast('All drawings removed', 'info');
  });

  $('drawing-select').addEventListener('change', event => chartApi.selectDrawing(event.target.value));

  const updateDrawing = () => {
    const settings = {
      color: $('drawing-color').value,
      width: Number($('drawing-width').value),
      style: $('drawing-style').value,
      lock: $('drawing-lock').checked,
      visible: $('drawing-visible').checked
    };
    chartApi.setDrawingDefaults(settings);
    chartApi.updateSelectedDrawing(settings);
  };
  ['drawing-color', 'drawing-width', 'drawing-style', 'drawing-lock', 'drawing-visible'].forEach(id => $(id).addEventListener('input', updateDrawing));

  $('btn-delete-drawing').addEventListener('click', () => {
    if (chartApi.removeSelectedDrawing()) toast('Drawing deleted', 'info');
  });

  chartApi.onDrawingsChange(({ drawings, selectedId }) => {
    setActive(chartApi.getTool());
    const select = $('drawing-select');
    const previous = selectedId || select.value;
    select.textContent = '';
    if (!drawings.length) {
      const option = document.createElement('option');
      option.textContent = 'No drawings';
      option.value = '';
      select.appendChild(option);
      $('btn-delete-drawing').disabled = true;
      return;
    }
    $('btn-delete-drawing').disabled = false;
    drawings.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.label} (${item.id.slice(0, 6)})`;
      select.appendChild(option);
    });
    if (previous && drawings.some(item => item.id === previous)) select.value = previous;
  });

  // Chart type switcher
  $('chart-type-select').addEventListener('change', (e) => {
    chartApi.setChartType(e.target.value);
  });
}

// ---------- رندر اکانت و قیمت زنده ----------

function renderAccount () {
  const acc = engine.account();
  const cfg = engine.getConfig();
  const price = markPrice();

  $('acc-balance').textContent = fmt(acc.balance, 2);
  $('acc-equity').textContent = fmt(acc.equity, 2);
  $('acc-open-pnl').textContent = (acc.openPnl >= 0 ? '+' : '') + fmt(acc.openPnl, 2);
  $('acc-open-pnl').className = acc.openPnl > 0 ? 'good' : acc.openPnl < 0 ? 'danger' : '';
  $('acc-margin').textContent = fmt(acc.marginUsed, 2);
  $('acc-free-margin').textContent = fmt(acc.freeMargin, 2);

  const level = $('acc-margin-level');
  if (acc.marginUsed > 0 && Number.isFinite(acc.marginLevelPct)) {
    level.textContent = fmt(acc.marginLevelPct, 0) + '%';
    level.className = acc.marginLevelPct < cfg.stopOutPct ? 'danger' : acc.marginLevelPct < cfg.marginCallPct ? 'warn' : 'good';
  } else {
    level.textContent = '—';
    level.className = '';
  }
  $('acc-trades').textContent = String(acc.closedCount);

  // قیمت تیکر بالا
  const digits = Number.isFinite(price) ? priceDigits(price) : 2;
  $('market-price').textContent = Number.isFinite(price) ? `${state.symbol} · ${fmt(price, digits)}` : 'No market data';

  const half = cfg.spread / 2;
  const bid = Number.isFinite(price) ? price - half : NaN;
  const ask = Number.isFinite(price) ? price + half : NaN;

  $('buy-quote').textContent = Number.isFinite(ask) ? fmt(ask, digits) : '—';
  $('sell-quote').textContent = Number.isFinite(bid) ? fmt(bid, digits) : '—';

  // وضعیت دکمه‌های ریپلی
  const repToggle = $('btn-replay-toggle');
  if (repToggle) {
    repToggle.disabled = !state.loaded;
    const isReplay = state.mode === 'replay';
    repToggle.textContent = isReplay ? 'Stop Replay' : 'Start Replay';
    repToggle.classList.toggle('stop', isReplay);
    repToggle.classList.toggle('success', !isReplay);
  }

  const statPill = $('replay-status-pill');
  const statText = $('replay-status-text');
  if (statPill && statText) {
    const isReplay = state.mode === 'replay';
    statPill.classList.toggle('replay-active', isReplay);
    statText.textContent = isReplay ? 'REPLAY' : 'VIEW';
  }

  updatePlannedMetrics();
}

// ---------- تیکت سفارش و پنل معامله ----------

function updatePlannedMetrics () {
  const planRiskEl = $('plan-risk');
  const planRewardEl = $('plan-reward');
  const planRrEl = $('plan-rr');
  if (!planRiskEl || !planRewardEl || !planRrEl) return;

  const type = $('order-type') ? $('order-type').value : 'market';
  const customPrice = $('order-price') ? Number($('order-price').value) : NaN;
  const currentPrice = markPrice();
  const entryPrice = (type !== 'market' && Number.isFinite(customPrice) && customPrice > 0) ? customPrice : currentPrice;

  const vol = Number($('order-volume').value) || 0;
  const slRaw = $('order-sl').value.trim();
  const tpRaw = $('order-tp').value.trim();
  const sl = slRaw !== '' ? Number(slRaw) : NaN;
  const tp = tpRaw !== '' ? Number(tpRaw) : NaN;

  const contractSize = engine.getConfig().contractSize || 1;
  const balance = engine.account().balance || 10000;

  let riskUsd = null;
  let rewardUsd = null;

  if (Number.isFinite(entryPrice) && Number.isFinite(sl) && vol > 0) {
    const slDist = Math.abs(entryPrice - sl);
    riskUsd = slDist * vol * contractSize;
    const riskPct = balance > 0 ? (riskUsd / balance) * 100 : 0;
    planRiskEl.textContent = `-$${fmt(riskUsd, 2)} (${fmt(riskPct, 1)}%)`;
  } else {
    planRiskEl.textContent = '—';
  }

  if (Number.isFinite(entryPrice) && Number.isFinite(tp) && vol > 0) {
    const tpDist = Math.abs(entryPrice - tp);
    rewardUsd = tpDist * vol * contractSize;
    const rewardPct = balance > 0 ? (rewardUsd / balance) * 100 : 0;
    planRewardEl.textContent = `+$${fmt(rewardUsd, 2)} (${fmt(rewardPct, 1)}%)`;
  } else {
    planRewardEl.textContent = '—';
  }

  if (riskUsd != null && rewardUsd != null && riskUsd > 0) {
    const rr = rewardUsd / riskUsd;
    planRrEl.textContent = `1 : ${fmt(rr, 2)}`;
  } else {
    planRrEl.textContent = '—';
  }
}

function readTicket () {
  const sl = $('order-sl').value.trim();
  const tp = $('order-tp').value.trim();
  const price = $('order-price').value.trim();
  return {
    type: $('order-type').value,
    volume: Number($('order-volume').value),
    price: price ? Number(price) : NaN,
    sl: sl === '' ? null : Number(sl),
    tp: tp === '' ? null : Number(tp)
  };
}

function submitTicket (dir) {
  if (!state.loaded) { toast('Load market data first', 'err'); return; }
  if (state.mode !== 'replay') { toast('Start a replay session before trading', 'err'); return; }
  const t = readTicket();
  const result = t.type === 'market'
    ? engine.marketOrder(dir, t.volume, t.sl, t.tp)
    : engine.placeOrder(t.type, dir, t.price, t.volume, t.sl, t.tp);
  if (result.ok) sound.playOrder();
  toast(result.msg, result.ok ? 'ok' : 'err');
}

function sizeByRisk (quiet = false) {
  const price = markPrice();
  const slRaw = $('order-sl').value.trim();
  const riskPct = Number($('risk-pct').value) || 1;
  if (!Number.isFinite(price)) { if (!quiet) toast('No market price available', 'err'); return; }
  if (!slRaw) { if (!quiet) toast('Enter a Stop Loss price first to calculate volume', 'err'); return; }
  const volume = risk.volumeByRisk({
    balance: engine.account().balance,
    riskPct,
    entryPrice: price,
    slPrice: Number(slRaw),
    contractSize: engine.getConfig().contractSize
  });
  if (!Number.isFinite(volume) || volume <= 0) { if (!quiet) toast('Invalid volume computed — check Stop Loss', 'err'); return; }
  $('order-volume').value = volume.toFixed(4);
  updatePlannedMetrics();
  if (!quiet) toast(`Volume sized: ${fmt(volume, 4)} lots (${riskPct}% risk)`, 'ok');
}

function calculateTargetByRr (rrMultiple) {
  const price = markPrice();
  const slRaw = $('order-sl').value.trim();
  if (!Number.isFinite(price)) { toast('No market price available', 'err'); return; }
  if (!slRaw) { toast('Enter Stop Loss first to calculate Take Profit', 'err'); return; }
  const sl = Number(slRaw);
  const dist = Math.abs(price - sl);
  const dir = sl < price ? 1 : -1; // اگر استاپ زیر قیمت است، خرید است
  const tp = dir > 0 ? price + dist * rrMultiple : price - dist * rrMultiple;
  $('order-tp').value = tp.toFixed(priceDigits(price));
  updatePlannedMetrics();
  toast(`Take profit set to 1:${rrMultiple} R:R (@ ${fmt(tp, priceDigits(price))})`, 'ok');
}

// ---------- رندر پوزیشن‌ها و سفارش‌ها ----------

function renderPositions () {
  const positions = engine.getPositions();
  const list = $('positions-list');
  $('positions-count').textContent = String(positions.length);
  list.textContent = '';

  if (!positions.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'No open positions';
    list.appendChild(empty);
    return;
  }

  const price = markPrice();
  const cfg = engine.getConfig();

  for (const pos of positions) {
    const card = document.createElement('div');
    card.className = 'position-item ' + (pos.dir > 0 ? 'long' : 'short');
    card.dataset.posId = pos.id;

    const head = document.createElement('div');
    head.className = 'pos-head';
    const badge = document.createElement('span');
    badge.className = 'dir-badge ' + (pos.dir > 0 ? 'long' : 'short');
    badge.textContent = pos.dir > 0 ? 'LONG' : 'SHORT';

    const meta = document.createElement('span');
    meta.textContent = `${pos.id} · ${fmt(pos.volume, 2)} lots @ ${fmt(pos.entryPrice, priceDigits(pos.entryPrice))}`;

    const pnl = document.createElement('span');
    const pnlVal = Number.isFinite(price) ? floatingOf(pos, price) : NaN;
    const pnlPct = (Number.isFinite(price) && pos.entryPrice)
      ? ((price - pos.entryPrice) / pos.entryPrice * pos.dir * 100)
      : 0;

    pnl.className = 'pos-pnl ' + (pnlVal > 0 ? 'pos' : pnlVal < 0 ? 'neg' : '');
    pnl.textContent = Number.isFinite(pnlVal) ? `${pnlVal >= 0 ? '+' : ''}${fmt(pnlVal, 2)} (${fmt(pnlPct, 2)}%)` : '—';
    head.append(badge, meta, pnl);

    const fields = document.createElement('div');
    fields.className = 'pos-fields';

    const slLabel = document.createElement('label');
    slLabel.className = 'field';
    const slSpan = document.createElement('span');
    slSpan.textContent = 'Stop Loss';
    const slInput = document.createElement('input');
    slInput.type = 'number';
    slInput.step = 'any';
    slInput.placeholder = 'None';
    slInput.value = pos.sl != null ? pos.sl : '';
    slLabel.append(slSpan, slInput);

    const tpLabel = document.createElement('label');
    tpLabel.className = 'field';
    const tpSpan = document.createElement('span');
    tpSpan.textContent = 'Take Profit';
    const tpInput = document.createElement('input');
    tpInput.type = 'number';
    tpInput.step = 'any';
    tpInput.placeholder = 'None';
    tpInput.value = pos.tp != null ? pos.tp : '';
    tpLabel.append(tpSpan, tpInput);
    fields.append(slLabel, tpLabel);

    const actions = document.createElement('div');
    actions.className = 'pos-actions';

    const setBtn = document.createElement('button');
    setBtn.className = 'btn small';
    setBtn.textContent = 'Save SL/TP';
    setBtn.addEventListener('click', () => {
      const sl = slInput.value.trim() === '' ? null : Number(slInput.value);
      const tp = tpInput.value.trim() === '' ? null : Number(tpInput.value);
      const result = engine.modifyPosition(pos.id, { sl, tp });
      toast(result.msg, result.ok ? 'ok' : 'err');
    });

    // دکمه انتقال استاپ به نقطه ورود (Break-Even)
    const beBtn = document.createElement('button');
    beBtn.className = 'btn small btn-be';
    beBtn.textContent = 'BE';
    beBtn.title = 'Move Stop Loss to Entry Price (Break-Even)';
    beBtn.addEventListener('click', () => {
      const result = engine.modifyPosition(pos.id, { sl: pos.entryPrice });
      if (result.ok) sound.playOrder();
      toast(result.msg, result.ok ? 'ok' : 'err');
    });

    // دکمه بستن نیمی از حجم معامله (50% Partial Close)
    const halfBtn = document.createElement('button');
    halfBtn.className = 'btn small btn-half';
    halfBtn.textContent = '50%';
    halfBtn.title = 'Close 50% of position';
    halfBtn.addEventListener('click', () => {
      const result = engine.closePositionById(pos.id, 0.5);
      toast(result.msg, result.ok ? 'ok' : 'err');
    });

    // دکمه بستن کامل معامله
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn small danger';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      const result = engine.closePositionById(pos.id, 1);
      toast(result.msg, result.ok ? 'ok' : 'err');
    });

    actions.append(beBtn, halfBtn, setBtn, closeBtn);

    // محاسبه ریسک و ریوارد
    const riskInfo = document.createElement('div');
    riskInfo.className = 'pos-risk-info';
    const cs = cfg.contractSize || 1;
    const rDist = pos.sl != null ? Math.abs(pos.entryPrice - pos.sl) : null;
    const rewDist = pos.tp != null ? Math.abs(pos.tp - pos.entryPrice) : null;
    const parts = [];
    if (rDist != null) parts.push(`Risk −$${fmt(rDist * pos.volume * cs, 2)}`);
    if (rewDist != null) parts.push(`Reward +$${fmt(rewDist * pos.volume * cs, 2)}`);
    if (rDist != null && rewDist != null && rDist > 0) {
      const rr = rewDist / rDist;
      parts.push(`R:R 1:${rr.toFixed(2)}`);
    }

    if (parts.length) {
      const rrEl = document.createElement('span');
      rrEl.textContent = parts.join(' · ');
      if (rDist != null && rewDist != null && rewDist / rDist >= 1) rrEl.classList.add('good-rr');
      riskInfo.appendChild(rrEl);
    } else {
      riskInfo.textContent = 'Set SL/TP to see dynamic Risk & R:R';
      riskInfo.classList.add('muted');
    }

    card.append(head, fields, actions, riskInfo);
    list.appendChild(card);
  }
}

function renderPendingOrders () {
  const orders = engine.getOrders();
  const container = $('pending-orders');
  $('pending-count').textContent = String(orders.length);
  container.textContent = '';

  if (!orders.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'No pending orders';
    container.appendChild(empty);
    return;
  }

  for (const order of orders) {
    const card = document.createElement('div');
    card.className = 'pending-card';
    const head = document.createElement('div');
    head.className = 'pending-head';
    const title = document.createElement('strong');
    title.textContent = `${order.dir > 0 ? 'BUY' : 'SELL'} ${order.type.toUpperCase()}`;
    const priceEl = document.createElement('span');
    priceEl.className = 'pending-price';
    priceEl.textContent = fmt(order.price, priceDigits(order.price));
    head.append(title, priceEl);

    const meta = document.createElement('div');
    meta.className = 'pending-meta';
    const details = document.createElement('span');
    details.textContent = `${order.id} · Vol ${fmt(order.volume, 4)}`;
    const cancel = document.createElement('button');
    cancel.className = 'cancel-order';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      const result = engine.cancelOrder(order.id);
      toast(result.msg, result.ok ? 'info' : 'err');
    });
    meta.append(details, cancel);

    const protectionRow = document.createElement('div');
    protectionRow.className = 'pending-meta';
    const protectionText = document.createElement('span');
    protectionText.textContent = [
      order.sl != null ? `SL ${fmt(order.sl, priceDigits(order.sl))}` : null,
      order.tp != null ? `TP ${fmt(order.tp, priceDigits(order.tp))}` : null
    ].filter(Boolean).join(' · ') || 'No protection';
    protectionRow.appendChild(protectionText);

    card.append(head, meta, protectionRow);
    container.appendChild(card);
  }
}

// ---------- جدول تاریخچه معاملات ----------

function renderHistory () {
  const trades = engine.getClosedTrades();
  const tbody = document.querySelector('#trades-table tbody');
  tbody.textContent = '';

  let filtered = [...trades];
  if (activeTradeFilter === 'wins') filtered = filtered.filter(t => t.netPnl > 0);
  else if (activeTradeFilter === 'losses') filtered = filtered.filter(t => t.netPnl <= 0);

  if (calendarDayFilter) {
    filtered = filtered.filter(t => {
      const d = new Date(t.closeTime);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return k === calendarDayFilter;
    });
  }

  const reversed = [...filtered].reverse();
  let wins = 0;

  trades.forEach(t => { if (t.netPnl > 0) wins++; });
  const winRate = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0.0';

  reversed.forEach((trade, index) => {
    const row = document.createElement('tr');
    const cells = [
      String(reversed.length - index),
      trade.id,
      trade.dir > 0 ? 'LONG' : 'SHORT',
      fmt(trade.volume, 4),
      fmt(trade.entryPrice, priceDigits(trade.entryPrice)),
      fmt(trade.exitPrice, priceDigits(trade.exitPrice)),
      formatTime(trade.entryTime),
      formatTime(trade.closeTime),
      String(trade.bars),
      (trade.grossPnl >= 0 ? '+' : '') + fmt(trade.grossPnl, 2),
      fmt(trade.commission, 2),
      fmt(trade.swap, 2),
      (trade.netPnl >= 0 ? '+' : '') + fmt(trade.netPnl, 2),
      trade.reason
    ];

    cells.forEach((text, cellIndex) => {
      const cell = document.createElement('td');
      cell.textContent = text;
      if (cellIndex === 2) {
        cell.style.color = trade.dir > 0 ? 'var(--green)' : 'var(--red)';
        cell.style.fontWeight = '700';
      }
      if (cellIndex === 12) {
        cell.style.color = trade.netPnl > 0 ? 'var(--green)' : trade.netPnl < 0 ? 'var(--red)' : '';
        cell.style.fontWeight = '700';
      }
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });

  const sumEl = $('trades-summary');
  if (sumEl) {
    sumEl.textContent = trades.length
      ? `${trades.length} trades · ${wins}W / ${trades.length - wins}L (${winRate}% win rate)`
      : 'No trades recorded';
  }

  const badgeEl = $('bp-trades-count');
  if (badgeEl) badgeEl.textContent = String(trades.length);
}

// ---------- داشبورد عملکرد (KPI & Analytics) ----------

function renderStats () {
  const acc = engine.account();
  const trades = engine.getClosedTrades();
  const stats = risk.computeStats(trades, acc.initialBalance, { floating: acc.openPnl });

  // رندر ۴ کارت KPI تجاری
  const kpiRow = $('kpi-row');
  if (kpiRow) {
    kpiRow.textContent = '';
    const retPct = acc.initialBalance ? (stats.netPnl / acc.initialBalance * 100) : 0;
    const kpis = [
      {
        lbl: 'NET PROFIT',
        val: (stats.netPnl >= 0 ? '+$' : '-$') + fmt(Math.abs(stats.netPnl), 2),
        cls: stats.netPnl >= 0 ? 'pos' : 'neg',
        sub: `Return: ${retPct >= 0 ? '+' : ''}${fmt(retPct, 1)}%`
      },
      {
        lbl: 'WIN RATE',
        val: fmt(stats.winRate, 1) + '%',
        cls: stats.winRate >= 50 ? 'pos' : 'neg',
        sub: `${stats.wins} Wins / ${stats.losses} Losses`
      },
      {
        lbl: 'PROFIT FACTOR',
        val: stats.profitFactor === Infinity ? '∞' : fmt(stats.profitFactor, 2),
        cls: stats.profitFactor >= 1.5 ? 'pos' : (stats.profitFactor < 1 ? 'neg' : ''),
        sub: `Avg Win: $${fmt(stats.avgWin, 2)}`
      },
      {
        lbl: 'MAX DRAWDOWN',
        val: fmt(stats.maxDdPct, 1) + '%',
        cls: stats.maxDdPct > 15 ? 'neg' : '',
        sub: `Peak Drop: $${fmt(stats.maxDd, 2)}`
      }
    ];

    kpis.forEach(item => {
      const card = document.createElement('div');
      card.className = 'kpi-card';
      card.innerHTML = `<span class="kpi-lbl">${item.lbl}</span><span class="kpi-val ${item.cls}">${item.val}</span><span class="kpi-sub">${item.sub}</span>`;
      kpiRow.appendChild(card);
    });
  }

  const cells = [
    ['Total Trades', fmt(stats.total, 0)],
    ['Winners', fmt(stats.wins, 0)],
    ['Losers', fmt(stats.losses, 0)],
    ['Win Rate', fmt(stats.winRate, 1) + '%'],
    ['Gross Profit', '+$' + fmt(stats.grossProfit, 2)],
    ['Gross Loss', '-$' + fmt(stats.grossLoss, 2)],
    ['Commission', '$' + fmt(stats.totalCommission, 2)],
    ['Swap', '$' + fmt(stats.totalSwap, 2)],
    ['Profit Factor', stats.profitFactor === Infinity ? '∞' : fmt(stats.profitFactor, 2)],
    ['Expectancy', '$' + fmt(stats.expectancy, 2)],
    ['Average Win', '$' + fmt(stats.avgWin, 2)],
    ['Average Loss', '$' + fmt(stats.avgLoss, 2)],
    ['Max Drawdown', `$${fmt(stats.maxDd, 2)} (${fmt(stats.maxDdPct, 1)}%)`],
    ['Ending Equity', '$' + fmt(acc.equity, 2)]
  ];

  const grid = $('stats-grid');
  grid.textContent = '';
  for (const [label, value] of cells) {
    const cell = document.createElement('div');
    cell.className = 'stat-cell';
    const labelElement = document.createElement('span');
    labelElement.className = 'lbl';
    labelElement.textContent = label;
    const valueElement = document.createElement('span');
    valueElement.className = 'val';
    valueElement.textContent = value;
    cell.append(labelElement, valueElement);
    grid.appendChild(cell);
  }

  drawEquity(stats.equityPoints, acc.initialBalance);
  renderCalendar();
}

// ---------- رسم نمودار اکوئیتی مدرن (Canvas) ----------

let lastEquityState = null;

function drawEquity (points, initialBalance = 10000, hoverIndex = null) {
  lastEquityState = { points, initialBalance };
  const canvas = $('equity-canvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 130;
  const ratio = window.devicePixelRatio || 1;

  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  if (!points || points.length < 2) {
    context.fillStyle = '#576274';
    context.font = '11px monospace';
    context.textAlign = 'center';
    context.fillText('Closed trades will build your performance curve here', width / 2, height / 2);
    return;
  }

  const allVals = [...points, initialBalance];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const span = max - min || 1;
  const padTop = 18, padBottom = 20, padLeft = 14, padRight = 50;

  const x = index => padLeft + (index / (points.length - 1)) * (width - padLeft - padRight);
  const y = value => height - padBottom - ((value - min) / span) * (height - padTop - padBottom);

  // خط مرجع بالانس اولیه (نقطه سر‌به‌سر)
  const baseLineY = y(initialBalance);
  context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(padLeft, baseLineY);
  context.lineTo(width - padRight, baseLineY);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = '#8e99ab';
  context.font = '9px monospace';
  context.textAlign = 'left';
  context.fillText(`Start $${fmt(initialBalance, 0)}`, width - padRight + 4, baseLineY + 3);

  // گرادیانت زیر منحنی
  const lastVal = points[points.length - 1];
  const isProfit = lastVal >= initialBalance;
  const strokeColor = isProfit ? '#0ecb81' : '#f6465d';
  const grad = context.createLinearGradient(0, padTop, 0, height - padBottom);
  grad.addColorStop(0, isProfit ? 'rgba(14, 203, 129, 0.28)' : 'rgba(246, 70, 93, 0.28)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

  context.beginPath();
  context.moveTo(x(0), y(points[0]));
  points.forEach((val, i) => { if (i > 0) context.lineTo(x(i), y(val)); });
  context.lineTo(x(points.length - 1), height - padBottom);
  context.lineTo(x(0), height - padBottom);
  context.closePath();
  context.fillStyle = grad;
  context.fill();

  // خط اصلی منحنی
  context.strokeStyle = strokeColor;
  context.lineWidth = 2;
  context.beginPath();
  points.forEach((val, i) => { if (i === 0) context.moveTo(x(i), y(val)); else context.lineTo(x(i), y(val)); });
  context.stroke();

  // نقطه انتهایی با هاله
  const endX = x(points.length - 1);
  const endY = y(lastVal);
  context.fillStyle = strokeColor;
  context.beginPath();
  context.arc(endX, endY, 4, 0, Math.PI * 2);
  context.fill();

  // متن آخرین موجودی
  context.fillStyle = strokeColor;
  context.font = 'bold 10px monospace';
  context.fillText(`$${fmt(lastVal, 0)}`, endX + 6, endY + 3);

  // هاور تعاملی و کراس‌هیر (Interactive Inspect)
  if (hoverIndex != null && hoverIndex >= 0 && hoverIndex < points.length) {
    const hx = x(hoverIndex);
    const hy = y(points[hoverIndex]);
    const val = points[hoverIndex];
    const prevVal = hoverIndex > 0 ? points[hoverIndex - 1] : initialBalance;
    const delta = val - prevVal;
    const gainPct = initialBalance > 0 ? ((val - initialBalance) / initialBalance) * 100 : 0;

    context.strokeStyle = 'rgba(232, 179, 57, 0.5)';
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(hx, padTop);
    context.lineTo(hx, height - padBottom);
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = '#e8b339';
    context.beginPath();
    context.arc(hx, hy, 4.5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#181c26';
    context.lineWidth = 1.5;
    context.stroke();

    const line1 = hoverIndex === 0 ? 'Starting balance' : `Trade #${hoverIndex}: ${(delta >= 0 ? '+' : '')}$${fmt(delta, 2)}`;
    const line2 = `Equity: $${fmt(val, 2)} (${gainPct >= 0 ? '+' : ''}${fmt(gainPct, 2)}%)`;

    context.font = 'bold 9.5px monospace';
    const w1 = context.measureText(line1).width;
    context.font = '9px monospace';
    const w2 = context.measureText(line2).width;
    const boxW = Math.max(w1, w2) + 16;
    const boxH = 34;

    let boxX = hx - boxW / 2;
    if (boxX < padLeft) boxX = padLeft;
    if (boxX + boxW > width - 8) boxX = width - 8 - boxW;

    let boxY = hy - boxH - 8;
    if (boxY < 4) boxY = hy + 8;

    context.fillStyle = 'rgba(20, 24, 35, 0.94)';
    context.strokeStyle = 'rgba(232, 179, 57, 0.45)';
    context.lineWidth = 1;
    context.beginPath();
    if (typeof context.roundRect === 'function') {
      context.roundRect(boxX, boxY, boxW, boxH, 4);
    } else {
      context.rect(boxX, boxY, boxW, boxH);
    }
    context.fill();
    context.stroke();

    context.fillStyle = delta >= 0 ? '#0ecb81' : '#f6465d';
    context.font = 'bold 9.5px monospace';
    context.textAlign = 'left';
    context.fillText(line1, boxX + 8, boxY + 14);

    context.fillStyle = '#c5cdd9';
    context.font = '9px monospace';
    context.fillText(line2, boxX + 8, boxY + 27);
  }
}

function initEquityCanvasHover () {
  const canvas = $('equity-canvas');
  if (!canvas) return;

  canvas.addEventListener('mousemove', (e) => {
    if (!lastEquityState || !lastEquityState.points || lastEquityState.points.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padLeft = 14, padRight = 50;
    const usableW = (canvas.clientWidth || 600) - padLeft - padRight;
    const ratio = Math.max(0, Math.min(1, (mouseX - padLeft) / usableW));
    const idx = Math.round(ratio * (lastEquityState.points.length - 1));
    drawEquity(lastEquityState.points, lastEquityState.initialBalance, idx);
  });

  canvas.addEventListener('mouseleave', () => {
    if (!lastEquityState || !lastEquityState.points) return;
    drawEquity(lastEquityState.points, lastEquityState.initialBalance, null);
  });
}

// ---------- تقویم عملکرد ----------

let calView = null; // { year, month } (month 1-12)

function renderCalendar () {
  const container = $('calendar-grid');
  const title = $('cal-title');
  const summary = $('cal-summary');
  if (!container || !title || !summary) return;

  const trades = engine.getClosedTrades();
  const { daily, months } = risk.dailyPnL(trades);

  if (!calView) {
    if (trades.length) {
      const last = trades[trades.length - 1];
      const d = new Date(last.closeTime);
      calView = { year: d.getFullYear(), month: d.getMonth() + 1 };
    } else {
      const d = new Date();
      calView = { year: d.getFullYear(), month: d.getMonth() + 1 };
    }
  }

  container.textContent = '';
  const monthLabel = new Date(calView.year, calView.month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  title.textContent = monthLabel;
  const mo = months.find(x => x.year === calView.year && x.month === calView.month);
  summary.textContent = mo ? `${(mo.pnl >= 0 ? '+' : '')}${fmt(mo.pnl, 2)} · ${mo.winDays}W / ${mo.lossDays}L days` : 'No trades';

  const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const dowRow = document.createElement('div');
  dowRow.className = 'cal-dow';
  dow.forEach(d => { const s = document.createElement('span'); s.textContent = d; dowRow.appendChild(s); });
  container.appendChild(dowRow);

  const body = document.createElement('div');
  body.className = 'cal-grid-body';
  const first = new Date(calView.year, calView.month - 1, 1);
  const daysInMonth = new Date(calView.year, calView.month, 0).getDate();
  const today = new Date();

  for (let i = 0; i < first.getDay(); i++) {
    const e = document.createElement('div');
    e.className = 'cal-cell empty';
    body.appendChild(e);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${calView.year}-${String(calView.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('div');
    const pnl = daily[key];
    const isSelected = calendarDayFilter === key;
    cell.className = 'cal-cell' + (pnl == null ? '' : pnl > 0 ? ' win' : pnl < 0 ? ' loss' : ' flat')
      + (pnl != null ? ' has-trades' : '')
      + (isSelected ? ' active-filter' : '')
      + (today.getFullYear() === calView.year && today.getMonth() + 1 === calView.month && today.getDate() === day ? ' today' : '');
    const dEl = document.createElement('span');
    dEl.className = 'cal-day';
    dEl.textContent = day;
    cell.appendChild(dEl);
    if (pnl != null) {
      const p = document.createElement('span');
      p.className = 'cal-pnl';
      p.textContent = (pnl >= 0 ? '+' : '') + fmt(pnl, 0);
      cell.appendChild(p);
      cell.title = `${key}: ${(pnl >= 0 ? '+' : '')}${fmt(pnl, 2)} (Click to filter table)`;

      cell.addEventListener('click', () => {
        if (calendarDayFilter === key) {
          calendarDayFilter = null;
          toast('Cleared calendar date filter', 'info');
        } else {
          calendarDayFilter = key;
          toast(`Filtered trades for ${key}`, 'ok');
        }
        renderCalendar();
        renderHistory();
      });
    }
    body.appendChild(cell);
  }
  container.appendChild(body);
}

function shiftCalendarMonth (delta) {
  if (!calView) renderCalendar();
  let m = calView.month + delta, y = calView.year;
  if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
  calView = { year: y, month: m };
  renderCalendar();
}

// ---------- ژورنال معاملات ----------

function renderJournal () {
  const container = $('journal-list');
  const trades = engine.getClosedTrades();
  container.textContent = '';
  if (!trades.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'No trades to review yet — start a replay session and execute orders.';
    container.appendChild(empty);
    return;
  }
  const reversed = [...trades].reverse();
  for (const trade of reversed) {
    const entry = journal.getJournalEntry(trade.id);
    const card = document.createElement('div');
    card.className = 'journal-card';
    const head = document.createElement('div');
    head.className = 'journal-head';
    head.innerHTML = `<b>${trade.id}</b> · ${trade.dir > 0 ? 'LONG' : 'SHORT'} ${fmt(trade.volume, 4)} · Entry ${fmt(trade.entryPrice, priceDigits(trade.entryPrice))} → Exit ${fmt(trade.exitPrice, priceDigits(trade.exitPrice))} · P&L <b style="color:${trade.netPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${(trade.netPnl >= 0 ? '+' : '') + fmt(trade.netPnl, 2)}</b> · ${trade.reason}`;

    const tagList = Array.isArray(entry.tags) ? entry.tags : (entry.tags || '').split(',').map(s => s.trim()).filter(Boolean);
    const tagBadges = document.createElement('div');
    tagBadges.style.display = 'flex';
    tagBadges.style.flexWrap = 'wrap';
    tagBadges.style.gap = '4px';
    tagBadges.style.margin = '4px 0 6px';
    tagList.forEach(t => {
      const b = document.createElement('span');
      b.className = 'trp-chip selected';
      b.style.fontSize = '9px';
      b.style.padding = '1px 6px';
      b.style.cursor = 'default';
      b.textContent = t;
      tagBadges.appendChild(b);
    });

    const textarea = document.createElement('textarea');
    textarea.className = 'journal-note';
    textarea.placeholder = 'Write trade reflections, setup reasons or mistakes...';
    textarea.value = entry.notes || '';

    const row = document.createElement('div');
    row.className = 'journal-row';
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = 'Tags (comma separated, e.g. Breakout, Trend, FOMO)';
    tagInput.value = tagList.join(', ');

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn small primary';
    saveBtn.textContent = 'Save Note';
    const savedMsg = document.createElement('span');
    savedMsg.className = 'journal-saved';

    saveBtn.addEventListener('click', () => {
      const tags = tagInput.value.split(',').map(s => s.trim()).filter(Boolean);
      journal.saveJournalEntry(trade.id, { notes: textarea.value, tags });
      savedMsg.textContent = 'Saved ✓';
      setTimeout(() => { savedMsg.textContent = ''; }, 2000);
      toast(`Saved notes for ${trade.id}`, 'ok');
      renderJournal();
    });

    const shotBtn = document.createElement('button');
    shotBtn.className = 'btn small';
    shotBtn.textContent = 'Attach Screenshot';
    shotBtn.addEventListener('click', async () => {
      const defaultName = `chart-${trade.id}-${Date.now()}.png`;
      const res = await journal.saveChartScreenshot(defaultName, $('chart-container'));
      if (res.ok) {
        journal.saveJournalEntry(trade.id, { screenshot: res.path });
        toast(`Screenshot saved: ${res.path}`, 'ok');
      } else {
        toast(`Screenshot cancelled: ${res.error || ''}`, 'err');
      }
    });

    row.append(tagInput, saveBtn, shotBtn, savedMsg);
    if (tagList.length) {
      card.append(head, tagBadges, textarea, row);
    } else {
      card.append(head, textarea, row);
    }
    container.appendChild(card);
  }
}

async function saveScreenshot () {
  const name = `screenshot-${state.symbol}-${Date.now()}.png`;
  const res = await journal.saveChartScreenshot(name, $('chart-container'));
  if (res.ok) toast(`Chart captured: ${res.path}`, 'ok');
  else if (res.error !== 'Cancelled') toast(`Capture failed: ${res.error}`, 'err');
}

// ---------- مرور سریع و برچسب‌گذاری بعد از بسته شدن معامله ----------

let activeReviewTrade = null;
let reviewDismissTimer = null;

function showTradeReviewPopup (trade) {
  if (!trade) return;
  activeReviewTrade = trade;
  const popup = $('trade-review-popup');
  if (!popup) return;

  const isWin = trade.netPnl >= 0;
  const dirStr = trade.dir > 0 ? 'LONG' : 'SHORT';
  const pnlStr = (isWin ? '+' : '') + '$' + fmt(trade.netPnl, 2);

  $('trp-title').textContent = `${dirStr} Closed`;
  $('trp-sub').textContent = trade.id;
  const badge = $('trp-badge');
  badge.textContent = dirStr;
  badge.className = 'dir-badge ' + (trade.dir > 0 ? 'pos' : 'neg');

  const pnlEl = $('trp-pnl');
  pnlEl.textContent = pnlStr;
  pnlEl.className = isWin ? 'pos' : 'neg';

  const detailEl = $('trp-detail');
  detailEl.textContent = `${fmt(trade.volume, 3)} lots · ${trade.reason}`;

  document.querySelectorAll('.trp-chip').forEach(c => c.classList.remove('selected'));
  $('trp-note').value = '';

  popup.classList.remove('hidden');

  clearTimeout(reviewDismissTimer);
  reviewDismissTimer = setTimeout(() => {
    popup.classList.add('hidden');
  }, 16000);
}

function initTradeReviewPopup () {
  const popup = $('trade-review-popup');
  if (!popup) return;

  $('btn-close-trp').addEventListener('click', () => {
    popup.classList.add('hidden');
    clearTimeout(reviewDismissTimer);
  });

  document.querySelectorAll('.trp-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      clearTimeout(reviewDismissTimer);
    });
  });

  const saveReflection = () => {
    if (!activeReviewTrade) return;
    const selectedTags = Array.from(document.querySelectorAll('.trp-chip.selected')).map(c => c.dataset.tag);
    const noteText = $('trp-note').value.trim();
    if (!selectedTags.length && !noteText) {
      popup.classList.add('hidden');
      return;
    }
    const sessionId = engine.getSessionId() || 'default';
    journal.saveEntry(sessionId, activeReviewTrade.id, {
      tags: selectedTags,
      note: noteText,
      notes: noteText
    });
    toast(`Reflections saved for ${activeReviewTrade.id}`, 'ok');
    popup.classList.add('hidden');
    renderJournal();
  };

  $('btn-trp-save').addEventListener('click', saveReflection);
  $('trp-note').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveReflection();
    }
  });

  on('trade-closed', (trade) => {
    showTradeReviewPopup(trade);
  });
}

// ---------- تنظیمات شبیه‌سازی معامله ----------

function readSimSettings () {
  return {
    balance: Number($('setting-balance').value),
    contractSize: Number($('setting-contract').value),
    leverage: Number($('setting-leverage').value),
    spread: Number($('setting-spread').value),
    commissionPerLot: Number($('setting-commission').value),
    swapLong: Number($('setting-swap-long').value),
    swapShort: Number($('setting-swap-short').value),
    stopOutPct: Number($('setting-stop-out').value),
    marginCallPct: Number($('setting-margin-call').value)
  };
}

function applySimSettings () {
  const patch = readSimSettings();
  engine.configure(patch);
  saveSimSettings();
  renderAll();
  toast('Simulation parameters applied', 'ok');
}

function saveSimSettings () {
  try {
    localStorage.setItem('fxreplay.sim.settings.v2', JSON.stringify(readSimSettings()));
  } catch (e) { /* ignore */ }
}

function saveOrderState () {
  try {
    localStorage.setItem('fxreplay.order.state.v2', JSON.stringify({
      volume: $('order-volume').value,
      riskPct: $('risk-pct').value
    }));
  } catch (e) { /* ignore */ }
}

function initPersistence () {
  try {
    const rawSim = localStorage.getItem('fxreplay.sim.settings.v2');
    if (rawSim) {
      const s = JSON.parse(rawSim);
      Object.keys(s).forEach(k => {
        const el = $('setting-' + k.replace(/([A-Z])/g, '-$1').toLowerCase());
        if (el && Number.isFinite(s[k])) el.value = s[k];
      });
      engine.configure(s);
    }
    const rawOrder = localStorage.getItem('fxreplay.order.state.v2');
    if (rawOrder) {
      const o = JSON.parse(rawOrder);
      if (o.volume) {
        $('order-volume').value = o.volume;
        if ($('qtb-vol-input')) $('qtb-vol-input').value = o.volume;
      }
      if (o.riskPct) $('risk-pct').value = o.riskPct;
    }
  } catch (e) { /* ignore */ }

  let t = null;
  const queueSave = () => { clearTimeout(t); t = setTimeout(saveOrderState, 400); };
  ['order-volume', 'risk-pct'].forEach(id => $(id).addEventListener('input', queueSave));
}

// ---------- مقداردهی پنل معاملات و ویجت ۱-کلیک ----------

function initTradePanel () {
  // تب‌های نوع سفارش (Market, Limit, Stop)
  document.querySelectorAll('.order-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.order-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const type = tab.dataset.type;
      $('order-type').value = type;
      $('order-price-row').classList.toggle('hidden', type === 'market');
    });
  });

  $('btn-buy').addEventListener('click', () => submitTicket(1));
  $('btn-sell').addEventListener('click', () => submitTicket(-1));
  $('btn-calc-volume').addEventListener('click', sizeByRisk);
  $('btn-sim-apply').addEventListener('click', applySimSettings);

  ['order-volume', 'order-price', 'order-sl', 'order-tp', 'risk-pct'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', updatePlannedMetrics);
  });

  // چیپ‌های ریسک سریع
  document.querySelectorAll('.risk-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('risk-pct').value = chip.dataset.risk;
      const slRaw = $('order-sl').value.trim();
      if (slRaw) {
        sizeByRisk();
      } else {
        updatePlannedMetrics();
        toast(`Risk set to ${chip.dataset.risk}% (set SL to auto-calculate volume)`, 'info');
      }
    });
  });

  // چیپ‌های R:R سریع
  document.querySelectorAll('.rr-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      calculateTargetByRr(Number(chip.dataset.rr));
    });
  });

  // عملیات کلی پوزیشن‌ها (Bulk Actions)
  $('btn-be-all').addEventListener('click', () => {
    const positions = engine.getPositions();
    if (!positions.length) { toast('No open positions', 'info'); return; }
    let count = 0;
    for (const pos of positions) {
      const res = engine.modifyPosition(pos.id, { sl: pos.entryPrice });
      if (res.ok) count++;
    }
    sound.playOrder();
    toast(`Moved ${count} position(s) to Break-Even`, 'ok');
  });

  $('btn-close-all').addEventListener('click', () => {
    const positions = engine.getPositions();
    if (!positions.length) { toast('No open positions', 'info'); return; }
    for (const pos of positions) engine.closePositionById(pos.id, 1);
    toast(`Closed ${positions.length} position(s)`, 'info');
  });

  // Position click handler from chart
  chartApi.onPositionClick((positionId) => selectPositionInPanel(positionId));

  // کشیدن خط SL/TP روی چارت → تغییر مقدار
  chartApi.onSlTpLineDrag((positionId, stableId, price) => {
    if (!positionId) return;
    const isOrder = stableId.startsWith('osl_') || stableId.startsWith('otp_');
    const kind = (stableId.startsWith('sl_') || stableId.startsWith('osl_')) ? 'sl' : 'tp';
    const result = isOrder
      ? engine.modifyOrder(positionId, { [kind]: price })
      : engine.modifyPosition(positionId, { [kind]: price });
    if (!result.ok) {
      toast(result.msg, 'err');
      return false;
    }
    toast(`${positionId} ${kind.toUpperCase()} → ${fmt(price, 2)}`, 'ok');
  });

  // فیلترهای جدول معاملات
  document.querySelectorAll('#trade-filters .tbl-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#trade-filters .tbl-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTradeFilter = btn.dataset.filter;
      renderHistory();
    });
  });

  // قالب‌های آماده Pine Script
  const pineTpl = $('pine-template-select');
  if (pineTpl) {
    const PINE_TEMPLATES = {
      ema_cross: `//@version=5\nindicator("EMA 20/50 Cross", overlay=true)\nfast = ta.ema(close, 20)\nslow = ta.ema(close, 50)\nplot(fast, color=color.yellow, title="Fast EMA 20")\nplot(slow, color=color.blue, title="Slow EMA 50")`,
      rsi_reversal: `//@version=5\nindicator("RSI 14 Reversal", overlay=false)\nr = ta.rsi(close, 14)\nplot(r, color=color.purple, title="RSI")\nhline(70, color=color.red)\nhline(30, color=color.green)`,
      boll_bands: `//@version=5\nindicator("Bollinger Bands", overlay=true)\nbasis = ta.sma(close, 20)\ndev = ta.stdev(close, 20) * 2\nupper = basis + dev\nlower = basis - dev\nplot(basis, color=color.orange, title="Basis")\nplot(upper, color=color.green, title="Upper")\nplot(lower, color=color.red, title="Lower")`
    };

    pineTpl.addEventListener('change', () => {
      const code = PINE_TEMPLATES[pineTpl.value];
      if (code) {
        setPineScript(pineTpl.options[pineTpl.selectedIndex].text, code);
        runCurrentPine();
        toast('Loaded template: ' + pineTpl.options[pineTpl.selectedIndex].text, 'ok');
        pineTpl.value = '';
      }
    });
  }
}

// انتخاب پوزیشن در پنل کناری
let selectedPositionId = null;
function selectPositionInPanel (positionId) {
  selectedPositionId = positionId;
  const positions = engine.getPositions();
  const pos = positions.find(p => p.id === positionId);
  if (!pos) return;

  $('order-type').value = 'market';
  $('order-price-row').classList.add('hidden');
  $('order-volume').value = fmt(pos.volume, 4);
  $('order-sl').value = pos.sl != null ? pos.sl : '';
  $('order-tp').value = pos.tp != null ? pos.tp : '';

  document.querySelectorAll('#positions-list .position-item').forEach(card => {
    card.classList.toggle('selected', card.dataset.posId === positionId);
  });

  toast(`Selected ${pos.id} (${pos.dir > 0 ? 'LONG' : 'SHORT'})`, 'info');
}

// معاملات بر اساس کلیک روی چارت
function ticketVolume () {
  return Number($('order-volume').value) || 1;
}

function riskDistance (market) {
  const cs = state.candles;
  const upto = state.mode === 'replay' ? state.replayIndex : cs.length - 1;
  const n = 14;
  let atr = 0, count = 0;
  for (let i = Math.max(1, upto - n + 1); i <= upto; i++) {
    const c = cs[i], p = cs[i - 1];
    if (!c || !p) continue;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr += tr; count++;
  }
  atr = count ? atr / count : 0;
  const fallback = market * 0.001;
  return atr > 0 ? atr : fallback;
}

function defaultRiskLevels (dir, entry, clicked) {
  const dist = Math.max(Math.abs(clicked - entry), riskDistance(entry));
  const sl = dir > 0 ? entry - dist : entry + dist;
  const tp = dir > 0 ? entry + dist * 1.5 : entry - dist * 1.5;
  return { sl: +sl.toFixed(8), tp: +tp.toFixed(8) };
}

function autoDir (market, clicked) {
  return clicked >= market ? -1 : 1;
}

function onChartTradeClick (timestamp, price, mods = {}) {
  if (state.mode !== 'replay') { toast('Start a replay session before trading', 'err'); return; }
  if (!Number.isFinite(price)) return;
  const market = markPrice();
  if (!Number.isFinite(market)) { toast('No market price available', 'err'); return; }

  const dir = mods.shift || mods.ctrl ? -1 : autoDir(market, price);
  const volume = ticketVolume();
  const hasSl = $('order-sl').value.trim() !== '';
  const hasTp = $('order-tp').value.trim() !== '';
  const auto = defaultRiskLevels(dir, market, price);
  const sl = hasSl ? Number($('order-sl').value) : auto.sl;
  const tp = hasTp ? Number($('order-tp').value) : auto.tp;

  const result = engine.marketOrder(dir, volume, sl, tp);
  if (result.ok) sound.playOrder();
  toast(`${dir > 0 ? 'BUY' : 'SELL'} ${fmt(volume, 2)} @ ${fmt(market, priceDigits(market))} · SL ${fmt(sl, priceDigits(sl))} / TP ${fmt(tp, priceDigits(tp))}`, result.ok ? 'ok' : 'err');
}

// ---------- خروجی CSV ----------

function exportTrades () {
  const csv = risk.exportTradesCsv(engine.getClosedTrades(), formatTime);
  if (window.desktop && window.desktop.saveFile) {
    window.desktop.saveFile('trades.csv', csv).then(result => {
      if (result && result.path) toast(`Saved to ${result.path}`, 'ok');
      else if (result && result.error) toast(`Save failed: ${result.error}`, 'err');
    });
    return;
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'trades.csv';
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

// ---------- Dataset switcher & Timeframe Pills ----------

function refreshDatasetSelect () {
  const sel = $('dataset-select');
  const datasets = listDatasets();
  sel.textContent = '';
  if (!datasets.length) {
    const opt = document.createElement('option');
    opt.textContent = 'NO DATA';
    opt.value = '';
    sel.appendChild(opt);
    return;
  }
  for (const ds of datasets) {
    const opt = document.createElement('option');
    const key = `${ds.symbol}|${ds.timeframe}`;
    opt.value = key;
    opt.textContent = `${ds.symbol} · ${ds.timeframe} (${ds.bars.toLocaleString('en-US')})`;
    sel.appendChild(opt);
  }
  sel.value = `${state.symbol}|${state.timeframe}`;
}

function initDatasetSwitcher () {
  $('dataset-select').addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) return;
    const [sym, tf] = val.split('|');
    if (state.mode === 'replay') { toast('Exit replay before switching dataset', 'err'); e.target.value = `${state.symbol}|${state.timeframe}`; return; }
    setActiveDataset(sym, tf);
    rawBaseCandles = [...state.candles];
    syncTfSelect(tf);
    toast(`Switched to ${sym} · ${tf}`, 'ok');
  });

  // انتخاب تایم‌فریم و بازنمونه‌گیری (Resampling)
  const tfSelect = $('tf-select');
  if (tfSelect) {
    tfSelect.addEventListener('change', () => {
      if (!state.loaded || !rawBaseCandles.length) { toast('Load market data first', 'err'); return; }
      const targetTf = tfSelect.value;
      if (targetTf === state.timeframe) return;

      const currentTs = (state.mode === 'replay' && state.replayIndex >= 0 && state.candles[state.replayIndex])
        ? state.candles[state.replayIndex].timestamp
        : null;

      const resampled = resampleCandles(rawBaseCandles, targetTf);
      if (!resampled || resampled.length < 2) {
        toast('Cannot resample to ' + targetTf, 'err');
        tfSelect.value = state.timeframe;
        return;
      }

      state.candles = resampled;
      state.timeframe = targetTf;

      if (state.mode === 'replay' && currentTs != null) {
        let newIdx = state.candles.findIndex(c => c.timestamp >= currentTs);
        if (newIdx < 0) newIdx = state.candles.length - 1;
        state.replayIndex = newIdx;
        chartApi.applySlice(state.candles, newIdx + 1, chartApi.isFollowing());
      } else {
        chartApi.applyAll(state.candles);
      }

      $('bar-count-label').textContent = state.candles.length.toLocaleString('en-US') + ' bars';
      renderAll();
      toast(`Timeframe switched to ${targetTf} (${resampled.length} bars)`, 'info');
    });
  }
}

function syncTfSelect (tf) {
  const el = $('tf-select');
  if (el) el.value = tf;
}

// ---------- Go-To: پرش به تاریخ ----------

function nearestBarIndex (targetTs) {
  const cs = state.candles;
  if (!cs.length) return -1;
  let lo = 0, hi = cs.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cs[mid].timestamp < targetTs) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(cs[lo - 1].timestamp - targetTs) < Math.abs(cs[lo].timestamp - targetTs)) return lo - 1;
  return lo;
}

function toLocalInputValue (ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function syncGotoRange () {
  const inp = $('goto-input');
  if (!state.loaded || !state.candles.length) return;
  inp.min = toLocalInputValue(state.candles[0].timestamp);
  inp.max = toLocalInputValue(state.candles[state.candles.length - 1].timestamp);
  if (!inp.value) inp.value = toLocalInputValue(state.candles[Math.floor(state.candles.length / 2)].timestamp);
}

function initGoTo () {
  $('btn-goto').addEventListener('click', () => {
    const val = $('goto-input').value;
    if (!val) { toast('Enter a date and time to jump to', 'err'); return; }
    if (!state.loaded) { toast('Load data first', 'err'); return; }
    const ts = new Date(val).getTime();
    if (!Number.isFinite(ts)) { toast('Invalid date', 'err'); return; }
    let idx = nearestBarIndex(ts);
    if (idx < 0) return;
    if (state.mode !== 'replay') { enterReplay(Math.max(1, idx - 1)); toast(`Jumped to ${formatTime(state.candles[idx].timestamp)}`, 'ok'); return; }
    idx = Math.max(state.replayStart, idx);
    jumpTo(idx);
    $('scrubber').value = idx;
    toast(`Jumped to ${formatTime(state.candles[idx].timestamp)}`, 'ok');
  });
  $('goto-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-goto').click(); });
}

// ---------- Context Menu ----------

function hideContextMenu () { $('context-menu').classList.add('hidden'); }

function ctxItem (label, cls, run) {
  const b = document.createElement('button');
  b.className = 'ctx-item ' + (cls || '');
  b.textContent = label;
  b.addEventListener('click', () => { hideContextMenu(); run(); });
  return b;
}

function ctxSep () { const d = document.createElement('div'); d.className = 'ctx-sep'; return d; }

function tradeMenuItems (market, price) {
  if (state.mode !== 'replay') return [ctxItem('Start replay to trade here', '', () => {})];
  const vol = ticketVolume();
  const d = priceDigits(price);
  const items = [];
  if (price > market) {
    items.push(ctxItem(`Buy Stop ${vol} @ ${fmt(price, d)}`, 'buy', () => placePendingAt(1, 'stop', price, vol)));
    items.push(ctxItem(`Sell Limit ${vol} @ ${fmt(price, d)}`, 'sell', () => placePendingAt(-1, 'limit', price, vol)));
  } else {
    items.push(ctxItem(`Buy Limit ${vol} @ ${fmt(price, d)}`, 'buy', () => placePendingAt(1, 'limit', price, vol)));
    items.push(ctxItem(`Sell Stop ${vol} @ ${fmt(price, d)}`, 'sell', () => placePendingAt(-1, 'stop', price, vol)));
  }
  return items;
}

function placePendingAt (dir, type, price, volume) {
  const result = engine.placeOrder(type, dir, price, volume, null, null);
  if (result.ok) sound.playOrder();
  toast(result.msg, result.ok ? 'ok' : 'err');
}

function showContextMenu (x, y, timestamp, price) {
  const menu = $('context-menu');
  menu.textContent = '';
  const market = markPrice();
  tradeMenuItems(market, price).forEach(it => menu.appendChild(it));
  if (state.mode === 'replay' && engine.getPositions().length) {
    menu.appendChild(ctxSep());
    menu.appendChild(ctxItem('Close all positions', 'danger', () => {
      const ps = engine.getPositions();
      for (const pos of ps) engine.closePositionById(pos.id, 1);
      toast(`Closed ${ps.length} position(s)`, 'info');
    }));
  }
  menu.appendChild(ctxSep());
  menu.appendChild(ctxItem('Set replay start here', '', () => {
    if (!state.loaded) { toast('Load data first', 'err'); return; }
    const idx = state.candles.findIndex(c => c.timestamp === timestamp);
    if (idx < 0) { toast('Bar not found', 'err'); return; }
    enterReplay(idx);
    toast(`Replay restarted at bar ${idx}`, 'info');
  }));
  menu.appendChild(ctxItem('Copy bar info', '', () => {
    const idx = state.candles.findIndex(c => c.timestamp === timestamp);
    const c = idx >= 0 ? state.candles[idx] : null;
    if (!c) { toast('No bar at this position', 'err'); return; }
    const chg = c.close - c.open;
    toast(`O:${fmt(c.open, priceDigits(c.open))} H:${fmt(c.high, priceDigits(c.high))} L:${fmt(c.low, priceDigits(c.low))} C:${fmt(c.close, priceDigits(c.close))} ${chg >= 0 ? '+' : ''}${fmt(chg, priceDigits(chg))}`, 'info');
  }));
  menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.scrollHeight - 10) + 'px';
  menu.classList.remove('hidden');
}

function initContextMenu () {
  chartApi.setContextMenuHandler(showContextMenu);
  document.addEventListener('click', (e) => { if (!e.target.closest('#context-menu')) hideContextMenu(); });
}

// ---------- رندر کامل و اشتراک‌ها ----------

function renderAll () {
  renderAccount();
  renderPositions();
  renderPendingOrders();
  renderHistory();
  renderStats();
  renderJournal();
}

function initSubscriptions () {
  on('data-loaded', () => {
    engine.resetSession('');
    calView = null;
    rawBaseCandles = [...state.candles];
    chartApi.applyAll(state.candles);
    chartApi.scrollToRealTime();
    $('chart-empty').classList.add('hidden');
    $('bar-count-label').textContent = state.candles.length.toLocaleString('en-US') + ' bars';
    syncGotoRange();
    refreshDatasetSelect();
    syncTfSelect(state.timeframe);
    renderAll();
  });

  on('engine-changed', renderAll);
  on('replay-index', renderAccount);

  on('trade-closed', (trade) => {
    if (trade.netPnl >= 0) sound.playWin();
    else sound.playLoss();
    toast(`${trade.id} closed — ${trade.reason} · ${(trade.netPnl >= 0 ? '+' : '') + fmt(trade.netPnl, 2)}`, trade.netPnl >= 0 ? 'ok' : 'err');
  });

  on('margin-event', ({ kind, level }) => {
    sound.playLoss();
    if (kind === 'warning') toast(`Margin call warning — margin level ${fmt(level, 0)}%`, 'err');
    else if (kind === 'stop-out') toast(`Stop-out triggered at ${fmt(level, 0)}% — worst positions closed`, 'err');
    else toast('Equity depleted — all positions liquidated', 'err');
  });

  on('mode-changed', () => {
    const replay = state.mode === 'replay';
    $('chart-status').classList.toggle('replay', replay);
    $('chart-mode').textContent = replay ? 'REPLAY' : 'VIEW';
    if (replay) {
      chartApi.setTool('trade');
      document.querySelectorAll('#draw-toolbar .dt-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === 'trade'));
    }
    renderAll();
  });

  chartApi.onViewportChange(({ following }) => $('btn-follow').classList.toggle('active', following));
  $('btn-follow').addEventListener('click', () => chartApi.setFollowMode(!chartApi.isFollowing()));
  $('btn-export-trades').addEventListener('click', exportTrades);
  $('btn-journal-shot').addEventListener('click', saveScreenshot);
  document.querySelector('.bp-tab[data-tab="journal"]').addEventListener('click', renderJournal);
  $('cal-prev').addEventListener('click', () => shiftCalendarMonth(-1));
  $('cal-next').addEventListener('click', () => shiftCalendarMonth(1));

  chartApi.onCrosshairChange(renderBarLegend);
}

function renderBarLegend (candle) {
  const el = $('bar-legend');
  if (!candle) {
    const idx = state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
    candle = state.candles[idx];
    if (!candle) { el.textContent = ''; return; }
  }
  const chg = candle.close - candle.open;
  const chgPct = candle.open ? (chg / candle.open * 100) : 0;
  const dir = chg >= 0 ? 'lg-up' : 'lg-down';
  const d = priceDigits(candle.close);
  el.innerHTML = `<span class="lg-sym">${state.symbol} · ${state.timeframe}</span>` +
    `<span class="lg-item">O<b>${fmt(candle.open, d)}</b></span>` +
    `<span class="lg-item">H<b>${fmt(candle.high, d)}</b></span>` +
    `<span class="lg-item">L<b>${fmt(candle.low, d)}</b></span>` +
    `<span class="lg-item">C<b>${fmt(candle.close, d)}</b></span>` +
    `<span class="lg-item ${dir}">${chg >= 0 ? '+' : ''}${fmt(chg, d)} (${fmt(chgPct, 2)}%)</span>` +
    (candle.volume != null ? `<span class="lg-item">V<b>${candle.volume.toLocaleString('en-US')}</b></span>` : '');
}

// مقداردهی اولیه محیط برنامه
window.__mr2_toast = toast;
chartApi.initChart($('chart-container'));
chartApi.applyAppearance(preferences);
chartApi.setTradeClickHandler(onChartTradeClick);
initUi();
initPineEditor();
initWorkspacePreferences();
initDrawToolbar();
initTradePanel();
initPersistence();
initDatasetSwitcher();
initContextMenu();
initGoTo();
initShortcuts();
initEquityCanvasHover();
initTradeReviewPopup();
initSubscriptions();
renderAll();

// بارگذاری خودکار دیتای نمونه در شروع برای تجربه کاربری کامل و فوری
if (!state.loaded || !state.candles.length) {
  const sampleCandles = generateSampleCandles(3000, 65000);
  addDataset(sampleCandles, 'BTC/USDT', 'M15');
}
