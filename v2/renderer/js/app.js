// بوت v2: ترجیحات، اسپلیترها، تولبار ترسیم، پنل معامله (اکانت/تیکت/پوزیشن‌ها/سفارش‌ها/شبیه‌سازی)،
// تب‌های معاملات/آمار/ژورنال و اشتراک رویدادهای موتور

import { state, on, fmt, formatTime, priceDigits, listDatasets, setActiveDataset } from './core/store.js';
import * as chartApi from './chart.js';
import * as engine from './trading/engine.js';
import * as risk from './trading/risk.js';
import * as journal from './journal.js';
import { initUi, toast, openModal, closeModal } from './ui.js';
import { initPineEditor } from './editor.js';
import { initShortcuts } from './shortcuts.js';
import { enterReplay, jumpTo } from './core/replay.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'fxreplay.ui.preferences.v2';
const defaults = { theme: 'dark', accent: '#e8b339', density: 'compact', tradePanel: true, bottomPanel: true, tradeWidth: 300, bottomHeight: 250 };
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
    card.dataset.posId = pos.id;

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

    // ریسک/ریوارد و R:R — خیلی به‌درد تریدر می‌خورد
    const riskInfo = document.createElement('div');
    riskInfo.className = 'pos-risk-info';
    const cs = cfg.contractSize || 1;
    const risk = pos.sl != null ? Math.abs(pos.entryPrice - pos.sl) : null;
    const reward = pos.tp != null ? Math.abs(pos.tp - pos.entryPrice) : null;
    const parts = [];
    if (risk != null) parts.push(`Risk −${fmt(risk * pos.volume * cs, 2)}`);
    if (reward != null) parts.push(`Reward +${fmt(reward * pos.volume * cs, 2)}`);
    if (risk != null && reward != null && risk > 0) {
      const rr = reward / risk;
      const rrText = (rr >= 1 ? `1:${rr.toFixed(2)}` : `${(1 / rr).toFixed(2)}:1`);
      parts.push(`R:R ${rrText}`);
    }
    if (parts.length) {
      const rrEl = document.createElement('span');
      rrEl.textContent = parts.join(' · ');
      if (risk != null && reward != null && reward / risk >= 1) rrEl.classList.add('good-rr');
      riskInfo.appendChild(rrEl);
    } else {
      riskInfo.textContent = 'Set SL/TP to see risk & R:R';
      riskInfo.classList.add('muted');
    }
    card.append(head, fields, actions, riskInfo);
    list.appendChild(card);
    continue;
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
  renderCalendar();
}

// ---------- تقویم عملکرد ----------

let calView = null; // { year, month } (month 1-12)

