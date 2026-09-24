// بوت v2: ترجیحات، اسپلیترها، تولبار ترسیم، پنل معامله (اکانت/تیکت/پوزیشن‌ها/سفارش‌ها/شبیه‌سازی)،
// تب‌های معاملات/آمار/ژورنال و اشتراک رویدادهای موتور

import { state, on, fmt, formatTime, priceDigits } from './core/store.js';
import * as chartApi from './chart.js';
import * as engine from './trading/engine.js';
import * as risk from './trading/risk.js';
import * as journal from './journal.js';
import { initUi, toast, openModal, closeModal } from './ui.js';
import { initPineEditor } from './editor.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'fxreplay.ui.preferences.v2';
const defaults = { theme: 'dark', accent: '#4c8dff', density: 'compact', tradePanel: true, bottomPanel: true, tradeWidth: 300, bottomHeight: 250 };
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
let preferences = loadPreferences();

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
  preferences.tradeWidth = clamp(Number(preferences.tradeWidth) || 300, 230, 480);
  preferences.bottomHeight = clamp(Number(preferences.bottomHeight) || 250, 140, Math.max(140, window.innerHeight * 0.55));
  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.dataset.density = preferences.density;
  document.documentElement.style.setProperty('--accent', preferences.accent);
  document.documentElement.style.setProperty('--accent-rgb', accentRgb(preferences.accent));
  document.documentElement.style.setProperty('--trade-panel-width', preferences.tradeWidth + 'px');
  document.documentElement.style.setProperty('--bottom-panel-height', preferences.bottomHeight + 'px');
  document.body.classList.toggle('trade-collapsed', !preferences.tradePanel);
  document.body.classList.toggle('bottom-collapsed', !preferences.bottomPanel);
  document.body.classList.toggle('trade-pinned', preferences.tradePanel);
  if (chartApi.getChart()) chartApi.applyAppearance(preferences);
  if (resizeChart && chartApi.getChart()) requestAnimationFrame(chartApi.resize);
}

function savePreferences () { localStorage.setItem(PREFS_KEY, JSON.stringify(preferences)); }
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

// ---------- ترجیحات فضای کار ----------

function initWorkspacePreferences () {
  const syncControls = () => {
    $('pref-theme').value = preferences.theme;
    $('pref-accent').value = preferences.accent;
    $('pref-density').value = preferences.density;
    $('pref-trade-panel').checked = preferences.tradePanel;
    $('pref-bottom-panel').checked = preferences.bottomPanel;
  };
  $('btn-preferences').addEventListener('click', () => { syncControls(); openModal('preferences-modal'); });
  $('btn-save-preferences').addEventListener('click', () => {
    preferences.theme = $('pref-theme').value;
    preferences.accent = $('pref-accent').value;
    preferences.density = $('pref-density').value;
    preferences.tradePanel = $('pref-trade-panel').checked;
    preferences.bottomPanel = $('pref-bottom-panel').checked;
    applyPreferences();
    savePreferences();
    closeModal('preferences-modal');
    toast('Workspace preferences updated', 'ok');
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
  initSplitter($('trade-resizer'), event => {
    preferences.tradeWidth = clamp(window.innerWidth - event.clientX, 230, 480);
    document.documentElement.style.setProperty('--trade-panel-width', preferences.tradeWidth + 'px');
  });
  initSplitter($('bottom-resizer'), event => {
    preferences.bottomHeight = clamp(window.innerHeight - event.clientY, 140, window.innerHeight * 0.55);
    document.documentElement.style.setProperty('--bottom-panel-height', preferences.bottomHeight + 'px');
  });
  new ResizeObserver(() => chartApi.resize()).observe($('chart-wrap'));
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

// ---------- تولبار ترسیم ----------

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
    if (!chartApi.listUserDrawings().length || !window.confirm('Delete all user drawings? Trade and order markers will be kept.')) return;
    chartApi.clearDrawings();
    toast('All user drawings deleted', 'info');
  });
  $('drawing-select').addEventListener('change', event => chartApi.selectDrawing(event.target.value));
  const updateDrawing = () => {
    const settings = { color: $('drawing-color').value, width: Number($('drawing-width').value), style: $('drawing-style').value, lock: $('drawing-lock').checked, visible: $('drawing-visible').checked };
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
    } else {
      drawings.forEach((drawing, index) => {
        const option = document.createElement('option');
        option.value = drawing.id;
        option.textContent = `${index + 1}. ${drawing.label}`;
        select.appendChild(option);
      });
      select.value = drawings.some(drawing => drawing.id === previous) ? previous : drawings[drawings.length - 1].id;
    }
    const selected = drawings.find(drawing => drawing.id === select.value);
    if (selected) {
      $('drawing-color').value = selected.color;
      $('drawing-width').value = String(selected.width);
      $('drawing-style').value = selected.style;
      $('drawing-lock').checked = selected.lock;
      $('drawing-visible').checked = selected.visible;
    }
    ['drawing-select', 'drawing-color', 'drawing-width', 'drawing-style', 'drawing-lock', 'drawing-visible', 'btn-delete-drawing'].forEach(id => { $(id).disabled = !drawings.length; });
  });
  chartApi.selectDrawing(null);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.target.closest('.CodeMirror')) { chartApi.setTool('none'); setActive('none'); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.target.closest('input, textarea, .CodeMirror')) chartApi.removeSelectedDrawing();
  });
}

