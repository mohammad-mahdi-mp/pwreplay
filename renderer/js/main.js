import { state, on, fmt, formatTime } from './store.js';
import * as chartApi from './chart.js';
import * as tradingApi from './trading.js';
import { initUi, toast, openModal, closeModal } from './ui.js';
import { initPineEditor } from './editor.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'fxreplay.ui.preferences.v2';
const defaults = { theme: 'dark', accent: '#4c8dff', density: 'compact', tradePanel: true, bottomPanel: true, tradeWidth: 300, bottomHeight: 250 };
const priceDigits = price => Math.abs(price) >= 1000 ? 2 : 5;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
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

function readOrderInputs () {
  const sl = $('order-sl').value.trim();
  const tp = $('order-tp').value.trim();
  const price = $('order-price').value.trim();
  return { type: $('order-type').value, volume: Number($('order-volume').value), price: price ? Number(price) : NaN, sl: sl ? Number(sl) : null, tp: tp ? Number(tp) : null };
}

function placeOrder (dir) {
  if (!state.loaded) { toast('Load market data first', 'err'); return; }
  if (state.mode !== 'replay') { toast('Start a replay session before trading', 'err'); return; }
  const order = readOrderInputs();
  const result = order.type === 'market' ? tradingApi.marketOrder(dir, order.volume, order.sl, order.tp) : tradingApi.pendingOrder(order.type, dir, order.price, order.volume, order.sl, order.tp);
  toast(result.msg, result.ok ? 'ok' : 'err');
}

function initTradePanel () {
  $('order-type').addEventListener('change', () => $('order-price-row').classList.toggle('hidden', $('order-type').value === 'market'));
  $('btn-buy').addEventListener('click', () => placeOrder(1));
  $('btn-sell').addEventListener('click', () => placeOrder(-1));
  $('btn-close-pos').addEventListener('click', () => {
    const result = tradingApi.closePosition();
    toast(result.msg, result.ok ? 'ok' : 'err');
  });
  const applyAccount = () => {
    tradingApi.resetTrading(Number($('setting-balance').value) || 10000, Number($('setting-contract').value) || 1);
    toast('Simulation account reset', 'info');
  };
  $('setting-balance').addEventListener('change', applyAccount);
  $('setting-contract').addEventListener('change', applyAccount);
}

function renderAccount () {
  const trading = tradingApi.getTrading();
  const account = tradingApi.accountSnapshot();
  const index = state.mode === 'replay' ? state.replayIndex : state.candles.length - 1;
  const candle = state.candles[index];
  const price = candle ? candle.close : NaN;
  $('acc-balance').textContent = fmt(account.balance, 2);
  $('acc-equity').textContent = fmt(account.equity, 2);
  $('acc-open-pnl').textContent = trading.position ? fmt(account.openPnl, 2) : '0.00';
  $('acc-open-pnl').style.color = account.openPnl > 0 ? 'var(--green)' : account.openPnl < 0 ? 'var(--red)' : '';
  $('acc-trades').textContent = String(trading.closedTrades.length);
  $('market-price').textContent = candle ? `${state.symbol} · ${fmt(price, priceDigits(price))}` : 'No market data';
  $('buy-quote').textContent = candle ? fmt(price, priceDigits(price)) : '—';
  $('sell-quote').textContent = candle ? fmt(price, priceDigits(price)) : '—';
  const positionBox = $('pos-box');
  const rows = $('pos-rows');
  rows.textContent = '';
  if (trading.position) {
    positionBox.classList.remove('hidden');
    const position = trading.position;
    const rowDefs = [['Side', position.dir > 0 ? 'LONG' : 'SHORT'], ['Volume', fmt(position.volume, 4)], ['Entry', fmt(position.entryPrice, priceDigits(position.entryPrice))], ['Stop loss', position.sl != null ? fmt(position.sl, priceDigits(position.sl)) : '—'], ['Take profit', position.tp != null ? fmt(position.tp, priceDigits(position.tp)) : '—']];
    for (const [label, value] of rowDefs) {
      const row = document.createElement('div');
      row.className = 'pos-row';
      const labelElement = document.createElement('span');
      const valueElement = document.createElement('span');
      labelElement.textContent = label;
      valueElement.textContent = value;
      row.append(labelElement, valueElement);
      rows.appendChild(row);
    }
  } else positionBox.classList.add('hidden');
  renderPendingOrders(trading.pendingOrders);
}