function renderCalendar () {
  const daily = risk.dailyPnl(engine.getClosedTrades());
  const keys = Object.keys(daily).sort();
  const grid = $('calendar-grid');
  const title = $('cal-title');
  const summary = $('cal-summary');
  if (!grid) return;
  grid.textContent = '';

  // ماه پیش‌فرض: آخرین ماهی که ترید داشته، وگرنه ماه جاری
  if (!calView) {
    if (keys.length) { const [y, m] = keys[keys.length - 1].split('-'); calView = { year: +y, month: +m }; }
    else { const d = new Date(); calView = { year: d.getFullYear(), month: d.getMonth() + 1 }; }
  }
  const months = risk.monthlySummary(daily);
  const monthLabel = new Date(calView.year, calView.month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  title.textContent = monthLabel;
  const mo = months.find(x => x.year === calView.year && x.month === calView.month);
  summary.textContent = mo ? `${fmt(mo.pnl, 2)} · ${mo.winDays}W/${mo.lossDays}L days` : 'No trades this month';

  const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const dowRow = document.createElement('div');
  dowRow.className = 'cal-dow';
  dow.forEach(d => { const s = document.createElement('span'); s.textContent = d; dowRow.appendChild(s); });
  grid.appendChild(dowRow);

  const body = document.createElement('div');
  body.className = 'cal-grid-body';
  const first = new Date(calView.year, calView.month - 1, 1);
  const daysInMonth = new Date(calView.year, calView.month, 0).getDate();
  const today = new Date();
  for (let i = 0; i < first.getDay(); i++) { const e = document.createElement('div'); e.className = 'cal-cell empty'; body.appendChild(e); }
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${calView.year}-${String(calView.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('div');
    const pnl = daily[key];
    cell.className = 'cal-cell' + (pnl == null ? '' : pnl > 0 ? ' win' : pnl < 0 ? ' loss' : ' flat')
      + (today.getFullYear() === calView.year && today.getMonth() + 1 === calView.month && today.getDate() === day ? ' today' : '');
    const dEl = document.createElement('span'); dEl.className = 'cal-day'; dEl.textContent = day; cell.appendChild(dEl);
    if (pnl != null) { const p = document.createElement('span'); p.className = 'cal-pnl'; p.textContent = (pnl >= 0 ? '+' : '') + fmt(pnl, 0); cell.appendChild(p); cell.title = `${key}: ${fmt(pnl, 2)}`; }
    body.appendChild(cell);
  }
  grid.appendChild(body);
}

function shiftCalendarMonth (delta) {
  if (!calView) renderCalendar();
  let m = calView.month + delta, y = calView.year;
  if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
  calView = { year: y, month: m };
  renderCalendar();
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
  saveSimSettings();
  toast('Simulation settings applied — session rebuilt from replay start', 'info');
}

// ---------- ماندگاری تنظیمات و پارامترهای سفارش (scalper memory) ----------

const SIM_KEY = 'fxreplay.sim.settings.v2';
const ORDER_KEY = 'fxreplay.sim.order.v2';
const SIM_INPUTS = ['setting-balance', 'setting-contract', 'setting-leverage', 'setting-spread', 'setting-commission', 'setting-swap-long', 'setting-swap-short', 'setting-stop-out', 'setting-margin-call'];

function saveSimSettings () {
  try {
    const obj = {};
    for (const id of SIM_INPUTS) obj[id] = $(id).value;
    localStorage.setItem(SIM_KEY, JSON.stringify(obj));
  } catch (e) { /* ignore */ }
}

function saveOrderState () {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify({ volume: $('order-volume').value, risk: $('risk-pct').value })); } catch (e) { /* ignore */ }
}

function initPersistence () {
  try {
    const sim = JSON.parse(localStorage.getItem(SIM_KEY));
    if (sim && typeof sim === 'object') for (const id of SIM_INPUTS) if (sim[id] != null && sim[id] !== '') $(id).value = sim[id];
    engine.configure(readSimSettings());
  } catch (e) { /* ignore */ }
  try {
    const ord = JSON.parse(localStorage.getItem(ORDER_KEY));
    if (ord) { if (ord.volume) $('order-volume').value = ord.volume; if (ord.risk) $('risk-pct').value = ord.risk; }
  } catch (e) { /* ignore */ }
  let t = null;
  const queueSave = () => { clearTimeout(t); t = setTimeout(saveOrderState, 400); };
  ['order-volume', 'risk-pct'].forEach(id => $(id).addEventListener('input', queueSave));
}

function initTradePanel () {
  $('order-type').addEventListener('change', () => $('order-price-row').classList.toggle('hidden', $('order-type').value === 'market'));
  $('btn-buy').addEventListener('click', () => submitTicket(1));
  $('btn-sell').addEventListener('click', () => submitTicket(-1));
  $('btn-calc-volume').addEventListener('click', sizeByRisk);
  $('btn-sim-apply').addEventListener('click', applySimSettings);
  $('order-volume').addEventListener('change', saveOrderState);
  $('risk-pct').addEventListener('change', saveOrderState);

  // Position click handler from chart
  chartApi.onPositionClick((positionId) => selectPositionInPanel(positionId));

  // کشیدن خط SL/TP روی چارت → تغییر مقدار (با لاگ‌شدن در actionLog)
  chartApi.onSlTpLineDrag((positionId, stableId, price) => {
    if (!positionId) return;
    const isOrder = stableId.startsWith('osl_') || stableId.startsWith('otp_');
    const kind = (stableId.startsWith('sl_') || stableId.startsWith('osl_')) ? 'sl' : 'tp';
    const result = isOrder
      ? engine.modifyOrder(positionId, { [kind]: price })
      : engine.modifyPosition(positionId, { [kind]: price });
    if (!result.ok) {
      toast(result.msg, 'err');
      return false; // خط روی چارت به جای قبلی برمی‌گردد
    }
    toast(`${positionId} ${kind.toUpperCase()} → ${fmt(price, 2)}`, 'ok');
  });
}