// ---------- رندر اکانت ----------

function renderAccount () {
  const acc = engine.account();
  const cfg = engine.getConfig();
  const price = markPrice();
  $('acc-balance').textContent = fmt(acc.balance, 2);
  $('acc-equity').textContent = fmt(acc.equity, 2);
  $('acc-open-pnl').textContent = fmt(acc.openPnl, 2);
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
  $('market-price').textContent = Number.isFinite(price) ? `${state.symbol} · ${fmt(price, priceDigits(price))}` : 'No market data';
  const half = cfg.spread / 2;
  $('buy-quote').textContent = Number.isFinite(price) ? fmt(price + half, priceDigits(price)) : '—';
  $('sell-quote').textContent = Number.isFinite(price) ? fmt(price - half, priceDigits(price)) : '—';
}

// ---------- تیکت سفارش ----------

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
  toast(result.msg, result.ok ? 'ok' : 'err');
}

function sizeByRisk () {
  const price = markPrice();
  const slRaw = $('order-sl').value.trim();
  const riskPct = Number($('risk-pct').value);
  if (!Number.isFinite(price)) { toast('No market price available', 'err'); return; }
  if (!slRaw) { toast('Enter a stop loss price first — volume is sized from its distance', 'err'); return; }
  const volume = risk.volumeByRisk({
    balance: engine.account().balance,
    riskPct,
    entryPrice: price,
    slPrice: Number(slRaw),
    contractSize: engine.getConfig().contractSize
  });
  if (!Number.isFinite(volume)) { toast('Could not compute volume — check risk % and stop loss', 'err'); return; }
  $('order-volume').value = volume.toFixed(4);
  toast(`Volume sized: ${fmt(volume, 4)} lots (risk ${fmt(riskPct, 2)}%)`, 'ok');
}