function renderPendingOrders (orders) {
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
    const title = `${order.dir > 0 ? 'BUY' : 'SELL'} ${order.type.toUpperCase()}`;
    const protection = [order.sl != null ? `SL ${fmt(order.sl, priceDigits(order.sl))}` : null, order.tp != null ? `TP ${fmt(order.tp, priceDigits(order.tp))}` : null].filter(Boolean).join(' · ') || 'No protection';
    const head = document.createElement('div');
    head.className = 'pending-head';
    const titleElement = document.createElement('strong');
    const priceElement = document.createElement('span');
    priceElement.className = 'pending-price';
    titleElement.textContent = title;
    priceElement.textContent = fmt(order.price, priceDigits(order.price));
    head.append(titleElement, priceElement);
    const meta = document.createElement('div');
    meta.className = 'pending-meta';
    const details = document.createElement('span');
    details.textContent = `${order.id} · Vol ${fmt(order.volume, 4)}`;
    const cancel = document.createElement('button');
    cancel.className = 'cancel-order';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      const result = tradingApi.cancelPendingOrder(order.id);
      toast(result.msg, result.ok ? 'info' : 'err');
    });
    meta.append(details, cancel);
    const protectionRow = document.createElement('div');
    protectionRow.className = 'pending-meta';
    const protectionText = document.createElement('span');
    protectionText.textContent = protection;
    protectionRow.appendChild(protectionText);
    card.append(head, meta, protectionRow);
    container.appendChild(card);
  }
}

function renderHistory () {
  const trading = tradingApi.getTrading();
  const tbody = document.querySelector('#trades-table tbody');
  tbody.textContent = '';
  const trades = [...trading.closedTrades].reverse();
  let wins = 0;
  trades.forEach((trade, index) => {
    if (trade.pnl > 0) wins++;
    const row = document.createElement('tr');
    const cells = [String(trades.length - index), trade.dir > 0 ? 'LONG' : 'SHORT', fmt(trade.volume, 4), fmt(trade.entryPrice, priceDigits(trade.entryPrice)), fmt(trade.exitPrice, priceDigits(trade.exitPrice)), formatTime(trade.entryTime), formatTime(trade.closeTime), String(trade.bars), (trade.pnl >= 0 ? '+' : '') + fmt(trade.pnl, 2), trade.reason];
    cells.forEach((text, cellIndex) => {
      const cell = document.createElement('td');
      cell.textContent = text;
      if (cellIndex === 8) cell.style.color = trade.pnl > 0 ? 'var(--green)' : trade.pnl < 0 ? 'var(--red)' : '';
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
  $('trades-summary').textContent = trading.closedTrades.length ? `${trading.closedTrades.length} trades · ${wins} winners` : 'No trades recorded';
}

function renderStats () {
  const stats = tradingApi.computeStats();
  const cells = [['Total trades', fmt(stats.total, 0)], ['Winners', fmt(stats.wins, 0)], ['Losers', fmt(stats.losses, 0)], ['Win rate', fmt(stats.winRate, 1) + '%'], ['Gross profit', '+' + fmt(stats.grossProfit, 2)], ['Gross loss', '-' + fmt(stats.grossLoss, 2)], ['Profit factor', stats.profitFactor === Infinity ? '∞' : fmt(stats.profitFactor, 2)], ['Expectancy', fmt(stats.expectancy, 2)], ['Average win', fmt(stats.avgWin, 2)], ['Average loss', fmt(stats.avgLoss, 2)], ['Maximum drawdown', `${fmt(stats.maxDd, 2)} (${fmt(stats.maxDdPct, 1)}%)`], ['Net P&L', (stats.netPnl >= 0 ? '+' : '') + fmt(stats.netPnl, 2)]];
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

function exportTrades () {
  const csv = tradingApi.exportTradesCsv();
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

function initSubscriptions () {
  on('replay-index', renderAccount);
  on('trade-state-changed', () => { renderAccount(); renderHistory(); renderStats(); });
  on('mode-changed', () => {
    const replay = state.mode === 'replay';
    $('chart-status').classList.toggle('replay', replay);
    $('chart-mode').textContent = replay ? 'REPLAY' : 'VIEW';
  });
  chartApi.onViewportChange(({ following }) => $('btn-follow').classList.toggle('active', following));
  $('btn-follow').addEventListener('click', () => chartApi.setFollowMode(!chartApi.isFollowing()));
}

chartApi.initChart($('chart-container'));
chartApi.applyAppearance(preferences);
initUi();
initPineEditor();
initWorkspacePreferences();
initDrawToolbar();
initTradePanel();
initSubscriptions();
$('btn-export-trades').addEventListener('click', exportTrades);
renderAccount();
renderHistory();
renderStats();