// انتخاب پوزیشن در پنل کناری (از کلیک روی چارت)
let selectedPositionId = null;
function selectPositionInPanel (positionId) {
  selectedPositionId = positionId;
  const positions = engine.getPositions();
  const pos = positions.find(p => p.id === positionId);
  if (!pos) return;

  // پر کردن فرم سفارش با مقادیر پوزیشن
  $('order-type').value = 'market';
  $('order-price-row').classList.add('hidden');
  $('order-volume').value = fmt(pos.volume, 4);
  $('order-sl').value = pos.sl != null ? pos.sl : '';
  $('order-tp').value = pos.tp != null ? pos.tp : '';

  // هایلایت کارت پوزیشن
  document.querySelectorAll('#positions-list .position-item').forEach(card => {
    card.classList.toggle('selected', card.dataset.posId === positionId);
  });

  toast(`Selected ${pos.id} (${pos.dir > 0 ? 'LONG' : 'SHORT'})`, 'info');
}

// ---------- معاملات fxreplay-style روی چارت ----------

function ticketVolume () {
  return Number($('order-volume').value) || 1;
}

// حداقل فاصله منطقی حد ریسک: بر پایه ATR ۱۴ کندل اخیر (وگرنه ۰.۱٪ قیمت)
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

// حد ریسک پیش‌فرض: SL در فاصله‌ی «حداقل ATR یا فاصله کلیک» از ورود، TP آینه‌ی آن (R:R ≈ ۱:۱)
function defaultRiskLevels (dir, entry, clicked) {
  const dist = Math.max(Math.abs(clicked - entry), riskDistance(entry));
  const sl = dir > 0 ? entry - dist : entry + dist;
  const tp = dir > 0 ? entry + dist : entry - dist;
  return { sl: +sl.toFixed(8), tp: +tp.toFixed(8) };
}

// جهت بر اساس کلیک نسبت به بازار: بالای بازار → SELL، پایین → BUY (دقیقاً مثل fxreplay)
function autoDir (market, clicked) {
  return clicked >= market ? -1 : 1;
}

// هندلر چپ‌کلیک روی چارت با ابزار Trade → اوردر مارکت با جهت و باکس ریسک خودکار
function onChartTradeClick (timestamp, price, mods = {}) {
  if (state.mode !== 'replay') { toast('Start a replay session before trading', 'err'); return; }
  if (!Number.isFinite(price)) return;
  const market = markPrice();
  if (!Number.isFinite(market)) { toast('No market price available', 'err'); return; }

  const dir = mods.shift || mods.ctrl ? -1 : autoDir(market, price);
  const volume = ticketVolume();
  // اگر کاربر در پنل SL/TP وارد کرده، همان؛ وگرنه باکس ریسک خودکار
  const hasSl = $('order-sl').value.trim() !== '';
  const hasTp = $('order-tp').value.trim() !== '';
  const auto = defaultRiskLevels(dir, market, price);
  const sl = hasSl ? Number($('order-sl').value) : auto.sl;
  const tp = hasTp ? Number($('order-tp').value) : auto.tp;

  const result = engine.marketOrder(dir, volume, sl, tp);
  toast(`${dir > 0 ? 'BUY' : 'SELL'} ${fmt(volume, 2)} @ ${fmt(market, priceDigits(market))} · SL ${fmt(sl, priceDigits(sl))} / TP ${fmt(tp, priceDigits(tp))} — drag to adjust`, result.ok ? 'ok' : 'err');
}