// ---------- رندر پوزیشن‌ها و سفارش‌های معلق ----------

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

    const head = document.createElement('div');
    head.className = 'pos-head';
    const badge = document.createElement('span');
    badge.className = 'dir-badge ' + (pos.dir > 0 ? 'long' : 'short');
    badge.textContent = pos.dir > 0 ? 'LONG' : 'SHORT';
    const meta = document.createElement('span');
    meta.textContent = `${pos.id} · ${fmt(pos.volume, 4)} @ ${fmt(pos.entryPrice, priceDigits(pos.entryPrice))}`;
    const pnl = document.createElement('span');
    const pnlVal = Number.isFinite(price) ? floatingOf(pos, price) : NaN;
    pnl.className = 'pos-pnl ' + (pnlVal > 0 ? 'pos' : pnlVal < 0 ? 'neg' : '');
    pnl.textContent = Number.isFinite(pnlVal) ? (pnlVal >= 0 ? '+' : '') + fmt(pnlVal, 2) : '—';
    head.append(badge, meta, pnl);

    const fields = document.createElement('div');
    fields.className = 'pos-fields';
    const slLabel = document.createElement('label');
    slLabel.className = 'field';
    const slSpan = document.createElement('span');
    slSpan.textContent = 'Stop loss';
    const slInput = document.createElement('input');
    slInput.type = 'number';
    slInput.step = 'any';
    slInput.placeholder = 'None';
    slInput.value = pos.sl != null ? pos.sl : '';
    slLabel.append(slSpan, slInput);
    const tpLabel = document.createElement('label');
    tpLabel.className = 'field';
    const tpSpan = document.createElement('span');
    tpSpan.textContent = 'Take profit';
    const tpInput = document.createElement('input');
    tpInput.type = 'number';
    tpInput.step = 'any';
    tpInput.placeholder = 'None';
    tpInput.value = pos.tp != null ? pos.tp : '';
    tpLabel.append(tpSpan, tpInput);
    fields.append(slLabel, tpLabel);

    const actions = document.createElement('div');
    actions.className = 'pos-actions';
    const portion = document.createElement('input');
    portion.type = 'number';
    portion.step = 'any';
    portion.min = '0';
    portion.max = String(pos.volume);
    portion.title = 'Volume to close (default: full)';
    portion.placeholder = fmt(pos.volume, 2);
    const setBtn = document.createElement('button');
    setBtn.className = 'btn small';
    setBtn.textContent = 'Set SL/TP';
    setBtn.addEventListener('click', () => {
      const sl = slInput.value.trim() === '' ? null : Number(slInput.value);
      const tp = tpInput.value.trim() === '' ? null : Number(tpInput.value);
      const result = engine.modifyPosition(pos.id, { sl, tp });
      toast(result.msg, result.ok ? 'ok' : 'err');
    });
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn small';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      const portionVol = portion.value.trim() === '' ? pos.volume : Number(portion.value);
      if (!Number.isFinite(portionVol) || portionVol <= 0) { toast('Close volume must be positive', 'err'); return; }
      const result = engine.closePositionById(pos.id, Math.min(1, portionVol / pos.volume));
      toast(result.msg, result.ok ? 'ok' : 'err');
    });
    const src = document.createElement('span');
    src.className = 'hint';
    src.textContent = `Margin ${fmt(pos.margin, 2)} · ${pos.source}`;
    actions.append(portion, closeBtn, setBtn, src);

    card.append(head, fields, actions);
    list.appendChild(card);
  }
  void cfg;
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
    protectionText.textContent = [order.sl != null ? `SL ${fmt(order.sl, priceDigits(order.sl))}` : null, order.tp != null ? `TP ${fmt(order.tp, priceDigits(order.tp))}` : null].filter(Boolean).join(' · ') || 'No protection';
    protectionRow.appendChild(protectionText);
    card.append(head, meta, protectionRow);
    container.appendChild(card);
  }
}

// ---------- رندر تاریخچه و آمار ----------