// اوردر معلق: باکس ریسک حول «قیمت ورود» (تریگر) با حداقل فاصله ATR
function placePendingAt (dir, type, price, volume) {
  const auto = defaultRiskLevels(dir, price, price);
  const hasSl = $('order-sl').value.trim() !== '';
  const hasTp = $('order-tp').value.trim() !== '';
  const sl = hasSl ? Number($('order-sl').value) : auto.sl;
  const tp = hasTp ? Number($('order-tp').value) : auto.tp;
  const result = engine.placeOrder(type, dir, price, volume, sl, tp);
  toast(result.msg, result.ok ? 'ok' : 'err');
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

// ---------- Dataset switcher ----------

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

// ---------- Go-To: پرش به نزدیک‌ترین کندل به یک زمان مشخص ----------

function nearestBarIndex (targetTs) {
  const cs = state.candles;
  if (!cs.length) return -1;
  let lo = 0, hi = cs.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cs[mid].timestamp < targetTs) lo = mid + 1; else hi = mid; }
  // مقایسه با lo و lo-1 برای یافتن نزدیک‌ترین
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

// ---------- Context menu ----------

function initDatasetSwitcher () {
  const sel = $('dataset-select');
  sel.addEventListener('change', () => {
    const [symbol, tf] = sel.value.split('|');
    if (!symbol) return;
    if (state.mode === 'replay') { toast('Exit replay before switching dataset', 'err'); sel.value = `${state.symbol}|${state.timeframe}`; return; }
    if (!setActiveDataset(symbol, tf)) toast('Dataset not found', 'err');
  });
}

let ctxTimestamp = null;

function hideContextMenu () { $('context-menu').classList.add('hidden'); }

function ctxItem (label, cls, run) {
  const btn = document.createElement('button');
  btn.className = 'ctx-item' + (cls ? ' ' + cls : '');
  btn.textContent = label;
  btn.addEventListener('click', () => { hideContextMenu(); run(); });
  return btn;
}
function ctxSep () { const d = document.createElement('div'); d.className = 'ctx-sep'; return d; }

// آیتم‌های معاملاتی یکسان برای قیمت کلیک‌شده، دقیقاً مثل منوی راست‌کلیک fxreplay
function tradeMenuItems (market, price) {
  const items = [];
  const p = fmt(price, priceDigits(price));
  const vol = ticketVolume();
  const canTrade = state.mode === 'replay';
  if (!canTrade || !Number.isFinite(market)) return [];
  // مارکت با جهت خودکار از سمت کلیک
  const md = autoDir(market, price);
  items.push(ctxItem(`${md > 0 ? '▲' : '▼'} Market ${md > 0 ? 'Buy' : 'Sell'} @ ${fmt(market, priceDigits(market))}`, md > 0 ? 'buy' : 'sell',
    () => onChartTradeClick(ctxTimestamp, price, {})));
  // اوردر‌های معلق معتبر در همین قیمت (Limit روی سمت rest، Stop روی سمت breakout)
  if (price < market) {
    items.push(ctxItem(`▲ Buy Limit @ ${p}`, 'buy', () => placePendingAt(1, 'limit', price, vol)));
    items.push(ctxItem(`▼ Sell Stop @ ${p}`, 'sell', () => placePendingAt(-1, 'stop', price, vol)));
  } else if (price > market) {
    items.push(ctxItem(`▼ Sell Limit @ ${p}`, 'sell', () => placePendingAt(-1, 'limit', price, vol)));
    items.push(ctxItem(`▲ Buy Stop @ ${p}`, 'buy', () => placePendingAt(1, 'stop', price, vol)));
  }
  return items;
}

function showContextMenu (x, y, timestamp, price) {
  ctxTimestamp = timestamp;
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
    chartApi.applyAll(state.candles);
    chartApi.scrollToRealTime();
    $('chart-empty').classList.add('hidden');
    $('bar-count-label').textContent = state.candles.length.toLocaleString('en-US') + ' bars';
    syncGotoRange();
    refreshDatasetSelect();
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
initSubscriptions();
renderAll();