function renderHistory () {
  const trades = engine.getClosedTrades();
  const tbody = document.querySelector('#trades-table tbody');
  tbody.textContent = '';
  const reversed = [...trades].reverse();
  let wins = 0;
  reversed.forEach((trade, index) => {
    if (trade.netPnl > 0) wins++;
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
      if (cellIndex === 12) cell.style.color = trade.netPnl > 0 ? 'var(--green)' : trade.netPnl < 0 ? 'var(--red)' : '';
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
  $('trades-summary').textContent = trades.length ? `${trades.length} trades · ${wins} winners` : 'No trades recorded';
}

function renderStats () {
  const acc = engine.account();
  const stats = risk.computeStats(engine.getClosedTrades(), acc.initialBalance, { floating: acc.openPnl });
  const cells = [
    ['Total trades', fmt(stats.total, 0)],
    ['Winners', fmt(stats.wins, 0)],
    ['Losers', fmt(stats.losses, 0)],
    ['Win rate', fmt(stats.winRate, 1) + '%'],
    ['Gross profit', '+' + fmt(stats.grossProfit, 2)],
    ['Gross loss', '-' + fmt(stats.grossLoss, 2)],
    ['Commission', fmt(stats.totalCommission, 2)],
    ['Swap', fmt(stats.totalSwap, 2)],
    ['Profit factor', stats.profitFactor === Infinity ? '∞' : fmt(stats.profitFactor, 2)],
    ['Expectancy', fmt(stats.expectancy, 2)],
    ['Average win', fmt(stats.avgWin, 2)],
    ['Average loss', fmt(stats.avgLoss, 2)],
    ['Maximum drawdown', `${fmt(stats.maxDd, 2)} (${fmt(stats.maxDdPct, 1)}%)`],
    ['Net P&L', (stats.netPnl >= 0 ? '+' : '') + fmt(stats.netPnl, 2)]
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
  drawEquity(stats.equityPoints);
}

function drawEquity (points) {
  const canvas = $('equity-canvas');
  const context = canvas.getContext('2d');
  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 120;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!points || points.length < 2) return;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = index => (index / (points.length - 1)) * (width - 12) + 6;
  const y = value => height - 10 - ((value - min) / span) * (height - 20);
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--green').trim();
  context.lineWidth = 1.5;
  context.beginPath();
  points.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value)));
  context.stroke();
}

// ---------- ژورنال ----------

const EMOTIONS = ['', 'Calm', 'Planned', 'Impulsive', 'Fearful', 'Greedy', 'Revenge'];

function renderJournal () {
  const trades = engine.getClosedTrades();
  const sessionId = engine.getSessionId();
  const list = $('journal-list');
  list.textContent = '';
  if (!trades.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'No trades to review yet';
    list.appendChild(empty);
    return;
  }
  for (const trade of [...trades].reverse()) {
    const entry = journal.getEntry(sessionId, trade.id);
    const card = document.createElement('div');
    card.className = 'journal-card';

    const head = document.createElement('div');
    head.className = 'journal-head';
    const side = document.createElement('span');
    side.className = 'dir-badge ' + (trade.dir > 0 ? 'long' : 'short');
    side.textContent = trade.dir > 0 ? 'LONG' : 'SHORT';
    const title = document.createElement('b');
    title.textContent = `${trade.id} · ${fmt(trade.volume, 4)} @ ${fmt(trade.entryPrice, priceDigits(trade.entryPrice))} → ${fmt(trade.exitPrice, priceDigits(trade.exitPrice))}`;
    const pnl = document.createElement('span');
    pnl.style.color = trade.netPnl > 0 ? 'var(--green)' : trade.netPnl < 0 ? 'var(--red)' : '';
    pnl.textContent = (trade.netPnl >= 0 ? '+' : '') + fmt(trade.netPnl, 2);
    const reason = document.createElement('span');
    reason.textContent = `${trade.reason} · ${formatTime(trade.entryTime)} → ${formatTime(trade.closeTime)}`;
    head.append(side, title, pnl, reason);

    const note = document.createElement('textarea');
    note.className = 'journal-note';
    note.placeholder = 'What was the setup? What did you feel? What would you repeat or avoid?';
    note.value = entry.note || '';

    const row = document.createElement('div');
    row.className = 'journal-row';
    const tags = document.createElement('input');
    tags.placeholder = 'Tags (comma separated)';
    tags.value = entry.tags || '';
    const emotion = document.createElement('select');
    for (const name of EMOTIONS) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name || 'Emotion…';
      emotion.appendChild(option);
    }
    emotion.value = entry.emotion || '';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn small';
    saveBtn.textContent = 'Save note';
    const saved = document.createElement('span');
    saved.className = 'journal-saved';
    saveBtn.addEventListener('click', () => {
      journal.saveEntry(sessionId, trade.id, { note: note.value, tags: tags.value, emotion: emotion.value });
      saved.textContent = 'Saved';
      setTimeout(() => { saved.textContent = ''; }, 1600);
    });
    row.append(tags, emotion, saveBtn, saved);

    card.append(head, note, row);
    list.appendChild(card);
  }
}

function saveScreenshot () {
  const stamp = formatTime(Date.now()).replace(/[-: ]/g, '');
  const name = `${state.symbol}-${state.timeframe}-${stamp}.png`;
  journal.saveChartScreenshot(name, $('chart-container')).then(result => {
    if (result.ok) toast(`Screenshot saved — ${result.path}`, 'ok');
    else toast('Screenshot failed: ' + (result.error || 'unknown'), 'err');
  });
}

// ---------- تنظیمات شبیه‌سازی ----------

function readSimSettings () {
  return {
    balance: Number($('setting-balance').value) || 10000,
    contractSize: Number($('setting-contract').value) || 1,
    leverage: Math.max(1, Number($('setting-leverage').value) || 100),
    spread: Math.max(0, Number($('setting-spread').value) || 0),
    commissionPerLot: Math.max(0, Number($('setting-commission').value) || 0),
    swapLong: Number($('setting-swap-long').value) || 0,
    swapShort: Number($('setting-swap-short').value) || 0,
    stopOutPct: Math.max(0, Number($('setting-stop-out').value) || 50),
    marginCallPct: Math.max(0, Number($('setting-margin-call').value) || 100)
  };
}

function applySimSettings () {
  engine.configure(readSimSettings());
  engine.resetSession(engine.getSessionId());
  toast('Simulation settings applied — session rebuilt from replay start', 'info');
}

function initTradePanel () {
  $('order-type').addEventListener('change', () => $('order-price-row').classList.toggle('hidden', $('order-type').value === 'market'));
  $('btn-buy').addEventListener('click', () => submitTicket(1));
  $('btn-sell').addEventListener('click', () => submitTicket(-1));
  $('btn-calc-volume').addEventListener('click', sizeByRisk);
  $('btn-sim-apply').addEventListener('click', applySimSettings);
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
    chartApi.applyAll(state.candles);
    chartApi.scrollToRealTime();
    $('chart-empty').classList.add('hidden');
    $('symbol-label').textContent = state.symbol;
    $('tf-label').textContent = state.timeframe;
    $('bar-count-label').textContent = state.candles.length.toLocaleString('en-US') + ' bars';
    renderAll();
  });

  on('engine-changed', renderAll);
  on('replay-index', renderAccount);

  on('trade-closed', (trade) => {
    toast(`${trade.id} closed — ${trade.reason} · ${(trade.netPnl >= 0 ? '+' : '') + fmt(trade.netPnl, 2)}`, trade.netPnl >= 0 ? 'ok' : 'err');
  });

  on('margin-event', ({ kind, level }) => {
    if (kind === 'warning') toast(`Margin call warning — margin level ${fmt(level, 0)}%`, 'err');
    else if (kind === 'stop-out') toast(`Stop-out triggered at ${fmt(level, 0)}% — worst positions closed`, 'err');
    else toast('Equity depleted — all positions liquidated', 'err');
  });

  on('mode-changed', () => {
    const replay = state.mode === 'replay';
    $('chart-status').classList.toggle('replay', replay);
    $('chart-mode').textContent = replay ? 'REPLAY' : 'VIEW';
    renderAll();
  });

  chartApi.onViewportChange(({ following }) => $('btn-follow').classList.toggle('active', following));
  $('btn-follow').addEventListener('click', () => chartApi.setFollowMode(!chartApi.isFollowing()));
  $('btn-export-trades').addEventListener('click', exportTrades);
  $('btn-journal-shot').addEventListener('click', saveScreenshot);
  document.querySelector('.bp-tab[data-tab="journal"]').addEventListener('click', renderJournal);
}

chartApi.initChart($('chart-container'));
chartApi.applyAppearance(preferences);
initUi();
initPineEditor();
initWorkspacePreferences();
initDrawToolbar();
initTradePanel();
initSubscriptions();
renderAll();
